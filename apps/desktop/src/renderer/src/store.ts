import { create } from 'zustand';
import type {
  CauseTag,
  Game,
  GameBundle,
  GameResult,
  Lane,
  Note,
  RecorderStatus,
  Settings,
  Theme,
} from '@shared/contracts';
import type { NavigateRoute } from '@shared/ipc';

export type Route = NavigateRoute;
export type ThemeFilter = 'all' | Theme;
export type LaneFilter = 'all' | Lane;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface PlayerState {
  currentMs: number;
  durationMs: number;
  playing: boolean;
  rate: number;
  muted: boolean;
}

export interface AppState {
  route: Route;
  games: Game[];
  gamesLoading: boolean;
  bundle: GameBundle | null;
  bundleLoading: boolean;
  settings: Settings | null;
  recorder: RecorderStatus | null;
  selectedMomentId: string | null;
  themeFilter: ThemeFilter;
  laneFilter: LaneFilter;
  libraryResult: 'all' | GameResult;
  libraryQueue: 'all' | number;
  player: PlayerState;
  toast: Toast | null;

  navigate(route: Route): void;
  loadGames(): Promise<void>;
  openGame(gameId: string): Promise<void>;
  refreshBundle(): Promise<void>;
  loadSettings(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  setRecorder(s: RecorderStatus): void;
  setSettingsFromPush(s: Settings): void;
  selectMoment(id: string | null): void;
  setThemeFilter(f: ThemeFilter): void;
  setLaneFilter(f: LaneFilter): void;
  setLibraryResult(f: 'all' | GameResult): void;
  setLibraryQueue(f: 'all' | number): void;
  setPlayer(p: Partial<PlayerState>): void;
  saveNote(input: { id?: string; momentId: string | null; videoTMs: number; text: string }): Promise<Note | null>;
  deleteNote(id: string): Promise<void>;
  setTags(momentId: string, tags: CauseTag[]): Promise<void>;
  exportClip(tInMs: number, tOutMs: number): Promise<void>;
  showToast(text: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(): void;
}

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<AppState>((set, get) => ({
  route: { view: 'library' },
  games: [],
  gamesLoading: false,
  bundle: null,
  bundleLoading: false,
  settings: null,
  recorder: null,
  selectedMomentId: null,
  themeFilter: 'all',
  laneFilter: 'all',
  libraryResult: 'all',
  libraryQueue: 'all',
  player: { currentMs: 0, durationMs: 0, playing: false, rate: 1, muted: false },
  toast: null,

  navigate(route) {
    if (route.view === 'game') void get().openGame(route.gameId);
    else {
      set({ route });
      if (route.view === 'library') void get().loadGames();
    }
  },

  async loadGames() {
    set({ gamesLoading: true });
    try {
      const games = await window.lvr.listGames();
      set({ games, gamesLoading: false });
    } catch (err) {
      set({ gamesLoading: false });
      get().showToast(`Failed to load games: ${String(err)}`, 'error');
    }
  },

  async openGame(gameId) {
    set({ route: { view: 'game', gameId }, bundleLoading: true, bundle: null, selectedMomentId: null, player: { currentMs: 0, durationMs: 0, playing: false, rate: 1, muted: get().player.muted } });
    try {
      const bundle = await window.lvr.getGame(gameId);
      if (!bundle) throw new Error('game not found');
      set({ bundle, bundleLoading: false, player: { ...get().player, durationMs: bundle.segments[0]?.durationMs ?? 0 } });
    } catch (err) {
      set({ bundleLoading: false, route: { view: 'library' } });
      get().showToast(`Failed to open game: ${String(err)}`, 'error');
    }
  },

  async refreshBundle() {
    const cur = get().bundle;
    if (!cur) return;
    const bundle = await window.lvr.getGame(cur.game.id);
    if (bundle) set({ bundle });
  },

  async loadSettings() {
    const settings = await window.lvr.getSettings();
    set({ settings });
  },

  async updateSettings(patch) {
    const prev = get().settings;
    if (prev) set({ settings: { ...prev, ...patch } });
    const settings = await window.lvr.setSettings(patch);
    set({ settings });
  },

  setRecorder(recorder) {
    set({ recorder });
  },
  setSettingsFromPush(settings) {
    set({ settings });
  },
  selectMoment(selectedMomentId) {
    set({ selectedMomentId });
  },
  setThemeFilter(themeFilter) {
    set({ themeFilter });
  },
  setLaneFilter(laneFilter) {
    set({ laneFilter });
  },
  setLibraryResult(libraryResult) {
    set({ libraryResult });
  },
  setLibraryQueue(libraryQueue) {
    set({ libraryQueue });
  },
  setPlayer(p) {
    set({ player: { ...get().player, ...p } });
  },

  async saveNote(input) {
    const bundle = get().bundle;
    if (!bundle) return null;
    try {
      const note = await window.lvr.saveNote({ ...input, gameId: bundle.game.id });
      await get().refreshBundle();
      return note;
    } catch (err) {
      get().showToast(`Note not saved: ${String(err)}`, 'error');
      return null;
    }
  },

  async deleteNote(id) {
    await window.lvr.deleteNote(id);
    await get().refreshBundle();
  },

  async setTags(momentId, tags) {
    const bundle = get().bundle;
    if (bundle) {
      // optimistic
      set({ bundle: { ...bundle, moments: bundle.moments.map((m) => (m.id === momentId ? { ...m, tags } : m)) } });
    }
    await window.lvr.setTags(momentId, tags);
    await get().refreshBundle();
  },

  async exportClip(tInMs, tOutMs) {
    const bundle = get().bundle;
    if (!bundle) return;
    get().showToast('Exporting clip…');
    const res = await window.lvr.exportClip(bundle.game.id, tInMs, tOutMs);
    if (res.ok && res.clip) {
      const path = res.clip.path;
      get().showToast(`Clip saved: ${path.split(/[\\/]/).pop() ?? path}`, 'info', { label: 'Show in folder', run: () => void window.lvr.revealPath(path) });
      await get().refreshBundle();
    } else {
      get().showToast(`Clip export failed: ${res.error ?? 'unknown error'}`, 'error');
    }
  },

  showToast(text, kind = 'info', action) {
    if (toastTimer) clearTimeout(toastTimer);
    const toast: Toast = action ? { id: ++toastSeq, text, kind, action } : { id: ++toastSeq, text, kind };
    set({ toast });
    toastTimer = setTimeout(() => set({ toast: null }), kind === 'error' ? 8000 : 5000);
  },
  dismissToast() {
    set({ toast: null });
  },
}));
