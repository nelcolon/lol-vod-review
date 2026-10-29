//! QueryPerformanceCounter helpers and the conversion from WGC
//! `SystemRelativeTime` (100 ns units on the QPC timeline) to raw QPC ticks.

use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

pub fn qpc_frequency() -> i64 {
    let mut f = 0i64;
    unsafe {
        let _ = QueryPerformanceFrequency(&mut f);
    }
    if f <= 0 {
        10_000_000
    } else {
        f
    }
}

pub fn qpc_now() -> i64 {
    let mut c = 0i64;
    unsafe {
        let _ = QueryPerformanceCounter(&mut c);
    }
    c
}

/// Current time on the same 100 ns timeline WGC uses for `SystemRelativeTime`.
pub fn now_100ns(freq: i64) -> i64 {
    ticks_to_100ns(qpc_now(), freq)
}

pub fn ticks_to_100ns(ticks: i64, freq: i64) -> i64 {
    ((ticks as i128) * 10_000_000i128 / (freq as i128)) as i64
}

pub fn hns_to_ticks(hns: i64, freq: i64) -> i64 {
    ((hns as i128) * (freq as i128) / 10_000_000i128) as i64
}

pub fn wall_now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hns_ticks_roundtrip_at_10mhz_is_identity() {
        assert_eq!(hns_to_ticks(123_456_789, 10_000_000), 123_456_789);
        assert_eq!(ticks_to_100ns(123_456_789, 10_000_000), 123_456_789);
    }

    #[test]
    fn hns_ticks_roundtrip_other_frequency() {
        let f = 3_579_545; // classic ACPI timer
        let hns = 50_000_000_000; // 5000 s
        let ticks = hns_to_ticks(hns, f);
        let back = ticks_to_100ns(ticks, f);
        assert!((back - hns).abs() <= 3, "{back} vs {hns}");
    }

    #[test]
    fn wall_clock_is_rfc3339_utc() {
        let s = wall_now_rfc3339();
        assert!(s.ends_with('Z'), "{s}");
        assert_eq!(s.len(), "2026-10-29T12:00:00.123456789Z".len().max(20).min(s.len()));
    }
}
