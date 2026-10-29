import { useStore } from '../store';

export function StatusBar() {
  const recorder = useStore((s) => s.recorder);
  const route = useStore((s) => s.route);
  const bundle = useStore((s) => s.bundle);

  const state = recorder?.enabled === false ? 'off' : (recorder?.state ?? 'idle');
  const label = state === 'off' ? 'recording off' : state === 'post_processing' ? 'post-processing' : state;

  return (
    <footer className="statusbar">
      <span className={`dot ${state}`} />
      <span className="state">{label}</span>
      {recorder?.detail && <span className="muted">· {recorder.detail}</span>}
      {recorder?.state === 'recording' && (
        <span className="muted">
          · {recorder.encoder ?? ''} · {recorder.frames} frames · {recorder.dropped} dropped
        </span>
      )}
      <div className="spacer" />
      {route.view === 'game' && bundle && (
        <span className="muted hint">
          Space play · ←/→ ±5 s · J/L ±10 s · , . frame · M mute · F fullscreen · [ ] moments · 1-4 speed · B bookmark · Esc back
        </span>
      )}
    </footer>
  );
}
