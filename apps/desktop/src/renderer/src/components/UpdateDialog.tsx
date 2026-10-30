import { useEffect, useState } from 'react';
import { useUpdate } from '../lib/useUpdate';
import { useStore } from '../store';

/**
 * Small window over the app when a new version is out: Update downloads it, then Restart
 * installs it. Close hides it until the next start (Settings → About & updates still has it).
 */
export function UpdateDialog() {
  const u = useUpdate();
  const recording = useStore((s) => s.recorder?.state !== undefined && s.recorder.state !== 'idle');
  const [closed, setClosed] = useState(false);
  const active = !!u?.latest && !closed && (u.state === 'available' || u.state === 'downloading' || u.state === 'ready');

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && u?.state !== 'downloading' && setClosed(true);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, u?.state]);

  if (!u || !active) return null;
  return (
    <div className="modal-backdrop">
      <div className="update-dialog" role="dialog" aria-labelledby="update-title">
        {u.state !== 'downloading' && (
          <button type="button" className="update-x" onClick={() => setClosed(true)} aria-label="Close">
            ×
          </button>
        )}
        <h3 id="update-title">{u.state === 'ready' ? 'Update ready' : 'New update available'}</h3>
        {u.state === 'available' && (
          <p>
            Version <strong>{u.latest}</strong> is out. You have {u.current}.
          </p>
        )}
        {u.state === 'downloading' && (
          <>
            <p>Downloading version {u.latest}…</p>
            <div className="update-progress">
              <span style={{ width: `${u.percent ?? 0}%` }} />
            </div>
            <p className="muted small mono">{u.percent ?? 0}%</p>
          </>
        )}
        {u.state === 'ready' && (
          <p>
            Version <strong>{u.latest}</strong> is downloaded.{' '}
            {recording ? 'You are in a game: restart once it ends, or it installs when you quit the app.' : 'Restart the app to install it.'}
          </p>
        )}
        {u.error && u.state === 'available' && <p className="error small">The last try failed: {u.error}</p>}
        <div className="update-actions">
          <a className="link small" href={`https://github.com/nelcolon/lol-vod-review/releases/tag/v${u.latest}`} target="_blank" rel="noreferrer">
            What's new
          </a>
          <span className="spacer" />
          {u.state !== 'downloading' && (
            <button type="button" onClick={() => setClosed(true)}>
              {u.state === 'ready' ? 'Later' : 'Close'}
            </button>
          )}
          {u.state === 'available' && (
            <button type="button" className="primary" onClick={() => void window.lvr.downloadUpdate()}>
              Update
            </button>
          )}
          {u.state === 'ready' && (
            <button type="button" className="primary" disabled={recording} onClick={() => void window.lvr.installUpdate()}>
              Restart now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
