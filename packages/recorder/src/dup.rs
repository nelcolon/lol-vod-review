//! DXGI Desktop Duplication capture: copies the composed image of the game's monitor and
//! crops it to the game's client area, all on the GPU.
//!
//! Why not WGC: capturing a window (or monitor) with Windows Graphics Capture makes DWM
//! compose the game, so it loses independent flip. In our PresentMon runs that added ~10 ms
//! present-to-display latency and cost 3-4 % of the 1 % lows; with duplication the game kept
//! independent flip and matched the no-recording baseline (tools/bakeoff/Run-PerfAB.ps1
//! -Compare methods).
//!
//! Duplication sees the whole screen, so while the game is not the foreground window (alt-tab
//! to Discord, a browser...) we record a "not in focus" card instead of the screen. The same
//! card covers the gaps while duplication reconnects after a mode change or a UAC prompt.
//!
//! One D3D11 device on the monitor's adapter lives for the whole session: the encoder may
//! still be holding textures from it when duplication has to be recreated.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::{w, Interface};
use windows::Foundation::TimeSpan;
use windows::Graphics::DirectX::Direct3D11::IDirect3DSurface;
use windows::Win32::Foundation::{HMODULE, HWND, POINT, RECT};
use windows::Win32::Graphics::Direct2D::Common::{D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_PIXEL_FORMAT, D2D_RECT_F};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, ID2D1Factory, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_FACTORY_TYPE_MULTI_THREADED,
    D2D1_FEATURE_LEVEL_DEFAULT, D2D1_RENDER_TARGET_PROPERTIES, D2D1_RENDER_TARGET_TYPE_DEFAULT,
    D2D1_RENDER_TARGET_USAGE_NONE,
};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11RenderTargetView, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL,
    DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_MEASURING_MODE_NATURAL,
    DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_TEXT_ALIGNMENT_CENTER,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_MODE_ROTATION_IDENTITY, DXGI_MODE_ROTATION_UNSPECIFIED, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1, IDXGIOutput5, IDXGIOutputDuplication, IDXGIResource,
    IDXGISurface, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Gdi::{ClientToScreen, GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11SurfaceFromDXGISurface;
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetForegroundWindow, IsWindow};

use crate::capture::{BoxErr, HandlerFlags};
use crate::detect::{luma_grid, DetectorConfig, FrameHealth, GRID_H, GRID_W};
use crate::protocol::WarningCode;
use crate::qpc;

const HNS_PER_SEC: i64 = 10_000_000;
/// Output textures in rotation. The encoder's frame queue is unbounded and the transcoder
/// reads a surface when it pulls it, so a texture must not be drawn again too soon.
const RING: usize = 8;
const START_TIMEOUT: Duration = Duration::from_secs(3);
const CARD_TITLE: &str = "League of Legends is not in focus";
const CARD_TEXT: &str = "Other windows are not recorded. Recording resumes when you return to the game.";

#[derive(Clone, Copy, Debug)]
pub enum DupTarget {
    /// Record this window's client area; show the card while it is not in the foreground.
    Window(u64),
    /// Record this whole monitor (raw HMONITOR).
    Monitor(usize),
}

pub struct DupHandle {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<Result<(), BoxErr>>,
}

impl DupHandle {
    pub fn is_finished(&self) -> bool {
        self.thread.is_finished()
    }

    pub fn stop(self) -> Result<(), String> {
        trace("stop requested");
        self.stop.store(true, Ordering::SeqCst);
        let joined = self.thread.join();
        trace("joined");
        match joined {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(e.to_string()),
            Err(_) => Err("duplication thread panicked".into()),
        }
    }
}

/// Start duplicating. Returns once the duplication is open (or why it could not be), so the
/// caller can fall back to WGC; the encoder opens on the first frame.
pub fn start(flags: HandlerFlags, target: DupTarget) -> Result<DupHandle, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let thread = {
        let stop = stop.clone();
        std::thread::Builder::new()
            .name("lvr-dup".into())
            .spawn(move || run(flags, target, stop, ready_tx))
            .map_err(|e| format!("spawn: {e}"))?
    };
    match ready_rx.recv_timeout(START_TIMEOUT) {
        Ok(Ok(())) => Ok(DupHandle { stop, thread }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            let _ = thread.join();
            Err("timed out opening the duplication".into())
        }
    }
}

/// `LVR_DUP_TRACE=1`: step-by-step trace on stderr, for diagnosing start/stop problems.
pub fn trace(msg: &str) {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if *ON.get_or_init(|| std::env::var_os("LVR_DUP_TRACE").is_some()) {
        eprintln!("[dup {:?}] {msg}", Instant::now());
    }
}

fn hwnd_of(raw: u64) -> HWND {
    HWND(raw as usize as *mut std::ffi::c_void)
}

/// Is the game in front? While focus moves Windows briefly reports no foreground window;
/// keep the previous answer then rather than flashing the card.
fn game_in_front(hwnd: Option<u64>, prev: bool) -> bool {
    let Some(h) = hwnd else { return true };
    let fg = unsafe { GetForegroundWindow() };
    if fg.0.is_null() {
        prev
    } else {
        fg == hwnd_of(h)
    }
}

fn monitor_of(target: DupTarget) -> HMONITOR {
    match target {
        DupTarget::Window(h) => unsafe { MonitorFromWindow(hwnd_of(h), MONITOR_DEFAULTTONEAREST) },
        DupTarget::Monitor(m) => HMONITOR(m as *mut std::ffi::c_void),
    }
}

fn monitor_rect(m: HMONITOR) -> Option<RECT> {
    let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe { GetMonitorInfoW(m, &mut info) }.as_bool().then_some(info.rcMonitor)
}

/// The adapter output that drives `m`, and a device on that adapter (no cross-adapter copies).
fn device_for(m: HMONITOR) -> Result<(ID3D11Device, ID3D11DeviceContext, IDXGIOutput1), String> {
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(|e| format!("CreateDXGIFactory1: {e}"))?;
        let mut i = 0;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            i += 1;
            let mut j = 0;
            while let Ok(output) = adapter.EnumOutputs(j) {
                j += 1;
                let Ok(desc) = output.GetDesc() else { continue };
                if desc.Monitor != m {
                    continue;
                }
                let output: IDXGIOutput1 = output.cast().map_err(|e| format!("IDXGIOutput1: {e}"))?;
                let (device, context) = create_device(&adapter)?;
                return Ok((device, context, output));
            }
        }
    }
    Err("no DXGI output drives the game's monitor".into())
}

fn create_device(adapter: &IDXGIAdapter1) -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(|e| format!("D3D11CreateDevice: {e}"))?;
    }
    let (device, context): (ID3D11Device, ID3D11DeviceContext) = (device.ok_or("no device")?, context.ok_or("no context")?);
    // The Media Foundation transcoder works with our textures from its own threads, on this
    // device's immediate context; without the lock the two sides race (seen as hangs at stop).
    let mt: ID3D11Multithread = context.cast().map_err(|e| format!("ID3D11Multithread: {e}"))?;
    unsafe {
        let _ = mt.SetMultithreadProtected(true);
    }
    Ok((device, context))
}

fn duplicate(output: &IDXGIOutput1, device: &ID3D11Device) -> windows::core::Result<IDXGIOutputDuplication> {
    unsafe {
        // DuplicateOutput1 lets us ask for BGRA (HDR desktops otherwise come as FP16); it needs
        // a per-monitor-aware process. The original call always returns BGRA.
        if let Ok(o5) = output.cast::<IDXGIOutput5>() {
            if let Ok(d) = o5.DuplicateOutput1(device, 0, &[DXGI_FORMAT_B8G8R8A8_UNORM]) {
                return Ok(d);
            }
        }
        output.DuplicateOutput(device)
    }
}

/// The game's client area in duplication-texture coordinates, clamped to the texture.
fn client_box(hwnd: u64, mon: &RECT, tex_w: u32, tex_h: u32) -> Option<D3D11_BOX> {
    let h = hwnd_of(hwnd);
    let mut rc = RECT::default();
    let mut origin = POINT::default();
    unsafe {
        GetClientRect(h, &mut rc).ok()?;
        if !ClientToScreen(h, &mut origin).as_bool() {
            return None;
        }
    }
    let l = (origin.x - mon.left).clamp(0, tex_w as i32);
    let t = (origin.y - mon.top).clamp(0, tex_h as i32);
    let r = (origin.x - mon.left + rc.right).clamp(0, tex_w as i32);
    let b = (origin.y - mon.top + rc.bottom).clamp(0, tex_h as i32);
    (r - l >= 2 && b - t >= 2).then_some(D3D11_BOX {
        left: l as u32,
        top: t as u32,
        front: 0,
        right: r as u32,
        bottom: b as u32,
        back: 1,
    })
}

struct Target2D {
    tex: ID3D11Texture2D,
    rtv: ID3D11RenderTargetView,
    surface: IDirect3DSurface,
}

fn target_texture(device: &ID3D11Device, w: u32, h: u32) -> Result<Target2D, BoxErr> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: w,
        Height: h,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    unsafe {
        let mut tex = None;
        device.CreateTexture2D(&desc, None, Some(&mut tex))?;
        let tex = tex.ok_or("CreateTexture2D returned nothing")?;
        let mut rtv = None;
        device.CreateRenderTargetView(&tex, None, Some(&mut rtv))?;
        let surface: IDirect3DSurface = CreateDirect3D11SurfaceFromDXGISurface(&tex.cast::<IDXGISurface>()?)?.cast()?;
        Ok(Target2D { tex, rtv: rtv.ok_or("CreateRenderTargetView returned nothing")?, surface })
    }
}

/// Black card with a centred notice, drawn once with Direct2D on the GPU.
fn draw_card(t: &Target2D, w: u32, h: u32) -> windows::core::Result<()> {
    unsafe {
        let factory: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_MULTI_THREADED, None)?;
        let props = D2D1_RENDER_TARGET_PROPERTIES {
            r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
            pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
            dpiX: 96.0,
            dpiY: 96.0,
            usage: D2D1_RENDER_TARGET_USAGE_NONE,
            minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
        };
        let rt = factory.CreateDxgiSurfaceRenderTarget(&t.tex.cast::<IDXGISurface>()?, &props)?;
        let dw: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
        let (wf, hf) = (w as f32, h as f32);
        let title_size = (hf / 22.0).max(14.0);
        let text_size = (hf / 48.0).max(10.0);
        let title_fmt = dw.CreateTextFormat(
            w!("Segoe UI"),
            None,
            DWRITE_FONT_WEIGHT_SEMI_BOLD,
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            title_size,
            w!(""),
        )?;
        let text_fmt = dw.CreateTextFormat(
            w!("Segoe UI"),
            None,
            DWRITE_FONT_WEIGHT_NORMAL,
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            text_size,
            w!(""),
        )?;
        for f in [&title_fmt, &text_fmt] {
            f.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER)?;
            f.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER)?;
        }
        let title_brush = rt.CreateSolidColorBrush(&D2D1_COLOR_F { r: 0.85, g: 0.85, b: 0.85, a: 1.0 }, None)?;
        let text_brush = rt.CreateSolidColorBrush(&D2D1_COLOR_F { r: 0.55, g: 0.55, b: 0.55, a: 1.0 }, None)?;
        let title: Vec<u16> = CARD_TITLE.encode_utf16().collect();
        let text: Vec<u16> = CARD_TEXT.encode_utf16().collect();
        let mid = hf / 2.0;
        rt.BeginDraw();
        rt.Clear(Some(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }));
        rt.DrawText(
            &title,
            &title_fmt,
            &D2D_RECT_F { left: 0.0, top: mid - title_size * 1.6, right: wf, bottom: mid },
            &title_brush,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
        rt.DrawText(
            &text,
            &text_fmt,
            &D2D_RECT_F { left: 0.0, top: mid + text_size * 0.3, right: wf, bottom: mid + text_size * 2.2 },
            &text_brush,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
        rt.EndDraw(None, None)
    }
}

/// Health check on a centre crop of `src` (a ninth of it, at most 640x360, like the WGC path).
fn sample_grid(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    staging: &mut Option<(ID3D11Texture2D, u32, u32)>,
    src: &ID3D11Texture2D,
    w: u32,
    h: u32,
    crop: bool,
) -> Option<Vec<u8>> {
    let (cw, ch) = if crop && w >= 64 && h >= 64 { ((w / 3).min(640) & !1, (h / 3).min(360) & !1) } else { (w, h) };
    let (x0, y0) = ((w - cw) / 2, (h - ch) / 2);
    unsafe {
        if staging.as_ref().map(|s| (s.1, s.2)) != Some((cw, ch)) {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: cw,
                Height: ch,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut tex = None;
            device.CreateTexture2D(&desc, None, Some(&mut tex)).ok()?;
            *staging = Some((tex?, cw, ch));
        }
        let st = &staging.as_ref()?.0;
        let b = D3D11_BOX { left: x0, top: y0, front: 0, right: x0 + cw, bottom: y0 + ch, back: 1 };
        context.CopySubresourceRegion(st, 0, 0, 0, 0, src, 0, Some(&b));
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context.Map(st, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).ok()?;
        let len = (mapped.RowPitch * (ch - 1) + cw * 4) as usize;
        let pixels = std::slice::from_raw_parts(mapped.pData as *const u8, len);
        let grid = luma_grid(pixels, cw, ch, mapped.RowPitch, GRID_W, GRID_H);
        context.Unmap(st, 0);
        Some(grid)
    }
}

/// What the last sent frame was, so a quiet screen can be repeated.
#[derive(Clone, Copy, PartialEq)]
enum Shown {
    Nothing,
    Ring(usize),
    Card,
}

fn run(
    f: HandlerFlags,
    target: DupTarget,
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<(), String>>,
) -> Result<(), BoxErr> {
    trace("thread start");
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        // Physical pixels for the window and monitor rectangles; DuplicateOutput1 wants it per process.
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let fail = |msg: String| {
        let _ = ready.send(Err(msg));
        Ok(())
    };
    let mut monitor = monitor_of(target);
    let Some(mut mon_rect) = monitor_rect(monitor) else {
        return fail("cannot read the monitor's rectangle".into());
    };
    trace("device_for");
    let (device, context, mut output) = match device_for(monitor) {
        Ok(d) => d,
        Err(e) => return fail(e),
    };
    trace("duplicate");
    let mut dupl = match duplicate(&output, &device) {
        Ok(d) => Some(d),
        Err(e) => return fail(format!("DuplicateOutput: {e}")),
    };
    let rotation = unsafe { dupl.as_ref().unwrap().GetDesc() }.Rotation;
    if rotation != DXGI_MODE_ROTATION_IDENTITY && rotation != DXGI_MODE_ROTATION_UNSPECIFIED {
        return fail("the game's monitor is rotated".into());
    }
    let _ = ready.send(Ok(()));
    trace("ready");

    let hwnd = match target {
        DupTarget::Window(h) => Some(h),
        DupTarget::Monitor(_) => None,
    };
    let interval = HNS_PER_SEC / f.cfg.fps.max(1) as i64;
    // A frame slot with no screen update is filled by repeating the last frame this late.
    let repeat_slack = interval / 4;
    let mut health = FrameHealth::new(DetectorConfig::default());
    let mut staging = None;
    let mut ring: Vec<Target2D> = Vec::new();
    let mut card: Option<Target2D> = None;
    let mut locked: Option<(u32, u32)> = None;
    let mut next_ring = 0usize;
    let mut shown = Shown::Nothing;
    let mut next_due: i64 = 0;
    let mut last_ts: i64 = 0;
    let mut last_health: i64 = 0;
    let mut focused = true;
    let mut lost_since: Option<Instant> = None;
    let mut last_size: Option<(u32, u32)> = None;
    let mut last_monitor_check = Instant::now();
    let mut counts = [0u64; 4]; // fresh, repeat, card, re-anchored

    while !stop.load(Ordering::Relaxed) {
        if let Some(h) = hwnd {
            if !unsafe { IsWindow(Some(hwnd_of(h))) }.as_bool() {
                return Ok(()); // the game closed; the session notices the thread ended
            }
            // The window moved to another monitor: follow it if the same adapter drives it.
            if last_monitor_check.elapsed() >= Duration::from_secs(1) {
                last_monitor_check = Instant::now();
                let m = monitor_of(target);
                if m != monitor {
                    if let (Ok((_, _, o)), Some(r)) = (device_for(m), monitor_rect(m)) {
                        if let Ok(d) = duplicate(&o, &device) {
                            (monitor, mon_rect, output, dupl) = (m, r, o, Some(d));
                        }
                    }
                }
            }
        }

        // Reconnect after ACCESS_LOST (mode change, UAC secure desktop, fullscreen switch).
        if dupl.is_none() {
            match duplicate(&output, &device) {
                Ok(d) => {
                    dupl = Some(d);
                    if let Some(t0) = lost_since.take() {
                        let ts = qpc::now_100ns(f.qpc_freq);
                        f.warn(WarningCode::DuplicationRestored, Some(format!("after {} ms", t0.elapsed().as_millis())), ts);
                    }
                }
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
        }

        // Grab the latest composed frame (accumulated updates collapse into one).
        let mut copied_ts: Option<i64> = None;
        if let Some(d) = dupl.as_ref() {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut res: Option<IDXGIResource> = None;
            let wait_ms = if locked.is_some() {
                // 0 when a slot is already overdue: AcquireNextFrame waits in system-timer ticks
                // (often 15.6 ms), so even 1 ms would put us a whole frame behind.
                ((next_due + repeat_slack - qpc::now_100ns(f.qpc_freq)) / 10_000).clamp(0, 100) as u32
            } else {
                100
            };
            match unsafe { d.AcquireNextFrame(wait_ms, &mut info, &mut res) } {
                Ok(()) => {
                    let now = qpc::now_100ns(f.qpc_freq);
                    let ts = if info.LastPresentTime != 0 { qpc::ticks_to_100ns(info.LastPresentTime, f.qpc_freq).min(now) } else { now };
                    let src: Option<ID3D11Texture2D> = res.and_then(|r| r.cast().ok());
                    if let Some(src) = src {
                        let mut sd = D3D11_TEXTURE2D_DESC::default();
                        unsafe { src.GetDesc(&mut sd) };
                        let area = match hwnd {
                            Some(h) => client_box(h, &mon_rect, sd.Width, sd.Height),
                            None => Some(D3D11_BOX { left: 0, top: 0, front: 0, right: sd.Width, bottom: sd.Height, back: 1 }),
                        };
                        if locked.is_none() {
                            if let Some(a) = area {
                                trace("open_encoder");
                                let (w, h) = f.open_encoder(a.right - a.left, a.bottom - a.top, ts)?;
                                trace("encoder open");
                                for _ in 0..RING {
                                    ring.push(target_texture(&device, w, h)?);
                                }
                                let c = target_texture(&device, w, h)?;
                                if draw_card(&c, w, h).is_err() {
                                    unsafe { context.ClearRenderTargetView(&c.rtv, &[0.0, 0.0, 0.0, 1.0]) };
                                }
                                card = Some(c);
                                trace("card drawn");
                                locked = Some((w, h));
                                last_health = ts;
                                next_due = ts;
                            }
                        }
                        let fg = game_in_front(hwnd, focused);
                        if let (Some((lw, lh)), Some(a), true, true) = (locked, area, fg, ts >= next_due) {
                            let (aw, ah) = (a.right - a.left, a.bottom - a.top);
                            let t = &ring[next_ring];
                            unsafe {
                                if (aw, ah) != (lw, lh) {
                                    context.ClearRenderTargetView(&t.rtv, &[0.0, 0.0, 0.0, 1.0]);
                                }
                                let b = D3D11_BOX { right: a.left + aw.min(lw), bottom: a.top + ah.min(lh), ..a };
                                context.CopySubresourceRegion(&t.tex, 0, 0, 0, 0, &src, 0, Some(&b));
                            }
                            if (aw, ah) != (lw, lh) && last_size != Some((aw, ah)) {
                                f.warn(
                                    WarningCode::SizeChanged,
                                    Some(format!("source now {aw}x{ah}, output stays {lw}x{lh} (crop/pad)")),
                                    ts,
                                );
                            }
                            last_size = Some((aw, ah));
                            copied_ts = Some(ts);
                        }
                    }
                    unsafe {
                        let _ = d.ReleaseFrame();
                    }
                }
                Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => {}
                Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => {
                    dupl = None;
                    lost_since = Some(Instant::now());
                    f.warn(WarningCode::DuplicationLost, None, qpc::now_100ns(f.qpc_freq));
                }
                Err(e) => return Err(format!("AcquireNextFrame: {e}").into()),
            }
        }

        let Some((lw, lh)) = locked else { continue };
        let now = qpc::now_100ns(f.qpc_freq);
        let fg = game_in_front(hwnd, focused) && dupl.is_some();
        if hwnd.is_some() && fg != focused {
            focused = fg;
            f.warn(if fg { WarningCode::FocusRestored } else { WarningCode::FocusLost }, None, now);
        }

        // Decide what this frame slot shows: the fresh copy, the card, or a repeat when the
        // screen was quiet for a whole frame.
        let send: Option<(Shown, i64)> = if let Some(ts) = copied_ts {
            let i = next_ring;
            next_ring = (next_ring + 1) % RING;
            Some((Shown::Ring(i), ts))
        } else if now >= next_due + repeat_slack {
            // Repeats are stamped on their slot, so a late wake-up (timer granularity) still
            // yields a steady frame rate; after a long stall, re-anchor to now instead.
            let slot = if now - next_due > 4 * interval { now } else { next_due };
            if !fg {
                Some((Shown::Card, slot))
            } else if let Shown::Ring(i) = shown {
                Some((Shown::Ring(i), slot))
            } else {
                None
            }
        } else {
            None
        };
        let Some((what, ts)) = send else { continue };
        counts[match (what, copied_ts.is_some()) { (_, true) => 0, (Shown::Card, _) => 2, _ => 1 }] += 1;
        if next_due + interval < ts.max(last_ts + 1) {
            counts[3] += 1;
        }
        let ts = ts.max(last_ts + 1);
        let surface = match what {
            Shown::Ring(i) => &ring[i].surface,
            Shown::Card => &card.as_ref().expect("card exists once locked").surface,
            Shown::Nothing => continue,
        };
        {
            let mut guard = f.slot.lock();
            if let Some(enc) = guard.as_mut() {
                enc.send_directx_surface(surface, TimeSpan { Duration: ts })?;
            }
        }
        if last_ts == 0 {
            trace("first frame sent");
        }
        f.count_frame(ts, interval);
        shown = what;
        last_ts = ts;
        // Frame slots on a fixed grid (the screen updates at its refresh rate, often far above
        // the target fps); re-anchor after a stall instead of bursting to catch up.
        next_due = if next_due + interval < ts { ts + interval } else { next_due + interval };

        let every = f.cfg.health_every_hns;
        if let (Shown::Ring(i), true) = (what, every > 0 && ts - last_health >= every) {
            last_health = ts;
            if let Some(grid) = sample_grid(&device, &context, &mut staging, &ring[i].tex, lw, lh, f.cfg.health_crop) {
                f.report_health(&mut health, &grid, ts);
            }
        }

        // Sleep until shortly before the next frame is due; updates accumulate meanwhile and
        // the next AcquireNextFrame returns the latest one.
        let ahead = (next_due - qpc::now_100ns(f.qpc_freq)) / 10_000 - 2;
        if ahead > 0 {
            std::thread::sleep(Duration::from_millis(ahead as u64));
        }
    }
    trace(&format!("thread exit: fresh {} repeat {} card {} re-anchored {}", counts[0], counts[1], counts[2], counts[3]));
    Ok(())
}
