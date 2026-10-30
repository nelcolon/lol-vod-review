//! JSON-lines protocol between the core (Electron) and this sidecar.
//!
//! stdin carries one command object per line (`{"cmd": ...}`), stdout carries
//! one event object per line (`{"ev": ...}`). See `docs/PLAN.md` §3.2 and the
//! package README for the field-by-field contract.

use serde::{Deserialize, Serialize};

/// Default process whose window we record when no target is given.
pub const DEFAULT_PROCESS: &str = "League of Legends.exe";

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "cmd", rename_all = "kebab-case")]
pub enum Command {
    Start(StartParams),
    Stop,
    Status,
    ListWindows,
    ListMonitors,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartParams {
    #[serde(default)]
    pub target: Target,
    pub out: String,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_bitrate_mbps")]
    pub bitrate_mbps: f64,
    /// Locked output width. `null`/absent = size of the first captured frame.
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub audio: AudioParams,
    /// Include the mouse cursor in the capture.
    #[serde(default)]
    pub cursor: bool,
    /// Let Windows draw the yellow WGC border (Windows 11 lets us turn it off).
    #[serde(default)]
    pub border: bool,
    #[serde(default)]
    pub codec: Codec,
}

fn default_fps() -> u32 {
    60
}
fn default_bitrate_mbps() -> f64 {
    12.0
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Codec {
    #[default]
    H264,
    Hevc,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Target {
    Hwnd {
        hwnd: u64,
    },
    Pid {
        pid: u32,
    },
    WindowTitle {
        #[serde(rename = "windowTitle")]
        window_title: String,
    },
    ProcessName {
        #[serde(rename = "processName")]
        process_name: String,
    },
    Monitor {
        /// 0-based monitor index as reported by `list-monitors`.
        monitor: u32,
    },
}

impl Default for Target {
    fn default() -> Self {
        Target::ProcessName {
            process_name: DEFAULT_PROCESS.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioParams {
    #[serde(default = "default_true")]
    pub game: bool,
    #[serde(default)]
    pub mic: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AudioParams {
    fn default() -> Self {
        AudioParams {
            game: true,
            mic: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WarningCode {
    BlackFrames,
    BlackFramesCleared,
    FrozenFrames,
    FrozenFramesCleared,
    WindowMinimized,
    WindowRestored,
    SizeChanged,
    NoFramesYet,
    AudioUnavailable,
    MicUnsupported,
    MicUnavailable,
    ScaleUnavailable,
    BorderSettingUnsupported,
    CursorSettingUnsupported,
    MinUpdateIntervalUnsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub hwnd: u64,
    pub pid: u32,
    pub title: String,
    pub class: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process: Option<String>,
    pub width: i32,
    pub height: i32,
    pub minimized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub index: u32,
    pub name: String,
    pub device: String,
    pub width: u32,
    pub height: u32,
    pub refresh_rate: u32,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "ev", rename_all = "camelCase")]
pub enum Event {
    /// Emitted once at process start.
    Ready {
        version: String,
        pid: u32,
    },
    /// Emitted when the first frame has been received and the encoder is open.
    #[serde(rename_all = "camelCase")]
    Started {
        /// QueryPerformanceCounter ticks of the first encoded frame
        /// (converted from WGC `SystemRelativeTime`).
        qpc_start: i64,
        qpc_freq: i64,
        /// Raw WGC `SystemRelativeTime` of the first frame, 100 ns units.
        qpc_start_sys_rel100ns: i64,
        /// `QPC(now) - qpcStart` when the first frame reached us, in ms.
        first_frame_latency_ms: f64,
        wall_start: String,
        encoder: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        encoder_hw: Option<String>,
        width: u32,
        height: u32,
        fps: u32,
        audio: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        audio_mode: Option<String>,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        hwnd: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Stats {
        frames: u64,
        dropped: u64,
        t: f64,
        fps_actual: f64,
        last_frame_age_ms: u64,
        audio_seconds: f64,
    },
    Warning {
        code: WarningCode,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        t: f64,
    },
    #[serde(rename_all = "camelCase")]
    Stopped {
        duration_ms: u64,
        path: String,
        frames: u64,
        dropped: u64,
        reason: String,
    },
    Error {
        code: String,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Status {
        state: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        frames: u64,
        dropped: u64,
        t: f64,
    },
    Windows {
        windows: Vec<WindowInfo>,
    },
    Monitors {
        monitors: Vec<MonitorInfo>,
    },
}

pub fn parse_command(line: &str) -> Result<Command, serde_json::Error> {
    serde_json::from_str(line)
}

pub fn encode_event(ev: &Event) -> String {
    // Event has no map keys that can fail to serialise.
    serde_json::to_string(ev).expect("event serialises")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_contract_start_line() {
        let line = r#"{"cmd":"start","target":{"hwnd":123},"out":"C:\\rec\\seg.mp4","fps":60,"bitrateMbps":12,"width":null,"height":null,"audio":{"game":true,"mic":false},"cursor":false,"border":false}"#;
        let cmd = parse_command(line).unwrap();
        match cmd {
            Command::Start(p) => {
                assert_eq!(p.target, Target::Hwnd { hwnd: 123 });
                assert_eq!(p.out, r"C:\rec\seg.mp4");
                assert_eq!(p.fps, 60);
                assert_eq!(p.bitrate_mbps, 12.0);
                assert_eq!(p.width, None);
                assert_eq!(p.height, None);
                assert!(p.audio.game);
                assert!(!p.audio.mic);
                assert!(!p.cursor);
                assert!(!p.border);
                assert_eq!(p.codec, Codec::H264);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn parses_every_target_shape() {
        let cases: Vec<(&str, Target)> = vec![
            (r#"{"pid":456}"#, Target::Pid { pid: 456 }),
            (
                r#"{"windowTitle":"League of Legends (TM) Client"}"#,
                Target::WindowTitle {
                    window_title: "League of Legends (TM) Client".into(),
                },
            ),
            (
                r#"{"processName":"League of Legends.exe"}"#,
                Target::ProcessName {
                    process_name: "League of Legends.exe".into(),
                },
            ),
            (r#"{"monitor":0}"#, Target::Monitor { monitor: 0 }),
            (r#"{"hwnd":9007199254740993}"#, Target::Hwnd { hwnd: 9007199254740993 }),
        ];
        for (json, expected) in cases {
            let line = format!(r#"{{"cmd":"start","target":{json},"out":"x.mp4"}}"#);
            let Command::Start(p) = parse_command(&line).unwrap() else {
                panic!("not start")
            };
            assert_eq!(p.target, expected, "{json}");
        }
    }

    #[test]
    fn start_defaults_apply_when_fields_missing() {
        let Command::Start(p) = parse_command(r#"{"cmd":"start","out":"a.mp4"}"#).unwrap() else {
            panic!()
        };
        assert_eq!(p.target, Target::default());
        assert_eq!(p.fps, 60);
        assert_eq!(p.bitrate_mbps, 12.0);
        assert_eq!(p.audio, AudioParams::default());
        assert!(p.audio.game);
        assert!(!p.cursor);
        assert!(!p.border);
    }

    #[test]
    fn parses_simple_commands() {
        assert_eq!(parse_command(r#"{"cmd":"stop"}"#).unwrap(), Command::Stop);
        assert_eq!(parse_command(r#"{"cmd":"status"}"#).unwrap(), Command::Status);
        assert_eq!(parse_command(r#"{"cmd":"list-windows"}"#).unwrap(), Command::ListWindows);
        assert_eq!(parse_command(r#"{"cmd":"list-monitors"}"#).unwrap(), Command::ListMonitors);
    }

    #[test]
    fn rejects_unknown_or_malformed() {
        assert!(parse_command(r#"{"cmd":"explode"}"#).is_err());
        assert!(parse_command(r#"{"cmd":"start"}"#).is_err(), "out is required");
        assert!(parse_command("not json").is_err());
        assert!(parse_command(r#"{"cmd":"start","out":"a.mp4","target":{"bogus":1}}"#).is_err());
    }

    #[test]
    fn started_event_uses_contract_keys() {
        let ev = Event::Started {
            qpc_start: 123456789,
            qpc_freq: 10_000_000,
            qpc_start_sys_rel100ns: 123456789,
            first_frame_latency_ms: 3.5,
            wall_start: "2026-10-29T12:00:00Z".into(),
            encoder: "h264_mf".into(),
            encoder_hw: Some("NVIDIA H.264 Encoder MFT".into()),
            width: 1920,
            height: 1080,
            fps: 60,
            audio: true,
            audio_mode: Some("system_loopback".into()),
            path: "C:\\x.mp4".into(),
            hwnd: Some(42),
        };
        let v: serde_json::Value = serde_json::from_str(&encode_event(&ev)).unwrap();
        assert_eq!(v["ev"], "started");
        assert_eq!(v["qpcStart"], 123456789);
        assert_eq!(v["qpcFreq"], 10_000_000);
        assert_eq!(v["wallStart"], "2026-10-29T12:00:00Z");
        assert_eq!(v["encoder"], "h264_mf");
        assert_eq!(v["width"], 1920);
        assert_eq!(v["height"], 1080);
        assert_eq!(v["hwnd"], 42);
    }

    #[test]
    fn other_events_use_contract_keys() {
        let stats = Event::Stats {
            frames: 3600,
            dropped: 2,
            t: 60.0,
            fps_actual: 59.9,
            last_frame_age_ms: 16,
            audio_seconds: 60.0,
        };
        let v: serde_json::Value = serde_json::from_str(&encode_event(&stats)).unwrap();
        assert_eq!(v["ev"], "stats");
        assert_eq!(v["fpsActual"], 59.9);
        assert_eq!(v["frames"], 3600);

        let w = Event::Warning {
            code: WarningCode::BlackFrames,
            detail: None,
            t: 1.0,
        };
        let v: serde_json::Value = serde_json::from_str(&encode_event(&w)).unwrap();
        assert_eq!(v["ev"], "warning");
        assert_eq!(v["code"], "black_frames");
        assert!(v.get("detail").is_none());
        let w = Event::Warning {
            code: WarningCode::WindowMinimized,
            detail: Some("x".into()),
            t: 1.0,
        };
        assert!(encode_event(&w).contains(r#""code":"window_minimized""#));
        let w = Event::Warning {
            code: WarningCode::SizeChanged,
            detail: None,
            t: 1.0,
        };
        assert!(encode_event(&w).contains(r#""code":"size_changed""#));
        let w = Event::Warning {
            code: WarningCode::FrozenFrames,
            detail: None,
            t: 1.0,
        };
        assert!(encode_event(&w).contains(r#""code":"frozen_frames""#));

        let s = Event::Stopped {
            duration_ms: 5000,
            path: "p".into(),
            frames: 300,
            dropped: 0,
            reason: "stop".into(),
        };
        let v: serde_json::Value = serde_json::from_str(&encode_event(&s)).unwrap();
        assert_eq!(v["ev"], "stopped");
        assert_eq!(v["durationMs"], 5000);

        let e = Event::Error {
            code: "target_not_found".into(),
            message: "m".into(),
        };
        let v: serde_json::Value = serde_json::from_str(&encode_event(&e)).unwrap();
        assert_eq!(v["ev"], "error");
        assert_eq!(v["code"], "target_not_found");
    }

    #[test]
    fn events_are_single_line() {
        let ev = Event::Error {
            code: "x".into(),
            message: "line1\nline2".into(),
        };
        assert!(!encode_event(&ev).contains('\n'));
    }
}
