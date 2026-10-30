import type { BitratePreset } from '@shared/contracts';
import { BITRATE_PRESETS, RECORDABLE_QUEUES } from '@shared/contracts';
import { useStore } from '../store';

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  if (!settings) return <p className="muted">Loading settings…</p>;

  const toggleQueue = (id: number, on: boolean) => {
    const set = new Set(settings.queues);
    if (on) set.add(id);
    else set.delete(id);
    void update({ queues: [...set] });
  };

  return (
    <section className="settings">
      <h1>Settings</h1>

      <fieldset>
        <legend>Recording</legend>
        <label className="row">
          <input type="checkbox" checked={settings.recordingEnabled} onChange={(e) => void update({ recordingEnabled: e.target.checked })} />
          Record games automatically
        </label>
        <label className="row">
          Quality preset
          <select value={settings.bitratePreset} onChange={(e) => void update({ bitratePreset: e.target.value as BitratePreset })}>
            {(Object.keys(BITRATE_PRESETS) as BitratePreset[]).map((k) => (
              <option key={k} value={k}>
                {BITRATE_PRESETS[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          Storage quota
          <span className="inline">
            <input type="number" min={5} max={2000} step={5} value={settings.quotaGb} onChange={(e) => void update({ quotaGb: Number(e.target.value) })} /> GB
          </span>
          <span className="muted small">Oldest unpinned games are deleted first; clips and pinned games are exempt.</span>
        </label>
        <label className="row">
          Jump to this long before a moment
          <span className="inline">
            <input type="range" min={5} max={90} step={1} value={settings.preRollS} onChange={(e) => void update({ preRollS: Number(e.target.value) })} />
            <span className="mono">{settings.preRollS} s</span>
          </span>
        </label>
        <label className="row compact">
          <input type="checkbox" checked={settings.recordMic} onChange={(e) => void update({ recordMic: e.target.checked })} />
          Record my microphone
          <span className="muted small">Your voice is mixed with the game audio (uses Windows' default recording device). Applies from the next game.</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Queues to record</legend>
        <div className="queues">
          {RECORDABLE_QUEUES.map((q) => (
            <label key={q.id} className="row compact">
              <input type="checkbox" checked={settings.queues.includes(q.id)} onChange={(e) => toggleQueue(q.id, e.target.checked)} />
              {q.label}
            </label>
          ))}
        </div>
        <p className="muted small">Practice Tool, spectate and replays are never recorded. Brawl data is never stored (Riot policy).</p>
      </fieldset>

      <fieldset>
        <legend>Windows</legend>
        <label className="row">
          <input type="checkbox" checked={settings.autostart} onChange={(e) => void update({ autostart: e.target.checked })} />
          Start with Windows (hidden in the tray)
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.minimizeToTray} onChange={(e) => void update({ minimizeToTray: e.target.checked })} />
          Closing the window keeps the app running in the tray
        </label>
      </fieldset>
    </section>
  );
}
