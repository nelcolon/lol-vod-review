import { useCallback, useEffect, useState } from 'react';
import type { BitratePreset, StorageUsage, UpdateStatus } from '@shared/contracts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatBytes } from '../lib/format';
import { BITRATE_PRESETS, RECORDABLE_QUEUES } from '@shared/contracts';
import { useUpdate } from '../lib/useUpdate';
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
          <span className="muted small">When recordings take more than this, the oldest games are deleted after each game. Games with clips are kept.</span>
        </label>
        <StorageUsageRow quotaGb={settings.quotaGb} />
        <RecordingsFolder />
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
        <label className="row">
          Microphone volume
          <span className="inline">
            <input
              type="range"
              min={0}
              max={300}
              step={5}
              value={settings.micVolume}
              disabled={!settings.recordMic}
              onChange={(e) => void update({ micVolume: Number(e.target.value) })}
            />
            <span className="mono">{settings.micVolume}%</span>
          </span>
          <span className="muted small">100% is your mic as Windows hears it; raise it if your voice is quiet next to the game.</span>
        </label>
        <label className="row compact">
          <input type="checkbox" checked={settings.compatCapture} onChange={(e) => void update({ compatCapture: e.target.checked })} />
          Compatibility capture
          <span className="muted small">
            Off (recommended): the screen is copied without slowing the game down, and when you alt-tab out of League the video shows a
            "not in focus" card instead of your other windows. Turn on only if recordings come out black or broken; it records the game window
            directly but costs some smoothness in game. Applies from the next game.
          </span>
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
        <p className="muted small">Spectating and replays are never recorded. Brawl data is never stored (Riot policy).</p>
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
      <UpdateSection />
    </section>
  );
}

/** How much the recordings take now, and what the quota would delete; "Delete now" asks first. */
function StorageUsageRow({ quotaGb }: { quotaGb: number }) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const showToast = useStore((s) => s.showToast);
  const refresh = useCallback(() => void window.lvr.getStorageUsage().then(setUsage), []);
  useEffect(() => {
    // quota typed in the box: wait until the typing stops
    const t = setTimeout(refresh, 400);
    return () => clearTimeout(t);
  }, [quotaGb, refresh]);
  if (!usage) return null;
  const over = usage.deleteCount > 0;
  const apply = async () => {
    setBusy(true);
    const r = await window.lvr.applyRetention();
    setBusy(false);
    setConfirm(false);
    if (!r.deleted) showToast(r.failed ? `Nothing deleted: ${r.failed} games are in use` : 'Nothing to delete', r.failed ? 'error' : 'info');
    refresh();
  };
  return (
    <div className="row">
      <span className="muted small">
        Recordings use <strong className={over ? 'error' : ''}>{formatBytes(usage.usedBytes)}</strong> of {formatBytes(usage.quotaBytes)}.
        {over && ` Over the quota: the ${usage.deleteCount} oldest games (${formatBytes(usage.deleteBytes)}) are deleted after your next game.`}
        {usage.keptCount > 0 && ` ${usage.keptCount} games with clips are kept.`}
      </span>
      {over && (
        <button type="button" className="danger" onClick={() => setConfirm(true)}>
          Delete now
        </button>
      )}
      {confirm && (
        <ConfirmDialog
          title={`Delete ${usage.deleteCount} old games?`}
          confirmLabel={`Delete ${usage.deleteCount} games`}
          busy={busy}
          onConfirm={() => void apply()}
          onCancel={() => setConfirm(false)}
        >
          <p>
            The {usage.deleteCount} oldest games ({formatBytes(usage.deleteBytes)}) are removed with their notes, so the recordings fit your{' '}
            {quotaGb} GB quota. Games with clips are kept. This can't be undone.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Where new games are saved; already recorded games stay where they are. */
function RecordingsFolder() {
  const dir = useStore((s) => s.settings?.recordingsDir ?? '');
  const update = useStore((s) => s.updateSettings);
  const showToast = useStore((s) => s.showToast);
  const choose = async () => {
    const res = await window.lvr.chooseRecordingsDir();
    if (res.error) showToast(res.error, 'error');
  };
  return (
    <div className="row">
      Recordings folder
      <span className="inline folder-row">
        <span className="mono folder-path" title={dir || undefined}>
          {dir || 'Default (%APPDATA%\\@lvr\\desktop\\recordings)'}
        </span>
        <button type="button" onClick={() => void choose()}>
          Change…
        </button>
        <button type="button" onClick={() => void window.lvr.openRecordingsDir()}>
          Open
        </button>
        {dir && (
          <button type="button" className="link small" onClick={() => void update({ recordingsDir: '' })}>
            Use default
          </button>
        )}
      </span>
      <span className="muted small">New games are saved here. Games you already recorded stay in their folder and keep working.</span>
    </div>
  );
}

function UpdateSection() {
  const u = useUpdate();
  const [checking, setChecking] = useState(false);
  if (!u) return null;
  const line: Record<UpdateStatus['state'], string> = {
    idle: '',
    dev: 'Development build: updates are only checked in the installed app.',
    checking: 'Checking for updates…',
    latest: 'You have the latest version.',
    available: `Version ${u.latest} is available.`,
    downloading: `Downloading version ${u.latest}… ${u.percent ?? 0}%`,
    ready: `Version ${u.latest} is downloaded. Restart to install it.`,
    error: `Couldn't check for updates${u.error ? `: ${u.error}` : ''}.`,
  };
  return (
    <fieldset>
      <legend>About & updates</legend>
      <div className="row">
        LoL VOD Review <span className="mono">{u.current}</span>
        <span className="muted small">{line[u.state]}</span>
      </div>
      <div className="row compact">
        {u.state === 'available' && (
          <button type="button" className="primary" onClick={() => void window.lvr.downloadUpdate()}>
            Update now
          </button>
        )}
        {u.state === 'ready' && (
          <button type="button" className="primary" onClick={() => void window.lvr.installUpdate()}>
            Restart and update
          </button>
        )}
        {u.state !== 'dev' && u.state !== 'downloading' && u.state !== 'ready' && (
          <button
            type="button"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void window.lvr.checkForUpdate().finally(() => setChecking(false));
            }}
          >
            Check for updates
          </button>
        )}
        <a className="link small" href="https://github.com/nelcolon/lol-vod-review/releases" target="_blank" rel="noreferrer">
          Release notes
        </a>
        <span className="muted small">Free and open source (MIT).</span>
      </div>
    </fieldset>
  );
}
