//! Window and monitor enumeration. Query-only, by design:
//!
//! * `EnumWindows` + `GetWindowThreadProcessId` to map windows to PIDs;
//! * `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `QueryFullProcessImageNameW`
//!   for the executable name.
//!
//! We deliberately do NOT use `windows_capture::window::Window::process_name()`:
//! it opens the process with `PROCESS_QUERY_INFORMATION | PROCESS_VM_READ`, which
//! PLAN.md §2.1 forbids against the League process. Nothing here sends input or
//! messages to any window.

use std::ffi::c_void;

use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetClientRect, GetWindowLongPtrW, GetWindowTextW, GetWindowThreadProcessId,
    IsIconic, IsWindow, IsWindowVisible, GWL_EXSTYLE, GWL_STYLE, WS_CHILD, WS_EX_TOOLWINDOW,
};
use windows::core::PWSTR;
use windows_capture::monitor::Monitor;

use crate::protocol::{MonitorInfo, WindowInfo};

fn hwnd_of(raw: u64) -> HWND {
    HWND(raw as usize as *mut c_void)
}

fn utf16_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// Executable base name (e.g. `League of Legends.exe`) for a PID, using only
/// `PROCESS_QUERY_LIMITED_INFORMATION`.
pub fn process_image_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let res = QueryFullProcessImageNameW(handle, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        res.ok()?;
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        Some(full.rsplit(['\\', '/']).next().unwrap_or(&full).to_string())
    }
}

unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let out = &mut *(lparam.0 as *mut Vec<WindowInfo>);
    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    let st = GetWindowLongPtrW(hwnd, GWL_STYLE);
    if (ex as u32 & WS_EX_TOOLWINDOW.0) != 0 || (st as u32 & WS_CHILD.0) != 0 {
        return BOOL(1);
    }
    let mut title = [0u16; 512];
    let n = GetWindowTextW(hwnd, &mut title);
    let title = if n > 0 { utf16_to_string(&title) } else { String::new() };
    let mut class = [0u16; 256];
    let n = GetClassNameW(hwnd, &mut class);
    let class = if n > 0 { utf16_to_string(&class) } else { String::new() };
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let mut rect = RECT::default();
    let _ = GetClientRect(hwnd, &mut rect);
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if title.is_empty() && (width <= 0 || height <= 0) {
        return BOOL(1);
    }
    out.push(WindowInfo {
        hwnd: hwnd.0 as usize as u64,
        pid,
        title,
        class,
        process: None,
        width,
        height,
        minimized: IsIconic(hwnd).as_bool(),
    });
    BOOL(1)
}

/// Visible top-level windows. `process` is filled lazily with
/// [`process_image_name`] (cheap; one handle per distinct PID).
pub fn list_windows() -> Vec<WindowInfo> {
    let mut v: Vec<WindowInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut v as *mut Vec<WindowInfo> as isize));
    }
    let mut cache: std::collections::HashMap<u32, Option<String>> = Default::default();
    for w in &mut v {
        w.process = cache.entry(w.pid).or_insert_with(|| process_image_name(w.pid)).clone();
    }
    v
}

fn largest(mut candidates: Vec<WindowInfo>) -> Option<WindowInfo> {
    candidates.sort_by_key(|w| std::cmp::Reverse(w.width as i64 * w.height as i64));
    candidates.into_iter().next()
}

pub fn find_by_pid(pid: u32) -> Option<WindowInfo> {
    largest(list_windows().into_iter().filter(|w| w.pid == pid).collect())
}

/// Case-insensitive match on the executable base name (`.exe` optional).
pub fn find_by_process_name(name: &str) -> Option<WindowInfo> {
    let want = name.trim().to_ascii_lowercase();
    let want_exe = if want.ends_with(".exe") { want.clone() } else { format!("{want}.exe") };
    largest(
        list_windows()
            .into_iter()
            .filter(|w| {
                w.process
                    .as_ref()
                    .map(|p| {
                        let p = p.to_ascii_lowercase();
                        p == want || p == want_exe
                    })
                    .unwrap_or(false)
            })
            .collect(),
    )
}

/// Exact title match first, then case-insensitive substring; largest window wins ties.
pub fn find_by_title(title: &str) -> Option<WindowInfo> {
    let all = list_windows();
    if let Some(w) = largest(all.iter().filter(|w| w.title == title).cloned().collect()) {
        return Some(w);
    }
    let needle = title.to_ascii_lowercase();
    largest(
        all.into_iter()
            .filter(|w| !needle.is_empty() && w.title.to_ascii_lowercase().contains(&needle))
            .collect(),
    )
}

pub fn hwnd_is_window(raw: u64) -> bool {
    unsafe { IsWindow(Some(hwnd_of(raw))).as_bool() }
}

pub fn is_minimized(raw: u64) -> bool {
    unsafe { IsIconic(hwnd_of(raw)).as_bool() }
}

/// Monitors, 0-based (the crate's `Monitor::from_index` is 1-based; we hide that).
pub fn list_monitors() -> Vec<MonitorInfo> {
    let Ok(monitors) = Monitor::enumerate() else {
        return Vec::new();
    };
    let primary = Monitor::primary().ok().map(|m| m.as_raw_hmonitor() as usize);
    monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            index: i as u32,
            name: m.name().unwrap_or_default(),
            device: m.device_name().unwrap_or_default(),
            width: m.width().unwrap_or(0),
            height: m.height().unwrap_or(0),
            refresh_rate: m.refresh_rate().unwrap_or(0),
            primary: Some(m.as_raw_hmonitor() as usize) == primary,
        })
        .collect()
}

/// Resolve a 0-based index to a crate `Monitor`; index 0 with no enumeration
/// falls back to the primary monitor.
pub fn monitor_by_index(index: u32) -> Result<Monitor, String> {
    let monitors = Monitor::enumerate().map_err(|e| format!("enumerate monitors: {e}"))?;
    monitors
        .into_iter()
        .nth(index as usize)
        .ok_or_else(|| format!("monitor index {index} out of range"))
}

/// 0-based index (in `list_monitors` order) of the primary monitor; 0 if unknown.
pub fn primary_monitor_index() -> u32 {
    list_monitors().into_iter().find(|m| m.primary).map(|m| m.index).unwrap_or(0)
}
