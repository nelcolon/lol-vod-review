import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import type { RecorderState } from '../shared/contracts';

export interface TrayCallbacks {
  onOpen: () => void;
  onToggleRecording: (enabled: boolean) => void;
  onQuit: () => void;
}

/** Procedural tray icon (no binary asset): a rounded square whose colour reflects recorder state. */
function makeIcon(state: RecorderState, enabled: boolean, size: number): NativeImage {
  const [r, g, b] = !enabled ? [110, 116, 128] : state === 'recording' ? [230, 60, 70] : state === 'post_processing' ? [240, 170, 40] : [80, 160, 255];
  const buf = Buffer.alloc(size * size * 4);
  const radius = size * 0.28;
  const cx = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // signed distance to rounded square
      const dx = Math.max(Math.abs(x + 0.5 - cx) - (cx - radius), 0);
      const dy = Math.max(Math.abs(y + 0.5 - cx) - (cx - radius), 0);
      const d = Math.hypot(dx, dy) - radius;
      const alpha = Math.max(0, Math.min(1, 0.5 - d));
      // inner "record" dot cut-out when recording
      let a = alpha;
      if (state === 'recording' && enabled) {
        const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cx);
        if (dd < size * 0.18) a = 0;
      }
      const o = (y * size + x) * 4;
      buf[o] = Math.round(b * a); // BGRA, premultiplied
      buf[o + 1] = Math.round(g * a);
      buf[o + 2] = Math.round(r * a);
      buf[o + 3] = Math.round(255 * a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export class AppTray {
  private tray: Tray;
  private state: RecorderState = 'idle';
  private enabled = true;

  constructor(private readonly cb: TrayCallbacks) {
    this.tray = new Tray(makeIcon('idle', true, 16));
    this.tray.setToolTip('LoL VOD Review');
    this.tray.on('click', () => this.cb.onOpen());
    this.tray.on('double-click', () => this.cb.onOpen());
    this.rebuild();
  }

  update(state: RecorderState, enabled: boolean): void {
    if (state === this.state && enabled === this.enabled) return;
    this.state = state;
    this.enabled = enabled;
    this.tray.setImage(makeIcon(state, enabled, 16));
    this.tray.setToolTip(`LoL VOD Review — ${enabled ? state.replace('_', ' ') : 'recording off'}`);
    this.rebuild();
  }

  destroy(): void {
    this.tray.destroy();
  }

  private rebuild(): void {
    const menu = Menu.buildFromTemplate([
      { label: 'Open', click: () => this.cb.onOpen() },
      { type: 'separator' },
      {
        label: `Recording: ${this.enabled ? 'on' : 'off'}`,
        type: 'checkbox',
        checked: this.enabled,
        click: (item) => this.cb.onToggleRecording(item.checked),
      },
      { label: `State: ${this.state.replace('_', ' ')}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => this.cb.onQuit() },
    ]);
    this.tray.setContextMenu(menu);
  }
}
