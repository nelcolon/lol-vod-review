//! `lvr-recorder`: Windows Graphics Capture -> Media Foundation H.264 sidecar.
//!
//! Default mode speaks JSON lines on stdin/stdout (see protocol.rs and the
//! README). `--self-test` records the primary monitor (or a window) for a few
//! seconds and prints a verdict, for the Phase 0 bake-off.
//!
//! Vanguard rules (PLAN.md §2.1): this binary only uses WGC with a window
//! handle or monitor, never opens the game process beyond
//! PROCESS_QUERY_LIMITED_INFORMATION, and never sends input or messages.

mod audio;
mod capture;
mod detect;
mod emit;
mod hwenc;
mod protocol;
mod priority;
mod qpc;
mod winenum;

use std::sync::mpsc;
use std::time::{Duration, Instant};

use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::capture::Session;
use crate::emit::Emitter;
use crate::protocol::{parse_command, AudioParams, Codec, Command, Event, StartParams, Target};

const VERSION: &str = env!("CARGO_PKG_VERSION");

enum Input {
    Line(String),
    Eof,
    Interrupt,
}

fn usage() -> String {
    format!(
        "lvr-recorder {VERSION}
JSON-lines sidecar (default): read commands on stdin, write events on stdout.

  lvr-recorder                       protocol mode
  lvr-recorder --self-test [opts]    record for N seconds and print a verdict
  lvr-recorder --list-windows        print the list-windows event and exit
  lvr-recorder --list-monitors       print the list-monitors event and exit

self-test options:
  --seconds N        duration (default 5)
  --out PATH         output mp4 (default %TEMP%\\lvr-selftest-<unix>.mp4)
  --window TITLE     capture the window whose title contains TITLE
  --process EXE      capture the largest window of this executable
  --hwnd N           capture this window handle
  --monitor N        capture monitor N (0-based list-monitors index; default: primary)
  --fps N            target fps (default 60)
  --bitrate MBPS     video bitrate (default 12)
  --hevc             HEVC instead of H.264
  --no-audio         disable system loopback audio
  --mic              mix the default microphone into the audio
  --mic-volume PCT   mic gain in percent, 0-400 (default 100)
  --legacy-perf      v0.3.7 behaviour: full-frame health check every 1 s, normal priority
  --cursor           include the cursor
  --border           keep the yellow WGC border
"
    )
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    // MTA for our own COM/WinRT use on the main thread (MF enumeration,
    // GraphicsCaptureItem creation happens on the crate's capture thread).
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print!("{}", usage());
        return;
    }
    if args.iter().any(|a| a == "--version") {
        println!("lvr-recorder {VERSION}");
        return;
    }
    let emitter = Emitter::new();
    if args.iter().any(|a| a == "--list-windows") {
        emitter.emit(&Event::Windows {
            windows: winenum::list_windows(),
        });
        return;
    }
    if args.iter().any(|a| a == "--list-monitors") {
        emitter.emit(&Event::Monitors {
            monitors: winenum::list_monitors(),
        });
        return;
    }
    if args.iter().any(|a| a == "--self-test") {
        std::process::exit(self_test(&args, emitter));
    }
    run_protocol(emitter);
}

fn run_protocol(emitter: Emitter) {
    emitter.emit(&Event::Ready {
        version: VERSION.into(),
        pid: std::process::id(),
    });
    let (tx, rx) = mpsc::channel::<Input>();
    {
        let tx = tx.clone();
        std::thread::Builder::new()
            .name("lvr-stdin".into())
            .spawn(move || {
                use std::io::BufRead;
                let stdin = std::io::stdin();
                for line in stdin.lock().lines() {
                    match line {
                        Ok(l) => {
                            if tx.send(Input::Line(l)).is_err() {
                                return;
                            }
                        }
                        Err(_) => break,
                    }
                }
                let _ = tx.send(Input::Eof);
            })
            .expect("spawn stdin thread");
    }
    {
        let tx = tx.clone();
        let _ = ctrlc::set_handler(move || {
            let _ = tx.send(Input::Interrupt);
        });
    }

    let mut session: Option<Session> = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Input::Line(line)) => {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                match parse_command(line) {
                    Err(e) => emitter.emit(&Event::Error {
                        code: "bad_command".into(),
                        message: e.to_string(),
                    }),
                    Ok(cmd) => {
                        if handle_command(cmd, &mut session, &emitter) {
                            break;
                        }
                    }
                }
            }
            Ok(Input::Eof) => {
                if let Some(s) = session.take() {
                    emitter.emit(&s.stop("stdin_eof"));
                }
                break;
            }
            Ok(Input::Interrupt) => {
                if let Some(s) = session.take() {
                    emitter.emit(&s.stop("interrupt"));
                }
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if let Some(s) = session.as_mut() {
            if let Some(reason) = s.tick() {
                let s = session.take().expect("session present");
                emitter.emit(&s.stop(&reason));
            }
        }
    }
}

/// Returns true when the process should exit.
fn handle_command(cmd: Command, session: &mut Option<Session>, emitter: &Emitter) -> bool {
    match cmd {
        Command::Start(params) => {
            if session.is_some() {
                emitter.emit(&Event::Error {
                    code: "already_recording".into(),
                    message: "stop the current recording first".into(),
                });
                return false;
            }
            match Session::start(params, emitter.clone()) {
                Ok(s) => *session = Some(s),
                Err(e) => emitter.emit(&Event::Error {
                    code: e.code.into(),
                    message: e.message,
                }),
            }
        }
        Command::Stop => match session.take() {
            Some(s) => emitter.emit(&s.stop("stop")),
            None => emitter.emit(&Event::Error {
                code: "not_recording".into(),
                message: "no active recording".into(),
            }),
        },
        Command::Status => {
            let ev = match session.as_ref() {
                Some(s) => Event::Status {
                    state: s.state().into(),
                    path: Some(s.path().to_string()),
                    frames: s.frames(),
                    dropped: s.dropped(),
                    t: s.t_secs(),
                },
                None => Event::Status {
                    state: "idle".into(),
                    path: None,
                    frames: 0,
                    dropped: 0,
                    t: 0.0,
                },
            };
            emitter.emit(&ev);
        }
        Command::ListWindows => emitter.emit(&Event::Windows {
            windows: winenum::list_windows(),
        }),
        Command::ListMonitors => emitter.emit(&Event::Monitors {
            monitors: winenum::list_monitors(),
        }),
    }
    false
}

fn self_test(args: &[String], emitter: Emitter) -> i32 {
    let seconds: f64 = arg_value(args, "--seconds").and_then(|v| v.parse().ok()).unwrap_or(5.0);
    let fps: u32 = arg_value(args, "--fps").and_then(|v| v.parse().ok()).unwrap_or(60);
    let bitrate: f64 = arg_value(args, "--bitrate").and_then(|v| v.parse().ok()).unwrap_or(12.0);
    let out = arg_value(args, "--out").unwrap_or_else(|| {
        let unix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        std::env::temp_dir()
            .join(format!("lvr-selftest-{unix}.mp4"))
            .to_string_lossy()
            .into_owned()
    });
    let target = if let Some(t) = arg_value(args, "--window") {
        Target::WindowTitle { window_title: t }
    } else if let Some(p) = arg_value(args, "--process") {
        Target::ProcessName { process_name: p }
    } else if let Some(h) = arg_value(args, "--hwnd").and_then(|v| v.parse().ok()) {
        Target::Hwnd { hwnd: h }
    } else {
        Target::Monitor {
            monitor: arg_value(args, "--monitor")
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(winenum::primary_monitor_index),
        }
    };
    let params = StartParams {
        target,
        out: out.clone(),
        fps,
        bitrate_mbps: bitrate,
        width: None,
        height: None,
        audio: AudioParams {
            game: !args.iter().any(|a| a == "--no-audio"),
            mic: args.iter().any(|a| a == "--mic"),
            mic_volume: arg_value(args, "--mic-volume").and_then(|v| v.parse().ok()).unwrap_or(100),
        },
        cursor: args.iter().any(|a| a == "--cursor"),
        border: args.iter().any(|a| a == "--border"),
        codec: if args.iter().any(|a| a == "--hevc") { Codec::Hevc } else { Codec::H264 },
        perf: if args.iter().any(|a| a == "--legacy-perf") {
            protocol::PerfParams { health_every_s: 1.0, health_crop: false, low_priority: false }
        } else {
            protocol::PerfParams::default()
        },
    };

    let mut session = match Session::start(params, emitter.clone()) {
        Ok(s) => s,
        Err(e) => {
            emitter.emit(&Event::Error {
                code: e.code.into(),
                message: e.message.clone(),
            });
            eprintln!("SELFTEST FAIL start: {} {}", e.code, e.message);
            return 2;
        }
    };
    let deadline = Instant::now() + Duration::from_secs_f64(seconds);
    let mut reason = "self_test_done".to_string();
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
        if let Some(r) = session.tick() {
            reason = r;
            break;
        }
    }
    let fps_actual_expected = fps as f64 * seconds;
    let stopped = session.stop(&reason);
    emitter.emit(&stopped);
    match stopped {
        Event::Stopped {
            frames,
            dropped,
            duration_ms,
            ..
        } => {
            let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
            let fps_actual = if duration_ms > 0 { frames as f64 * 1000.0 / duration_ms as f64 } else { 0.0 };
            // WGC only delivers frames when content changes, so a static desktop
            // legitimately yields few frames; require a file and some frames.
            let ok = size > 0 && frames > 0 && reason == "self_test_done";
            let verdict = format!(
                "SELFTEST {} path={out} bytes={size} frames={frames} dropped={dropped} durationMs={duration_ms} fpsActual={fps_actual:.1} (target {fps}, {:.0} frames if content changed every frame)",
                if ok { "OK" } else { "FAIL" },
                fps_actual_expected
            );
            eprintln!("{verdict}");
            if ok {
                0
            } else {
                1
            }
        }
        Event::Error { code, message } => {
            eprintln!("SELFTEST FAIL {code}: {message}");
            1
        }
        _ => 1,
    }
}
