//! Black-frame and frozen-frame detection on a coarse luma grid.
//!
//! The capture handler reads one frame back to the CPU roughly every second,
//! reduces it to a small grid of luma samples with [`luma_grid`], and feeds the
//! grid to [`FrameHealth::observe`]. The detector is edge-triggered: it reports
//! when a condition starts and when it clears, never on every sample.

/// Width of the sampling grid (samples per row).
pub const GRID_W: u32 = 64;
/// Height of the sampling grid (rows).
pub const GRID_H: u32 = 36;

#[derive(Debug, Clone, Copy)]
pub struct DetectorConfig {
    /// Mean luma at or below which a frame counts as black.
    pub black_mean: u8,
    /// Maximum single sample luma allowed for a black frame (rejects "dark
    /// scene with a bright minimap").
    pub black_max: u8,
    /// Black must persist this long before we warn (League's fade-in at game
    /// start is black for about a second).
    pub black_secs: f64,
    /// Identical content must persist this long before we warn.
    pub frozen_secs: f64,
}

impl Default for DetectorConfig {
    fn default() -> Self {
        DetectorConfig {
            black_mean: 10,
            black_max: 24,
            black_secs: 2.0,
            frozen_secs: 3.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Health {
    BlackStarted,
    BlackCleared,
    FrozenStarted,
    FrozenCleared,
}

#[derive(Debug)]
pub struct FrameHealth {
    cfg: DetectorConfig,
    black_since: Option<f64>,
    black_active: bool,
    last_hash: Option<u64>,
    hash_since: f64,
    frozen_active: bool,
}

impl FrameHealth {
    pub fn new(cfg: DetectorConfig) -> Self {
        FrameHealth {
            cfg,
            black_since: None,
            black_active: false,
            last_hash: None,
            hash_since: 0.0,
            frozen_active: false,
        }
    }

    #[cfg(test)]
    pub fn is_black(&self) -> bool {
        self.black_active
    }

    #[cfg(test)]
    pub fn is_frozen(&self) -> bool {
        self.frozen_active
    }

    /// Feed one luma grid sampled at time `t` (seconds, monotonic). Returns
    /// the state transitions this sample caused.
    pub fn observe(&mut self, samples: &[u8], t: f64) -> Vec<Health> {
        let mut out = Vec::new();
        if samples.is_empty() {
            return out;
        }
        let (mean, max) = mean_max(samples);
        let black_now = mean <= self.cfg.black_mean && max <= self.cfg.black_max;

        // Black: sustained for black_secs.
        if black_now {
            let since = *self.black_since.get_or_insert(t);
            if !self.black_active && t - since >= self.cfg.black_secs {
                self.black_active = true;
                out.push(Health::BlackStarted);
            }
        } else {
            self.black_since = None;
            if self.black_active {
                self.black_active = false;
                out.push(Health::BlackCleared);
            }
        }

        // Frozen: identical hash for frozen_secs. A black screen is constant
        // too, so black takes precedence and suppresses the frozen check.
        let hash = fnv1a(samples);
        match self.last_hash {
            Some(prev) if prev == hash => {
                if !black_now && !self.frozen_active && t - self.hash_since >= self.cfg.frozen_secs {
                    self.frozen_active = true;
                    out.push(Health::FrozenStarted);
                }
            }
            _ => {
                self.last_hash = Some(hash);
                self.hash_since = t;
                if self.frozen_active {
                    self.frozen_active = false;
                    out.push(Health::FrozenCleared);
                }
            }
        }
        out
    }
}

fn mean_max(samples: &[u8]) -> (u8, u8) {
    let mut sum: u64 = 0;
    let mut max = 0u8;
    for &s in samples {
        sum += s as u64;
        if s > max {
            max = s;
        }
    }
    ((sum / samples.len() as u64) as u8, max)
}

/// 64-bit FNV-1a over the sample grid.
pub fn fnv1a(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Reduce a 32-bit-per-pixel frame (BGRA or RGBA, `row_pitch` bytes per row,
/// which may exceed `width * 4`) to a `grid_w x grid_h` grid of luma values.
/// Luma is approximated as (c0 + 2*c1 + c2) / 4 over the first three
/// channels, so it does not care whether the layout is BGRA or RGBA.
pub fn luma_grid(
    pixels: &[u8],
    width: u32,
    height: u32,
    row_pitch: u32,
    grid_w: u32,
    grid_h: u32,
) -> Vec<u8> {
    let mut out = Vec::with_capacity((grid_w * grid_h) as usize);
    if width == 0 || height == 0 || grid_w == 0 || grid_h == 0 {
        return out;
    }
    for gy in 0..grid_h {
        // Centre of each cell.
        let y = ((gy as u64 * 2 + 1) * height as u64 / (grid_h as u64 * 2)) as u32;
        for gx in 0..grid_w {
            let x = ((gx as u64 * 2 + 1) * width as u64 / (grid_w as u64 * 2)) as u32;
            let idx = y as usize * row_pitch as usize + x as usize * 4;
            if idx + 3 <= pixels.len() {
                let c0 = pixels[idx] as u32;
                let c1 = pixels[idx + 1] as u32;
                let c2 = pixels[idx + 2] as u32;
                out.push(((c0 + 2 * c1 + c2) / 4) as u8);
            } else {
                out.push(0);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: u32, height: u32, row_pitch: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let mut v = vec![0u8; (row_pitch * height) as usize];
        for y in 0..height {
            for x in 0..width {
                let p = f(x, y);
                let i = (y * row_pitch + x * 4) as usize;
                v[i..i + 4].copy_from_slice(&p);
            }
        }
        v
    }

    fn grid_of(width: u32, height: u32, row_pitch: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let px = frame(width, height, row_pitch, f);
        luma_grid(&px, width, height, row_pitch, GRID_W, GRID_H)
    }

    #[test]
    fn luma_grid_has_expected_size_and_handles_padding() {
        // Row pitch larger than width*4, padding bytes set to 0xFF to prove
        // they are never sampled.
        let w = 200;
        let h = 100;
        let pitch = 1024;
        let mut px = frame(w, h, pitch, |_, _| [100, 100, 100, 255]);
        for y in 0..h {
            for b in (w * 4)..pitch {
                px[(y * pitch + b) as usize] = 0xFF;
            }
        }
        let g = luma_grid(&px, w, h, pitch, GRID_W, GRID_H);
        assert_eq!(g.len(), (GRID_W * GRID_H) as usize);
        assert!(g.iter().all(|&v| v == 100), "padding leaked into samples");
    }

    #[test]
    fn luma_grid_is_channel_order_agnostic_for_grey() {
        let a = grid_of(64, 36, 256, |_, _| [10, 200, 30, 255]);
        let b = grid_of(64, 36, 256, |_, _| [30, 200, 10, 255]);
        assert_eq!(a, b);
    }

    #[test]
    fn black_warns_after_sustained_black_and_clears() {
        let mut d = FrameHealth::new(DetectorConfig::default());
        let black = grid_of(64, 36, 256, |_, _| [0, 0, 0, 255]);
        let scene = grid_of(64, 36, 256, |x, y| [(x * 3) as u8, (y * 5) as u8, 128, 255]);

        assert!(d.observe(&scene, 0.0).is_empty());
        assert!(d.observe(&black, 1.0).is_empty(), "1 s of black is a fade, not a fault");
        assert!(d.observe(&black, 2.0).is_empty(), "exactly 1 s since black began");
        assert_eq!(d.observe(&black, 3.0), vec![Health::BlackStarted]);
        assert!(d.observe(&black, 4.0).is_empty(), "edge-triggered: no repeat");
        assert!(d.is_black());
        assert_eq!(d.observe(&scene, 5.0), vec![Health::BlackCleared]);
        assert!(!d.is_black());
    }

    #[test]
    fn dark_scene_with_bright_spot_is_not_black() {
        let mut d = FrameHealth::new(DetectorConfig::default());
        // Almost black, but a bright minimap-like corner.
        let dark = grid_of(640, 360, 2560, |x, y| {
            if x > 560 && y > 300 {
                [220, 220, 220, 255]
            } else {
                [2, 2, 2, 255]
            }
        });
        let mut events = Vec::new();
        for i in 0..6 {
            events.extend(d.observe(&dark, i as f64));
        }
        // The static dark scene may be reported frozen, but never black.
        assert!(!events.contains(&Health::BlackStarted), "{events:?}");
    }

    #[test]
    fn frozen_warns_after_identical_content_and_clears_on_change() {
        let mut d = FrameHealth::new(DetectorConfig::default());
        let still = grid_of(64, 36, 256, |x, y| [(x * 2) as u8, (y * 4) as u8, 90, 255]);
        assert!(d.observe(&still, 0.0).is_empty());
        assert!(d.observe(&still, 1.0).is_empty());
        assert!(d.observe(&still, 2.0).is_empty());
        assert_eq!(d.observe(&still, 3.0), vec![Health::FrozenStarted]);
        assert!(d.observe(&still, 4.0).is_empty());
        assert!(d.is_frozen());
        let moved = grid_of(64, 36, 256, |x, y| [(x * 2 + 16) as u8, (y * 4) as u8, 90, 255]);
        assert_eq!(d.observe(&moved, 5.0), vec![Health::FrozenCleared]);
        assert!(!d.is_frozen());
    }

    #[test]
    fn changing_content_never_warns() {
        let mut d = FrameHealth::new(DetectorConfig::default());
        for i in 0..30u32 {
            let g = grid_of(64, 36, 256, |x, y| [(x + i) as u8, (y * 3) as u8, 100, 255]);
            assert!(d.observe(&g, i as f64).is_empty(), "t={i}");
        }
    }

    #[test]
    fn black_suppresses_frozen() {
        let mut d = FrameHealth::new(DetectorConfig::default());
        let black = grid_of(64, 36, 256, |_, _| [0, 0, 0, 255]);
        let mut events = Vec::new();
        for i in 0..10 {
            events.extend(d.observe(&black, i as f64));
        }
        assert_eq!(events, vec![Health::BlackStarted]);
    }

    #[test]
    fn fnv_distinguishes_small_changes() {
        let a = vec![1u8, 2, 3, 4];
        let b = vec![1u8, 2, 3, 5];
        assert_ne!(fnv1a(&a), fnv1a(&b));
        assert_eq!(fnv1a(&a), fnv1a(&a));
    }

    #[test]
    fn empty_frame_is_ignored() {
        let mut d = FrameHealth::new(DetectorConfig::default());
        assert!(d.observe(&[], 0.0).is_empty());
        assert!(luma_grid(&[], 0, 0, 0, GRID_W, GRID_H).is_empty());
    }
}
