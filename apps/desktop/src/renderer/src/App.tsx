import { useEffect } from 'react';
import { StatusBar } from './components/StatusBar';
import { useStore } from './store';
import { GameView } from './views/GameView';
import { Library } from './views/Library';
import { SettingsView } from './views/SettingsView';

export function App() {
  const route = useStore((s) => s.route);
  const toast = useStore((s) => s.toast);
  const navigate = useStore((s) => s.navigate);
  const dismissToast = useStore((s) => s.dismissToast);

  useEffect(() => {
    const st = useStore.getState();
    void st.loadSettings();
    void st.loadGames();
    void window.lvr.getRecorderStatus().then((r) => useStore.getState().setRecorder(r));
    const offStatus = window.lvr.onRecorderStatus((r) => useStore.getState().setRecorder(r));
    const offSettings = window.lvr.onSettingsChanged((s) => useStore.getState().setSettingsFromPush(s));
    const offNav = window.lvr.onNavigate((r) => useStore.getState().navigate(r));
    const offClips = window.lvr.onClipsChanged((gameId) => {
      if (useStore.getState().bundle?.game.id === gameId) void useStore.getState().refreshBundle();
    });
    return () => {
      offStatus();
      offSettings();
      offNav();
      offClips();
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className={`nav ${route.view === 'library' || route.view === 'game' ? 'active' : ''}`} onClick={() => navigate({ view: 'library' })}>
          Library
        </button>
        <button className={`nav ${route.view === 'settings' ? 'active' : ''}`} onClick={() => navigate({ view: 'settings' })}>
          Settings
        </button>
        <div className="spacer" />
        <span className="brand">LoL VOD Review</span>
      </header>
      <main className="content">
        {route.view === 'library' && <Library />}
        {route.view === 'game' && <GameView key={route.gameId} />}
        {route.view === 'settings' && <SettingsView />}
      </main>
      <StatusBar />
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button className="link" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          )}
          <button className="link" onClick={dismissToast} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
