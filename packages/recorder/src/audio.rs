//! WASAPI **system** loopback capture feeding the crate's AAC encoder.
//!
//! `windows-capture` 2.0.1 only *encodes* audio (`VideoEncoder::send_audio_buffer`
//! takes PCM bytes and stamps them from a monotonic sample counter); it has no
//! capture. So we open the default render endpoint in shared-mode loopback and
//! push 16-bit stereo PCM. This records everything the user hears (Discord
//! included), not just League. Per-process loopback (`ActivateAudioInterfaceAsync`
//! with `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, build 20348+) is the
//! planned upgrade; see the README.
//!
//! Alignment: the encoder's audio clock starts at 0 with the first buffer we
//! send and advances by sample count, so audio time 0 must coincide with video
//! time 0 (the first frame's `SystemRelativeTime`). Each WASAPI packet carries
//! a QPC position on the same 100 ns timeline, so we trim audio captured
//! before the first frame and insert silence whenever the endpoint delivered
//! nothing (shared-mode loopback goes quiet when no app renders audio).

use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::Duration;

use parking_lot::Mutex;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows_capture::encoder::VideoEncoder;

const WAVE_FORMAT_PCM_TAG: u16 = 1;
const WAVE_FORMAT_IEEE_FLOAT_TAG: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE_TAG: u16 = 0xFFFE;
const AUDCLNT_BUFFERFLAGS_SILENT_BIT: u32 = 2;
/// Insert silence when the endpoint fell behind the video clock by more than this.
const GAP_FILL_MS: i64 = 40;
/// Drop audio that runs ahead of the video clock by more than this.
const AHEAD_DROP_MS: i64 = 250;
/// Never synthesise more than this much silence in one go (a sleeping laptop
/// should not produce an hour of zeros).
const MAX_FILL_SECS: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits: u16,
}

#[derive(Debug, Clone, Copy)]
enum SourceSample {
    I16,
    I32,
    F32,
}

#[derive(Debug, Clone, Copy)]
struct SourceFormat {
    sample: SourceSample,
    channels: u16,
    block_align: u16,
    sample_rate: u32,
}

/// Shared state between the audio thread, the capture handler and the session.
pub struct AudioShared {
    pub sink: Arc<Mutex<Option<VideoEncoder>>>,
    /// WGC `SystemRelativeTime` (100 ns) of the first encoded video frame; 0 = none yet.
    pub first_frame_hns: Arc<AtomicI64>,
    /// Sample frames delivered to the encoder so far.
    pub samples_sent: Arc<AtomicU64>,
    pub stop: Arc<AtomicBool>,
}

pub struct AudioHandle {
    pub format: AudioFormat,
    pub mode: &'static str,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl AudioHandle {
    /// Stop capturing and wait for the thread; no more buffers reach the
    /// encoder after this returns.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

/// Start system loopback capture on a dedicated thread. Returns once the
/// endpoint is open (or failed to open) so the caller can configure the
/// encoder's audio settings to match `format`.
pub fn spawn_system_loopback(shared: AudioShared) -> Result<AudioHandle, String> {
    let (tx, rx) = mpsc::channel::<Result<AudioFormat, String>>();
    let stop = shared.stop.clone();
    let join = std::thread::Builder::new()
        .name("lvr-audio".into())
        .spawn(move || {
            // Audio objects are free-threaded; MTA keeps us independent of the
            // WinRT apartment the capture thread sets up.
            let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            let client = match Loopback::open() {
                Ok(c) => c,
                Err(e) => {
                    let _ = tx.send(Err(e));
                    if com.is_ok() {
                        unsafe { CoUninitialize() };
                    }
                    return;
                }
            };
            let _ = tx.send(Ok(client.out));
            client.run(&shared);
            if com.is_ok() {
                unsafe { CoUninitialize() };
            }
        })
        .map_err(|e| format!("spawn audio thread: {e}"))?;

    match rx.recv() {
        Ok(Ok(format)) => Ok(AudioHandle {
            format,
            mode: "system_loopback",
            stop,
            join: Some(join),
        }),
        Ok(Err(e)) => {
            let _ = join.join();
            Err(e)
        }
        Err(_) => Err("audio thread exited before reporting".into()),
    }
}

struct Loopback {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    src: SourceFormat,
    out: AudioFormat,
}

impl Loopback {
    fn open() -> Result<Self, String> {
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("no default render endpoint: {e}"))?;

            let buffer_hns: i64 = 2_000_000; // 200 ms

            // Preferred path: let the audio engine convert to 48 kHz / 16-bit / stereo.
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| format!("IAudioClient: {e}"))?;
            let want = WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_PCM_TAG,
                nChannels: 2,
                nSamplesPerSec: 48_000,
                nAvgBytesPerSec: 48_000 * 4,
                nBlockAlign: 4,
                wBitsPerSample: 16,
                cbSize: 0,
            };
            let flags = AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
            if client
                .Initialize(AUDCLNT_SHAREMODE_SHARED, flags, buffer_hns, 0, &want, None)
                .is_ok()
            {
                let capture: IAudioCaptureClient = client.GetService().map_err(|e| format!("capture client: {e}"))?;
                client.Start().map_err(|e| format!("start: {e}"))?;
                return Ok(Loopback {
                    client,
                    capture,
                    src: SourceFormat {
                        sample: SourceSample::I16,
                        channels: 2,
                        block_align: 4,
                        sample_rate: 48_000,
                    },
                    out: AudioFormat {
                        sample_rate: 48_000,
                        channels: 2,
                        bits: 16,
                    },
                });
            }

            // Fallback: take the mix format and convert on the CPU.
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| format!("IAudioClient: {e}"))?;
            let mixp = client.GetMixFormat().map_err(|e| format!("GetMixFormat: {e}"))?;
            if mixp.is_null() {
                return Err("GetMixFormat returned null".into());
            }
            let mix = *mixp;
            let mut tag = mix.wFormatTag;
            if tag == WAVE_FORMAT_EXTENSIBLE_TAG {
                let ext = *(mixp as *const WAVEFORMATEXTENSIBLE);
                // KSDATAFORMAT_SUBTYPE_PCM = {00000001-...}, _IEEE_FLOAT = {00000003-...}
                tag = ext.SubFormat.data1 as u16;
            }
            let sample = match (tag, mix.wBitsPerSample) {
                (WAVE_FORMAT_PCM_TAG, 16) => SourceSample::I16,
                (WAVE_FORMAT_PCM_TAG, 32) => SourceSample::I32,
                (WAVE_FORMAT_IEEE_FLOAT_TAG, 32) => SourceSample::F32,
                (t, b) => {
                    CoTaskMemFree(Some(mixp as *const _));
                    return Err(format!("unsupported mix format tag={t} bits={b}"));
                }
            };
            let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, buffer_hns, 0, mixp, None);
            let src = SourceFormat {
                sample,
                channels: mix.nChannels,
                block_align: mix.nBlockAlign,
                sample_rate: mix.nSamplesPerSec,
            };
            CoTaskMemFree(Some(mixp as *const _));
            init.map_err(|e| format!("Initialize(loopback, mix format): {e}"))?;
            let capture: IAudioCaptureClient = client.GetService().map_err(|e| format!("capture client: {e}"))?;
            client.Start().map_err(|e| format!("start: {e}"))?;
            Ok(Loopback {
                client,
                capture,
                src,
                out: AudioFormat {
                    sample_rate: src.sample_rate,
                    channels: 2,
                    bits: 16,
                },
            })
        }
    }

    fn run(self, shared: &AudioShared) {
        let rate = self.out.sample_rate as i64;
        let mut sent: i64 = 0; // sample frames handed to the encoder
        let mut pcm: Vec<u8> = Vec::with_capacity(48_000);
        loop {
            if shared.stop.load(Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
            loop {
                let packet = match unsafe { self.capture.GetNextPacketSize() } {
                    Ok(n) => n,
                    Err(_) => return self.shutdown(),
                };
                if packet == 0 {
                    break;
                }
                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames: u32 = 0;
                let mut flags: u32 = 0;
                let mut qpc: u64 = 0;
                if unsafe { self.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc)) }.is_err() {
                    return self.shutdown();
                }
                let first = shared.first_frame_hns.load(Ordering::Acquire);
                if first != 0 && frames > 0 {
                    pcm.clear();
                    if flags & AUDCLNT_BUFFERFLAGS_SILENT_BIT != 0 || data.is_null() {
                        pcm.resize(frames as usize * 4, 0);
                    } else {
                        let bytes = unsafe {
                            std::slice::from_raw_parts(data, frames as usize * self.src.block_align as usize)
                        };
                        convert_to_pcm16_stereo(bytes, self.src, &mut pcm);
                    }
                    let plan = plan_delivery(qpc as i64, first, rate, sent, frames as i64);
                    if let Some(p) = plan {
                        let mut guard = shared.sink.lock();
                        if let Some(enc) = guard.as_mut() {
                            if p.fill_frames > 0 {
                                // Chunk silence into <= 1 s buffers.
                                let mut left = p.fill_frames;
                                while left > 0 {
                                    let n = left.min(rate);
                                    let zeros = vec![0u8; n as usize * 4];
                                    if enc.send_audio_buffer(&zeros, 0).is_err() {
                                        drop(guard);
                                        let _ = unsafe { self.capture.ReleaseBuffer(frames) };
                                        return self.shutdown();
                                    }
                                    left -= n;
                                }
                                sent += p.fill_frames;
                            }
                            let slice = &pcm[p.skip_frames as usize * 4..];
                            if !slice.is_empty() {
                                if enc.send_audio_buffer(slice, 0).is_err() {
                                    drop(guard);
                                    let _ = unsafe { self.capture.ReleaseBuffer(frames) };
                                    return self.shutdown();
                                }
                                sent += (slice.len() / 4) as i64;
                            }
                        }
                        shared.samples_sent.store(sent as u64, Ordering::Relaxed);
                    }
                }
                if unsafe { self.capture.ReleaseBuffer(frames) }.is_err() {
                    return self.shutdown();
                }
            }
        }
        self.shutdown();
    }

    fn shutdown(&self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }
}

/// How to deliver one packet relative to the video clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Delivery {
    /// Leading sample frames of this packet to discard (captured before video t=0).
    pub skip_frames: i64,
    /// Silence frames to insert before the packet so audio catches up with video time.
    pub fill_frames: i64,
}

/// Pure scheduling helper (unit-tested): given the packet's QPC position,
/// video t=0 on the same timeline, the output rate, how many frames we have
/// already sent and the packet length, decide what to skip/fill. `None` means
/// drop the whole packet (it is too far ahead of the video clock).
pub fn plan_delivery(pkt_qpc_hns: i64, first_hns: i64, rate: i64, sent: i64, frames: i64) -> Option<Delivery> {
    // Where this packet should start, in sample frames since video t=0.
    let mut start = ((pkt_qpc_hns - first_hns) as i128 * rate as i128 / 10_000_000i128) as i64;
    let mut skip = 0i64;
    if start < 0 {
        skip = -start;
        if skip >= frames {
            return None;
        }
        start = 0;
    }
    let gap = start - sent;
    if gap > rate * GAP_FILL_MS / 1000 {
        let fill = gap.min(rate * MAX_FILL_SECS);
        return Some(Delivery {
            skip_frames: skip,
            fill_frames: fill,
        });
    }
    if gap < -(rate * AHEAD_DROP_MS / 1000) {
        return None;
    }
    Some(Delivery {
        skip_frames: skip,
        fill_frames: 0,
    })
}

/// Convert interleaved source samples to 16-bit little-endian stereo. Mono is
/// duplicated; more than two channels keep the first two (front L/R).
fn convert_to_pcm16_stereo(bytes: &[u8], src: SourceFormat, out: &mut Vec<u8>) {
    let ch = src.channels.max(1) as usize;
    let frames = bytes.len() / src.block_align.max(1) as usize;
    out.reserve(frames * 4);
    let sample_bytes = match src.sample {
        SourceSample::I16 => 2,
        SourceSample::I32 | SourceSample::F32 => 4,
    };
    for f in 0..frames {
        let base = f * src.block_align as usize;
        let mut lr = [0i16; 2];
        for (i, slot) in lr.iter_mut().enumerate() {
            let c = if ch == 1 { 0 } else { i };
            let off = base + c * sample_bytes;
            *slot = match src.sample {
                SourceSample::I16 => i16::from_le_bytes([bytes[off], bytes[off + 1]]),
                SourceSample::I32 => {
                    (i32::from_le_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]]) >> 16) as i16
                }
                SourceSample::F32 => {
                    let v = f32::from_le_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]]);
                    (v.clamp(-1.0, 1.0) * 32767.0) as i16
                }
            };
        }
        out.extend_from_slice(&lr[0].to_le_bytes());
        out.extend_from_slice(&lr[1].to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: i64 = 48_000;

    #[test]
    fn packet_before_first_frame_is_trimmed_or_dropped() {
        // Packet spans 10 ms before t=0 ... fully before: drop.
        let first = 10_000_000; // 1 s
        assert_eq!(plan_delivery(first - 200_000, first, R, 0, 480), None);
        // Straddles t=0 by 5 ms: skip 240 frames.
        let d = plan_delivery(first - 50_000, first, R, 0, 480).unwrap();
        assert_eq!(d.skip_frames, 240);
        assert_eq!(d.fill_frames, 0);
    }

    #[test]
    fn contiguous_packets_need_no_fill() {
        let first = 5_000_000;
        let d = plan_delivery(first, first, R, 0, 480).unwrap();
        assert_eq!(d, Delivery { skip_frames: 0, fill_frames: 0 });
        // next packet 10 ms later, 480 frames already sent
        let d = plan_delivery(first + 100_000, first, R, 480, 480).unwrap();
        assert_eq!(d.fill_frames, 0);
    }

    #[test]
    fn silence_is_filled_after_endpoint_went_quiet() {
        let first = 0;
        // 2 s of nothing, then a packet at t=2 s with only 480 frames sent.
        let d = plan_delivery(20_000_000, first, R, 480, 480).unwrap();
        assert_eq!(d.fill_frames, 2 * R - 480);
        // Fill is capped.
        let d = plan_delivery(10_000_000 * 3600, first, R, 0, 480).unwrap();
        assert_eq!(d.fill_frames, R * MAX_FILL_SECS);
    }

    #[test]
    fn audio_far_ahead_is_dropped_but_jitter_is_kept() {
        let first = 0;
        // Sent 1 s of audio but the clock says only 0.5 s elapsed: drop.
        assert_eq!(plan_delivery(5_000_000, first, R, R, 480), None);
        // 20 ms ahead is jitter: keep.
        assert!(plan_delivery(5_000_000, first, R, R / 2 + R * 20 / 1000, 480).is_some());
    }

    #[test]
    fn converts_float_stereo() {
        let src = SourceFormat { sample: SourceSample::F32, channels: 2, block_align: 8, sample_rate: 48_000 };
        let mut bytes = Vec::new();
        for v in [0.0f32, 1.0, -1.0, 0.5] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        let mut out = Vec::new();
        convert_to_pcm16_stereo(&bytes, src, &mut out);
        assert_eq!(out.len(), 8);
        let s: Vec<i16> = out.chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(s, vec![0, 32767, -32767, 16383]);
    }

    #[test]
    fn converts_mono_i16_by_duplicating_and_surround_by_taking_front() {
        let mono = SourceFormat { sample: SourceSample::I16, channels: 1, block_align: 2, sample_rate: 48_000 };
        let mut out = Vec::new();
        convert_to_pcm16_stereo(&1000i16.to_le_bytes(), mono, &mut out);
        assert_eq!(out, [1000i16.to_le_bytes(), 1000i16.to_le_bytes()].concat());

        let six = SourceFormat { sample: SourceSample::I16, channels: 6, block_align: 12, sample_rate: 48_000 };
        let mut bytes = Vec::new();
        for v in [1i16, 2, 3, 4, 5, 6] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        out.clear();
        convert_to_pcm16_stereo(&bytes, six, &mut out);
        assert_eq!(out, [1i16.to_le_bytes(), 2i16.to_le_bytes()].concat());
    }

    #[test]
    fn converts_i32_by_truncation() {
        let src = SourceFormat { sample: SourceSample::I32, channels: 2, block_align: 8, sample_rate: 48_000 };
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(i32::MAX).to_le_bytes());
        bytes.extend_from_slice(&(i32::MIN).to_le_bytes());
        let mut out = Vec::new();
        convert_to_pcm16_stereo(&bytes, src, &mut out);
        let s: Vec<i16> = out.chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(s, vec![i16::MAX, i16::MIN]);
    }
}
