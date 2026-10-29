import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, BITRATE_PRESETS, type Settings } from '../shared/contracts';

type Listener = (s: Settings) => void;

/** JSON-file-backed settings. Unknown keys are dropped, missing keys get defaults. */
export class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor(private readonly file: string) {
    this.value = this.load();
  }

  get(): Settings {
    return { ...this.value, queues: [...this.value.queues] };
  }

  patch(p: Partial<Settings>): Settings {
    this.value = sanitize({ ...this.value, ...p });
    this.save();
    for (const l of this.listeners) l(this.get());
    return this.get();
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return sanitize({ ...DEFAULT_SETTINGS, ...(raw as Partial<Settings>) });
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.value, null, 2), 'utf8');
    } catch (err) {
      console.error('[settings] save failed', err);
    }
  }
}

export function sanitize(s: Settings): Settings {
  const preset = s.bitratePreset in BITRATE_PRESETS ? s.bitratePreset : DEFAULT_SETTINGS.bitratePreset;
  const quota = Number.isFinite(s.quotaGb) ? Math.min(2000, Math.max(5, Math.round(s.quotaGb))) : DEFAULT_SETTINGS.quotaGb;
  const preRoll = Number.isFinite(s.preRollS) ? Math.min(90, Math.max(30, Math.round(s.preRollS))) : DEFAULT_SETTINGS.preRollS;
  const queues = Array.isArray(s.queues) ? [...new Set(s.queues.filter((q) => Number.isInteger(q)))] : DEFAULT_SETTINGS.queues;
  return {
    recordingEnabled: Boolean(s.recordingEnabled),
    quotaGb: quota,
    bitratePreset: preset,
    queues,
    preRollS: preRoll,
    autostart: Boolean(s.autostart),
    minimizeToTray: Boolean(s.minimizeToTray),
  };
}
