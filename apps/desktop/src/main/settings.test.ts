import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, OTHER_MODES, QUEUE_LIST_VERSION, type Settings } from '../shared/contracts';
import { sanitize } from './settings';

describe('settings', () => {
  it('turns "Other and new modes" on once for settings saved before it existed', () => {
    const old = { ...DEFAULT_SETTINGS, queues: [420, 450], queueListVersion: undefined } as unknown as Settings;
    const s = sanitize(old);
    expect(s.queues).toContain(OTHER_MODES);
    expect(s.queueListVersion).toBe(QUEUE_LIST_VERSION);
  });

  it('keeps it off when the user turned it off afterwards', () => {
    const s = sanitize({ ...DEFAULT_SETTINGS, queues: [420, 450] });
    expect(s.queues).not.toContain(OTHER_MODES);
  });

  it('keeps an absolute recordings folder and drops anything else', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, recordingsDir: ' D:\\LoL VODs ' }).recordingsDir).toBe('D:\\LoL VODs');
    expect(sanitize({ ...DEFAULT_SETTINGS, recordingsDir: 'relative\\dir' }).recordingsDir).toBe('');
    expect(sanitize({ ...DEFAULT_SETTINGS, recordingsDir: 42 as unknown as string }).recordingsDir).toBe('');
    expect(sanitize({ ...DEFAULT_SETTINGS, recordingsDir: undefined as unknown as string }).recordingsDir).toBe('');
  });
});
