import { useState } from 'react';
import { useUpdate } from '../lib/useUpdate';
import { useStore } from '../store';

/** "This is an outdated version" bar with Update / Restart buttons. */
export function UpdateBanner() {
  const u = useUpdate();
  const recording = useStore((s) => s.recorder?.state !== undefined && s.recorder.state !== 'idle');
  const [hidden, setHidden] = useState<string | null>(null);
  if (!u || !u.latest || hidden === u.latest) return null;
  if (u.state !== 'available' && u.state !== 'downloading' && u.state !== 'ready') return null;

  return (
    <div className="update-banner" role="status">
      {u.state === 'available' && (
        <>
          <span>
            <strong>This is an outdated version</strong> ({u.current}). Version {u.latest} is available.
          </span>
          <button type="button" className="primary" onClick={() => void window.lvr.downloadUpdate()}>
            Update now
          </button>
        </>
      )}
      {u.state === 'downloading' && (
        <>
          <span>Downloading version {u.latest}…</span>
          <span className="update-progress">
            <span style={{ width: `${u.percent ?? 0}%` }} />
          </span>
          <span className="mono small">{u.percent ?? 0}%</span>
        </>
      )}
      {u.state === 'ready' && (
        <>
          <span>
            Version {u.latest} is ready. {recording ? 'It installs after this game, or restart once the game ends.' : 'Restart to install it.'}
          </span>
          <button type="button" className="primary" disabled={recording} onClick={() => void window.lvr.installUpdate()}>
            Restart and update
          </button>
        </>
      )}
      {u.error && u.state === 'available' && <span className="small error">Last try failed: {u.error}</span>}
      <span className="spacer" />
      {u.state !== 'downloading' && (
        <button type="button" className="link small" onClick={() => setHidden(u.latest)} aria-label="Hide">
          Later
        </button>
      )}
    </div>
  );
}
