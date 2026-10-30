//! One recording session: WGC capture of a window or monitor via
//! `windows-capture`, Media Foundation H.264/HEVC encoding, optional system
//! loopback audio, health detection, and the start/stats/stop lifecycle.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder, VideoSettingsSubType,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings,
    SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::audio::{self, AudioFormat, AudioHandle, AudioShared};
use crate::detect::{luma_grid, DetectorConfig, FrameHealth, Health, GRID_H, GRID_W};
use crate::emit::Emitter;
use crate::hwenc;
use crate::protocol::{Codec, Event, StartParams, Target, WarningCode};
use crate::qpc;
use crate::winenum;

pub type BoxErr = Box<dyn std::error::Error + Send + Sync>;

const HNS_PER_SEC: i64 = 10_000_000;

/// Counters shared between the capture thread and the session.
#[derive(Default)]
pub struct Shared {
    pub frames: AtomicU64,
    pub dropped: AtomicU64,
    /// Inter-frame gaps longer than two frame intervals.
    pub gaps: AtomicU64,
    /// Shared with the audio thread (video t=0 on the QPC 100 ns timeline).
    pub first_frame_hns: Arc<AtomicI64>,
    pub last_frame_hns: AtomicI64,
    /// QPC(now) - first frame SystemRelativeTime, in 100 ns, measured when the first frame reached us.
    pub first_frame_latency_hns: AtomicI64,
    pub width: AtomicU32,
    pub height: AtomicU32,
    pub encoder_ready: AtomicBool,
    /// Shared with the audio thread: sample frames delivered to the encoder.
    pub audio_samples: Arc<AtomicU64>,
}

#[derive(Clone)]
pub struct EncoderCfg {
    pub path: String,
    pub codec: Codec,
    pub fps: u32,
    pub bitrate_bps: u32,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub audio: Option<AudioFormat>,
}

/// Everything the crate hands to `Handler::new` on the capture thread.
pub struct HandlerFlags {
    pub cfg: EncoderCfg,
    pub slot: Arc<Mutex<Option<VideoEncoder>>>,
    pub shared: Arc<Shared>,
    pub emitter: Emitter,
    pub qpc_freq: i64,
}

pub struct Handler {
    f: HandlerFlags,
    health: FrameHealth,
    last_sample_hns: i64,
    next_accept_hns: i64,
    interval_hns: i64,
    locked: Option<(u32, u32)>,
    last_warned_size: Option<(u32, u32)>,
}

impl Handler {
    fn t_secs(&self, hns: i64) -> f64 {
        let first = self.f.shared.first_frame_hns.load(Ordering::Relaxed);
        if first == 0 {
            0.0
        } else {
            (hns - first) as f64 / HNS_PER_SEC as f64
        }
    }

    fn warn(&self, code: WarningCode, detail: Option<String>, hns: i64) {
        self.f.emitter.emit(&Event::Warning {
            code,
            detail,
            t: self.t_secs(hns),
        });
    }

    fn open_encoder(&mut self, frame: &Frame, ts: i64) -> Result<(), BoxErr> {
        // Measure before the (slow, ~0.5 s) encoder setup.
        let now = qpc::now_100ns(self.f.qpc_freq);
        let src_w = frame.width();
        let src_h = frame.height();
        let w = self.f.cfg.width.unwrap_or(src_w).max(2) & !1;
        let h = self.f.cfg.height.unwrap_or(src_h).max(2) & !1;
        if (w, h) != (src_w, src_h) && (self.f.cfg.width.is_some() || self.f.cfg.height.is_some()) {
            self.warn(
                WarningCode::ScaleUnavailable,
                Some(format!(
                    "source {src_w}x{src_h} -> output {w}x{h}: windows-capture 2.0.1 crops/pads on the GPU path, it cannot scale"
                )),
                ts,
            );
        }
        let sub_type = match self.f.cfg.codec {
            Codec::H264 => VideoSettingsSubType::H264,
            Codec::Hevc => VideoSettingsSubType::HEVC,
        };
        let video = VideoSettingsBuilder::new(w, h)
            .sub_type(sub_type)
            .bitrate(self.f.cfg.bitrate_bps)
            .frame_rate(self.f.cfg.fps);
        let audio = match self.f.cfg.audio {
            Some(fmt) => AudioSettingsBuilder::new()
                .sample_rate(fmt.sample_rate)
                .channel_count(fmt.channels as u32)
                .bit_per_sample(fmt.bits as u32)
                .bitrate(192_000),
            None => AudioSettingsBuilder::new().disabled(true),
        };
        let encoder = VideoEncoder::new(video, audio, ContainerSettingsBuilder::new(), &self.f.cfg.path)?;
        *self.f.slot.lock() = Some(encoder);
        self.locked = Some((w, h));
        self.f.shared.width.store(w, Ordering::Relaxed);
        self.f.shared.height.store(h, Ordering::Relaxed);
        self.f.shared.first_frame_latency_hns.store(now - ts, Ordering::Relaxed);
        // Publish first-frame time last: the audio thread starts delivering
        // as soon as it sees a non-zero value and needs the encoder in place.
        self.f.shared.first_frame_hns.store(ts, Ordering::Release);
        self.f.shared.encoder_ready.store(true, Ordering::Release);
        self.last_sample_hns = ts;
        Ok(())
    }

    fn sample_health(&mut self, frame: &mut Frame, ts: i64) {
        let Ok(mut buf) = frame.buffer() else {
            return;
        };
        let pitch = buf.row_pitch();
        let (w, h) = (buf.width(), buf.height());
        let grid = luma_grid(buf.as_raw_buffer(), w, h, pitch, GRID_W, GRID_H);
        drop(buf);
        let t = self.t_secs(ts);
        for ev in self.health.observe(&grid, t) {
            let code = match ev {
                Health::BlackStarted => WarningCode::BlackFrames,
                Health::BlackCleared => WarningCode::BlackFramesCleared,
                Health::FrozenStarted => WarningCode::FrozenFrames,
                Health::FrozenCleared => WarningCode::FrozenFramesCleared,
            };
            self.warn(code, None, ts);
        }
    }
}

impl GraphicsCaptureApiHandler for Handler {
    type Flags = HandlerFlags;
    type Error = BoxErr;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let fps = ctx.flags.cfg.fps.max(1) as i64;
        Ok(Handler {
            f: ctx.flags,
            health: FrameHealth::new(DetectorConfig::default()),
            last_sample_hns: 0,
            next_accept_hns: 0,
            interval_hns: HNS_PER_SEC / fps,
            locked: None,
            last_warned_size: None,
        })
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, _control: InternalCaptureControl) -> Result<(), Self::Error> {
        let ts = frame.timestamp()?.Duration;
        if self.locked.is_none() {
            // Lock the output size to the first frame (or the requested size).
            self.open_encoder(frame, ts)?;
        }

        // Cap the delivery rate at the target fps (WGC can deliver faster on
        // high-refresh monitors when MinUpdateInterval is unsupported).
        if ts < self.next_accept_hns {
            self.f.shared.dropped.fetch_add(1, Ordering::Relaxed);
            return Ok(());
        }

        {
            let mut guard = self.f.slot.lock();
            if let Some(enc) = guard.as_mut() {
                enc.send_frame(frame)?;
            }
        }
        self.f.shared.frames.fetch_add(1, Ordering::Relaxed);
        let prev = self.f.shared.last_frame_hns.swap(ts, Ordering::Relaxed);
        if prev != 0 && ts - prev > 2 * self.interval_hns {
            self.f.shared.gaps.fetch_add(1, Ordering::Relaxed);
        }
        self.next_accept_hns = ts + self.interval_hns * 3 / 4;

        let cur = (frame.width(), frame.height());
        if Some(cur) != self.locked && self.last_warned_size != Some(cur) {
            self.last_warned_size = Some(cur);
            let (lw, lh) = self.locked.unwrap_or(cur);
            self.warn(
                WarningCode::SizeChanged,
                Some(format!("source now {}x{}, output stays {lw}x{lh} (crop/pad)", cur.0, cur.1)),
                ts,
            );
        }

        if ts - self.last_sample_hns >= HNS_PER_SEC {
            self.last_sample_hns = ts;
            self.sample_health(frame, ts);
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        // The crate ends the capture thread; Session::tick notices is_finished().
        Ok(())
    }
}

pub struct Session {
    control: Option<CaptureControl<Handler, BoxErr>>,
    slot: Arc<Mutex<Option<VideoEncoder>>>,
    shared: Arc<Shared>,
    audio: Option<AudioHandle>,
    mic: Option<AudioHandle>,
    audio_shared_stop: Arc<AtomicBool>,
    params: StartParams,
    hwnd: Option<u64>,
    emitter: Emitter,
    qpc_freq: i64,
    start_instant: Instant,
    started_emitted: bool,
    no_frames_warned: bool,
    minimized: bool,
    last_stats: Instant,
    last_stats_frames: u64,
    encoder_hw: Option<String>,
}

pub struct StartError {
    pub code: &'static str,
    pub message: String,
}

fn start_err(code: &'static str, message: impl Into<String>) -> StartError {
    StartError {
        code,
        message: message.into(),
    }
}

enum Item {
    Window(Window, u64),
    Monitor(Monitor),
}

fn resolve_target(target: &Target) -> Result<Item, StartError> {
    let win = |info: Option<crate::protocol::WindowInfo>, what: String| -> Result<Item, StartError> {
        let info = info.ok_or_else(|| start_err("target_not_found", format!("no visible window for {what}")))?;
        Ok(Item::Window(Window::from_raw_hwnd(info.hwnd as usize as *mut c_void), info.hwnd))
    };
    match target {
        Target::Hwnd { hwnd } => {
            if !winenum::hwnd_is_window(*hwnd) {
                return Err(start_err("target_not_found", format!("hwnd {hwnd} is not a window")));
            }
            Ok(Item::Window(Window::from_raw_hwnd(*hwnd as usize as *mut c_void), *hwnd))
        }
        Target::Pid { pid } => win(winenum::find_by_pid(*pid), format!("pid {pid}")),
        Target::WindowTitle { window_title } => win(winenum::find_by_title(window_title), format!("title {window_title:?}")),
        Target::ProcessName { process_name } => {
            win(winenum::find_by_process_name(process_name), format!("process {process_name:?}"))
        }
        Target::Monitor { monitor } => Ok(Item::Monitor(
            winenum::monitor_by_index(*monitor).map_err(|e| start_err("target_not_found", e))?,
        )),
    }
}

impl Session {
    pub fn start(params: StartParams, emitter: Emitter) -> Result<Session, StartError> {
        if params.fps == 0 || params.fps > 240 {
            return Err(start_err("bad_params", "fps must be 1..=240"));
        }
        if !(0.5..=200.0).contains(&params.bitrate_mbps) {
            return Err(start_err("bad_params", "bitrateMbps must be 0.5..=200"));
        }
        if params.out.trim().is_empty() {
            return Err(start_err("bad_params", "out is required"));
        }
        let out_path = std::path::Path::new(&params.out);
        if let Some(parent) = out_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| start_err("bad_params", format!("cannot create {}: {e}", parent.display())))?;
            }
        }

        let item = resolve_target(&params.target)?;
        let hwnd = match &item {
            Item::Window(_, h) => Some(*h),
            Item::Monitor(_) => None,
        };
        let qpc_freq = qpc::qpc_frequency();
        let encoder_hw = hwenc::hardware_encoder_name(params.codec);
        let shared = Arc::new(Shared::default());
        let slot: Arc<Mutex<Option<VideoEncoder>>> = Arc::new(Mutex::new(None));
        let now_t = 0.0;

        // Audio first: the encoder's audio settings must match what we capture.
        let audio_stop = Arc::new(AtomicBool::new(false));
        let mut audio: Option<AudioHandle> = None;
        let mut mic: Option<AudioHandle> = None;
        if params.audio.game {
            // The mic is mixed into the loopback track, so it is opened at the loopback's rate.
            let mic_buf = params.audio.mic.then(|| Arc::new(audio::MicBuffer::new(48_000)));
            match audio::spawn_system_loopback(AudioShared {
                sink: slot.clone(),
                first_frame_hns: shared.first_frame_hns.clone(),
                samples_sent: shared.audio_samples.clone(),
                stop: audio_stop.clone(),
                mic: mic_buf.clone(),
            }) {
                Ok(h) => {
                    if let Some(buf) = mic_buf {
                        match audio::spawn_mic(buf, shared.first_frame_hns.clone(), audio_stop.clone(), h.format.sample_rate) {
                            Ok(m) => mic = Some(m),
                            Err(e) => emitter.emit(&Event::Warning {
                                code: WarningCode::MicUnavailable,
                                detail: Some(e),
                                t: now_t,
                            }),
                        }
                    }
                    audio = Some(h);
                }
                Err(e) => emitter.emit(&Event::Warning {
                    code: WarningCode::AudioUnavailable,
                    detail: Some(e),
                    t: now_t,
                }),
            }
        } else if params.audio.mic {
            emitter.emit(&Event::Warning {
                code: WarningCode::MicUnsupported,
                detail: Some("the mic is mixed into the game audio track; enable game audio".into()),
                t: now_t,
            });
        }

        // Capture settings.
        let cursor = match GraphicsCaptureApi::is_cursor_settings_supported() {
            Ok(true) => {
                if params.cursor {
                    CursorCaptureSettings::WithCursor
                } else {
                    CursorCaptureSettings::WithoutCursor
                }
            }
            _ => {
                if !params.cursor {
                    emitter.emit(&Event::Warning {
                        code: WarningCode::CursorSettingUnsupported,
                        detail: None,
                        t: now_t,
                    });
                }
                CursorCaptureSettings::Default
            }
        };
        let border = match GraphicsCaptureApi::is_border_settings_supported() {
            Ok(true) => {
                if params.border {
                    DrawBorderSettings::WithBorder
                } else {
                    DrawBorderSettings::WithoutBorder
                }
            }
            _ => {
                if !params.border {
                    emitter.emit(&Event::Warning {
                        code: WarningCode::BorderSettingUnsupported,
                        detail: Some("IsBorderRequired needs Windows 11 (build 20348+); the yellow border stays".into()),
                        t: now_t,
                    });
                }
                DrawBorderSettings::Default
            }
        };
        let min_interval = match GraphicsCaptureApi::is_minimum_update_interval_supported() {
            Ok(true) => MinimumUpdateIntervalSettings::Custom(Duration::from_nanos(1_000_000_000 / params.fps as u64)),
            _ => {
                emitter.emit(&Event::Warning {
                    code: WarningCode::MinUpdateIntervalUnsupported,
                    detail: Some("capping at target fps in software instead".into()),
                    t: now_t,
                });
                MinimumUpdateIntervalSettings::Default
            }
        };

        let flags = HandlerFlags {
            cfg: EncoderCfg {
                path: params.out.clone(),
                codec: params.codec,
                fps: params.fps,
                bitrate_bps: (params.bitrate_mbps * 1_000_000.0) as u32,
                width: params.width,
                height: params.height,
                audio: audio.as_ref().map(|a| a.format),
            },
            slot: slot.clone(),
            shared: shared.clone(),
            emitter: emitter.clone(),
            qpc_freq,
        };

        let control_result = match item {
            Item::Window(window, _) => Handler::start_free_threaded(Settings::new(
                window,
                cursor,
                border,
                SecondaryWindowSettings::Default,
                min_interval,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            )),
            Item::Monitor(monitor) => Handler::start_free_threaded(Settings::new(
                monitor,
                cursor,
                border,
                SecondaryWindowSettings::Default,
                min_interval,
                DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            )),
        };
        let control = match control_result {
            Ok(c) => c,
            Err(e) => {
                audio_stop.store(true, Ordering::SeqCst);
                if let Some(m) = mic.take() {
                    m.stop();
                }
                if let Some(a) = audio.take() {
                    a.stop();
                }
                return Err(start_err("capture_start_failed", format!("{e:?}")));
            }
        };

        Ok(Session {
            control: Some(control),
            slot,
            shared,
            audio,
            mic,
            audio_shared_stop: audio_stop,
            params,
            hwnd,
            emitter,
            qpc_freq,
            start_instant: Instant::now(),
            started_emitted: false,
            no_frames_warned: false,
            minimized: hwnd.map(winenum::is_minimized).unwrap_or(false),
            last_stats: Instant::now(),
            last_stats_frames: 0,
            encoder_hw,
        })
    }

    pub fn frames(&self) -> u64 {
        self.shared.frames.load(Ordering::Relaxed)
    }

    pub fn dropped(&self) -> u64 {
        self.shared.dropped.load(Ordering::Relaxed)
    }

    pub fn path(&self) -> &str {
        &self.params.out
    }

    pub fn state(&self) -> &'static str {
        if self.started_emitted {
            "recording"
        } else {
            "starting"
        }
    }

    /// Seconds since the first frame (0 before that).
    pub fn t_secs(&self) -> f64 {
        let first = self.shared.first_frame_hns.load(Ordering::Relaxed);
        if first == 0 {
            0.0
        } else {
            (qpc::now_100ns(self.qpc_freq) - first) as f64 / HNS_PER_SEC as f64
        }
    }

    /// Drive the session; call every ~100 ms. Returns a reason when the
    /// capture has ended on its own (window closed, handler error).
    pub fn tick(&mut self) -> Option<String> {
        let now = Instant::now();
        if !self.started_emitted && self.shared.encoder_ready.load(Ordering::Acquire) {
            self.started_emitted = true;
            self.last_stats = now;
            self.last_stats_frames = self.frames();
            let first = self.shared.first_frame_hns.load(Ordering::Relaxed);
            let enc = match self.params.codec {
                Codec::H264 => "h264_mf",
                Codec::Hevc => "hevc_mf",
            };
            self.emitter.emit(&Event::Started {
                qpc_start: qpc::hns_to_ticks(first, self.qpc_freq),
                qpc_freq: self.qpc_freq,
                qpc_start_sys_rel100ns: first,
                first_frame_latency_ms: self.shared.first_frame_latency_hns.load(Ordering::Relaxed) as f64 / 10_000.0,
                wall_start: qpc::wall_now_rfc3339(),
                encoder: enc.into(),
                encoder_hw: self.encoder_hw.clone(),
                width: self.shared.width.load(Ordering::Relaxed),
                height: self.shared.height.load(Ordering::Relaxed),
                fps: self.params.fps,
                audio: self.audio.is_some(),
                audio_mode: self.audio.as_ref().map(|a| if self.mic.is_some() { format!("{}+mic", a.mode) } else { a.mode.to_string() }),
                path: self.params.out.clone(),
                hwnd: self.hwnd,
            });
        }
        if !self.started_emitted && !self.no_frames_warned && now.duration_since(self.start_instant) > Duration::from_secs(5) {
            self.no_frames_warned = true;
            self.emitter.emit(&Event::Warning {
                code: WarningCode::NoFramesYet,
                detail: Some("no frame in 5 s: window minimized, occluded fullscreen-exclusive, or static".into()),
                t: 0.0,
            });
        }
        if let Some(h) = self.hwnd {
            let m = winenum::is_minimized(h);
            if m != self.minimized {
                self.minimized = m;
                self.emitter.emit(&Event::Warning {
                    code: if m { WarningCode::WindowMinimized } else { WarningCode::WindowRestored },
                    detail: None,
                    t: self.t_secs(),
                });
            }
        }
        if self.started_emitted && now.duration_since(self.last_stats) >= Duration::from_secs(2) {
            let frames = self.frames();
            let dt = now.duration_since(self.last_stats).as_secs_f64();
            let fps_actual = (frames - self.last_stats_frames) as f64 / dt;
            self.last_stats = now;
            self.last_stats_frames = frames;
            let last = self.shared.last_frame_hns.load(Ordering::Relaxed);
            let age_ms = if last == 0 { 0 } else { ((qpc::now_100ns(self.qpc_freq) - last) / 10_000).max(0) as u64 };
            let audio_seconds = self
                .audio
                .as_ref()
                .map(|a| self.shared.audio_samples.load(Ordering::Relaxed) as f64 / a.format.sample_rate as f64)
                .unwrap_or(0.0);
            self.emitter.emit(&Event::Stats {
                frames,
                dropped: self.dropped(),
                t: self.t_secs(),
                fps_actual: (fps_actual * 10.0).round() / 10.0,
                last_frame_age_ms: age_ms,
                audio_seconds: (audio_seconds * 10.0).round() / 10.0,
            });
        }
        if self.control.as_ref().map(|c| c.is_finished()).unwrap_or(true) {
            return Some("capture_ended".into());
        }
        None
    }

    /// Stop capturing, finalize the file, emit `stopped` (or `error`).
    pub fn stop(mut self, reason: &str) -> Event {
        // 1. Audio first so no buffer reaches the encoder after video stops.
        self.audio_shared_stop.store(true, Ordering::SeqCst);
        if let Some(m) = self.mic.take() {
            m.stop();
        }
        if let Some(a) = self.audio.take() {
            a.stop();
        }
        // 2. Stop WGC and join the capture thread.
        let mut detail = String::new();
        if let Some(c) = self.control.take() {
            if let Err(e) = c.stop() {
                detail = format!(": {e:?}");
            }
        }
        // 3. Finalize the MP4 (writes moov).
        let encoder = self.slot.lock().take();
        let frames = self.frames();
        let dropped = self.dropped();
        let first = self.shared.first_frame_hns.load(Ordering::Relaxed);
        let last = self.shared.last_frame_hns.load(Ordering::Relaxed);
        let duration_ms = if first == 0 || last < first { 0 } else { ((last - first) / 10_000) as u64 };
        match encoder {
            Some(enc) => {
                if let Err(e) = enc.finish() {
                    return Event::Error {
                        code: "finalize_failed".into(),
                        message: format!("{e}{detail}"),
                    };
                }
            }
            None => {
                return Event::Error {
                    code: "no_frames".into(),
                    message: format!("no frame was ever captured; nothing written ({reason}{detail})"),
                };
            }
        }
        Event::Stopped {
            duration_ms,
            path: self.params.out.clone(),
            frames,
            dropped,
            reason: format!("{reason}{detail}"),
        }
    }
}
