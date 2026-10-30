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
//!
//! Microphone: a second thread captures the default recording endpoint into a
//! [`MicBuffer`]; every buffer the loopback thread hands to the encoder (real
//! audio or filled silence) has the same number of mic frames mixed in, so the
//! single AAC track carries both. The loopback thread stays the clock; when the
//! system is completely silent (no loopback packets at all) it keeps the track
//! moving with silence so the voice is not lost.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::Duration;

use parking_lot::Mutex;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, EDataFlow, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
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
/// Mic audio buffered beyond this is dropped (oldest first) to bound latency.
const MIC_MAX_BUFFER_MS: usize = 500;
/// With a mic, keep the track moving when loopback is this far behind the clock...
const STALL_FILL_AFTER_MS: i64 = 200;
/// ...filling up to this much behind it (late loopback packets still fit).
const STALL_FILL_KEEP_MS: i64 = 100;

/// Mic samples (interleaved 16-bit stereo) waiting to be mixed into the track.
pub struct MicBuffer {
    q: Mutex<VecDeque<i16>>,
    cap: usize,
}

impl MicBuffer {
    pub fn new(rate: u32) -> Self {
        let cap = rate as usize * 2 * MIC_MAX_BUFFER_MS / 1000;
        MicBuffer { q: Mutex::new(VecDeque::with_capacity(cap)), cap }
    }

    pub fn push(&self, samples: &[i16]) {
        let mut q = self.q.lock();
        q.extend(samples.iter().copied());
        let over = q.len().saturating_sub(self.cap);
        // keep whole stereo frames
        q.drain(..over + over % 2);
    }

    /// Add buffered mic audio to 16-bit stereo PCM in place (saturating). Missing mic
    /// audio counts as silence.
    pub fn mix_into(&self, pcm: &mut [u8]) {
        let mut q = self.q.lock();
        for chunk in pcm.chunks_exact_mut(2) {
            let Some(m) = q.pop_front() else { break };
            let v = i16::from_le_bytes([chunk[0], chunk[1]]).saturating_add(m);
            chunk.copy_from_slice(&v.to_le_bytes());
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.q.lock().len()
    }
}

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
    /// Mixed into every buffer when the mic is on.
    pub mic: Option<Arc<MicBuffer>>,
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
            let client = match Loopback::open(Source::SystemLoopback) {
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

/// Which endpoint a [`Loopback`] reads.
#[derive(Clone, Copy)]
enum Source {
    /// Default render endpoint in loopback: everything the user hears.
    SystemLoopback,
    /// Default recording endpoint, converted to this sample rate.
    Mic { rate: u32 },
}

struct Loopback {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    src: SourceFormat,
    out: AudioFormat,
}

impl Loopback {
    fn open(source: Source) -> Result<Self, String> {
        let (flow, loop_flag, rate): (EDataFlow, _, u32) = match source {
            Source::SystemLoopback => (eRender, AUDCLNT_STREAMFLAGS_LOOPBACK, 48_000),
            Source::Mic { rate } => (eCapture, Default::default(), rate),
        };
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("MMDeviceEnumerator: {e}"))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(flow, eConsole)
                .map_err(|e| format!("no default {} endpoint: {e}", if flow == eRender { "render" } else { "recording" }))?;

            let buffer_hns: i64 = 2_000_000; // 200 ms

            // Preferred path: let the audio engine convert to 48 kHz / 16-bit / stereo.
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| format!("IAudioClient: {e}"))?;
            let want = WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_PCM_TAG,
                nChannels: 2,
                nSamplesPerSec: rate,
                nAvgBytesPerSec: rate * 4,
                nBlockAlign: 4,
                wBitsPerSample: 16,
                cbSize: 0,
            };
            let flags = loop_flag
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
                        sample_rate: rate,
                    },
                    out: AudioFormat {
                        sample_rate: rate,
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
            if let Source::Mic { rate } = source {
                let mix_rate = mix.nSamplesPerSec;
                if mix_rate != rate {
                    CoTaskMemFree(Some(mixp as *const _));
                    return Err(format!("microphone runs at {mix_rate} Hz and cannot be converted to {rate} Hz"));
                }
            }
            let init = client.Initialize(AUDCLNT_SHAREMODE_SHARED, loop_flag, buffer_hns, 0, mixp, None);
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
        let freq = crate::qpc::qpc_frequency();
        let mut sent: i64 = 0; // sample frames handed to the encoder
        let mut pcm: Vec<u8> = Vec::with_capacity(48_000);
        let mix = |buf: &mut [u8]| {
            if let Some(m) = &shared.mic {
                m.mix_into(buf);
            }
        };
        loop {
            if shared.stop.load(Ordering::Relaxed) {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
            // Total silence delivers no loopback packets; with a mic, keep the track moving.
            let first = shared.first_frame_hns.load(Ordering::Acquire);
            if first != 0 && shared.mic.is_some() {
                let expected = ((crate::qpc::now_100ns(freq) - first) as i128 * rate as i128 / 10_000_000i128) as i64;
                if expected - sent > rate * STALL_FILL_AFTER_MS / 1000 {
                    let n = expected - sent - rate * STALL_FILL_KEEP_MS / 1000;
                    let mut buf = vec![0u8; n as usize * 4];
                    mix(&mut buf);
                    let mut guard = shared.sink.lock();
                    if let Some(enc) = guard.as_mut() {
                        if enc.send_audio_buffer(&buf, 0).is_err() {
                            drop(guard);
                            return self.shutdown();
                        }
                        sent += n;
                        shared.samples_sent.store(sent as u64, Ordering::Relaxed);
                    }
                }
            }
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
                                    let mut zeros = vec![0u8; n as usize * 4];
                                    mix(&mut zeros);
                                    if enc.send_audio_buffer(&zeros, 0).is_err() {
                                        drop(guard);
                                        let _ = unsafe { self.capture.ReleaseBuffer(frames) };
                                        return self.shutdown();
                                    }
                                    left -= n;
                                }
                                sent += p.fill_frames;
                            }
                            let slice = &mut pcm[p.skip_frames as usize * 4..];
                            mix(slice);
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

/// Capture the default recording device into `buffer` at `rate`, from video t=0 on.
pub fn spawn_mic(buffer: Arc<MicBuffer>, first_frame_hns: Arc<AtomicI64>, stop: Arc<AtomicBool>, rate: u32) -> Result<AudioHandle, String> {
    let (tx, rx) = mpsc::channel::<Result<AudioFormat, String>>();
    let stop2 = stop.clone();
    let join = std::thread::Builder::new()
        .name("lvr-mic".into())
        .spawn(move || {
            let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            match Loopback::open(Source::Mic { rate }) {
                Ok(client) => {
                    let _ = tx.send(Ok(client.out));
                    client.run_mic(&buffer, &first_frame_hns, &stop2);
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
            if com.is_ok() {
                unsafe { CoUninitialize() };
            }
        })
        .map_err(|e| format!("spawn mic thread: {e}"))?;
    match rx.recv() {
        Ok(Ok(format)) => Ok(AudioHandle { format, mode: "mic", stop, join: Some(join) }),
        Ok(Err(e)) => {
            let _ = join.join();
            Err(e)
        }
        Err(_) => Err("mic thread exited before reporting".into()),
    }
}

impl Loopback {
    fn run_mic(self, buffer: &MicBuffer, first_frame_hns: &AtomicI64, stop: &AtomicBool) {
        let rate = self.out.sample_rate as i64;
        let mut pcm: Vec<u8> = Vec::with_capacity(48_000);
        let mut samples: Vec<i16> = Vec::with_capacity(48_000);
        while !stop.load(Ordering::Relaxed) {
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
                let first = first_frame_hns.load(Ordering::Acquire);
                if first != 0 && frames > 0 {
                    // trim what was captured before video t=0
                    let skip = ((first - qpc as i64).max(0) as i128 * rate as i128 / 10_000_000i128) as usize;
                    if skip < frames as usize {
                        pcm.clear();
                        if flags & AUDCLNT_BUFFERFLAGS_SILENT_BIT != 0 || data.is_null() {
                            pcm.resize(frames as usize * 4, 0);
                        } else {
                            let bytes = unsafe { std::slice::from_raw_parts(data, frames as usize * self.src.block_align as usize) };
                            convert_to_pcm16_stereo(bytes, self.src, &mut pcm);
                        }
                        samples.clear();
                        samples.extend(pcm[skip * 4..].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])));
                        buffer.push(&samples);
                    }
                }
                if unsafe { self.capture.ReleaseBuffer(frames) }.is_err() {
                    return self.shutdown();
                }
            }
        }
        self.shutdown();
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
    fn mic_is_mixed_saturating_and_missing_mic_is_silence() {
        let mic = MicBuffer::new(48_000);
        mic.push(&[1000, -1000, 30_000, 30_000]);
        let mut pcm: Vec<u8> = [500i16, 500, 10_000, -10_000, 7, 7].iter().flat_map(|v| v.to_le_bytes()).collect();
        mic.mix_into(&mut pcm);
        let s: Vec<i16> = pcm.chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(s, vec![1500, -500, i16::MAX, 20_000, 7, 7]);
        assert_eq!(mic.len(), 0);
    }

    #[test]
    fn mic_buffer_drops_oldest_beyond_its_cap() {
        let mic = MicBuffer::new(1000); // cap = 1000 * 2 * 0.5 = 1000 samples
        let data: Vec<i16> = (0..1200).map(|i| i as i16).collect();
        mic.push(&data);
        assert_eq!(mic.len(), 1000);
        let mut pcm = vec![0u8; 4];
        mic.mix_into(&mut pcm);
        assert_eq!(i16::from_le_bytes([pcm[0], pcm[1]]), 200);
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
