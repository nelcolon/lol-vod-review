import { app, BrowserWindow, session, shell } from 'electron';
import { join, resolve } from 'node:path';
import type { Backend } from './backend';
import { installMediaProtocol, registerMediaScheme } from './media-protocol';
import { CoreBackend } from './core-backend';
import { MockBackend } from './mock-backend';
import { registerIpc } from './ipc';
import { clipsDir, dbPath, devAssetsDir, mockStatePath, recorderPath, recordingsDir, sampleVideoPath, settingsPath } from './paths';
import { SettingsStore } from './settings';
import { maybeRunSmoke } from './smoke';
import { AppTray } from './tray';
import { IPC } from '../shared/ipc';

// ---- single instance -----------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerMediaScheme();
  void main();
}

let mainWindow: BrowserWindow | null = null;
const clipWindows = new Map<string, BrowserWindow>();
let tray: AppTray | null = null;
let quitting = false;
const startHidden = process.argv.includes('--hidden');

/** `CoreBackend` records real games; `LVR_MOCK=1` (and the smoke test) use the fake library. */
function createBackend(): Backend {
  const roots = [devAssetsDir(), recordingsDir(), clipsDir()];
  if (process.env['LVR_MOCK'] === '1' || process.env['LVR_SMOKE'] === '1') {
    return new MockBackend({ sampleVideo: sampleVideoPath(), statePath: mockStatePath(), mediaRoots: roots });
  }
  return new CoreBackend({ dbPath: dbPath(), recordingsDir: recordingsDir(), recorderExe: recorderPath(), mediaRoots: roots });
}

async function main(): Promise<void> {
  const settings = new SettingsStore(settingsPath());
  const backend = createBackend();

  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    // Tray app: keep running when the window is closed; Quit comes from the tray menu.
    if (process.platform !== 'win32' && process.platform !== 'linux') app.quit();
  });
  app.on('activate', () => showWindow());

  await app.whenReady();
  app.setAppUserModelId('com.divilight.lolvodreview');

  installMediaProtocol(() => backend.mediaRoots());
  installCsp();

  await backend.start();
  backend.applySettings(settings.get());
  applyAutostart(settings.get().autostart);
  settings.onChange((s) => {
    backend.applySettings(s);
    applyAutostart(s.autostart);
    tray?.update(backend.getRecorderStatus().state, s.recordingEnabled);
  });

  tray = new AppTray({
    onOpen: () => showWindow(),
    onToggleRecording: (enabled) => settings.patch({ recordingEnabled: enabled }),
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });
  tray.update(backend.getRecorderStatus().state, settings.get().recordingEnabled);
  backend.onRecorderStatus((s) => tray?.update(s.state, s.enabled));

  registerIpc({ backend, settings, getWindow: () => mainWindow, openClipWindow });

  createWindow(settings);
  if (!startHidden) showWindow();

  app.on('will-quit', () => {
    void backend.stop();
    tray?.destroy();
  });
}

function createWindow(settings: SettingsStore): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1115',
    title: 'LoL VOD Review',
    autoHideMenuBar: true,
    webPreferences: WEB_PREFERENCES,
  });
  mainWindow = win;

  win.on('close', (e) => {
    if (!quitting && settings.get().minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file:')) e.preventDefault();
  });

  maybeRunSmoke(win);

  // Dev-only: LVR_DEV_OPEN_FIRST=1 opens the first game and clicks the top moment, for screenshots.
  if (!app.isPackaged && process.env['LVR_DEV_OPEN_FIRST'] === '1') {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void win.webContents.executeJavaScript(
          `(async()=>{const s=(ms)=>new Promise(r=>setTimeout(r,ms));
            document.querySelector('tbody tr')?.click(); await s(1500);
            const m=[...document.querySelectorAll('[data-moment-id],button,li')].find(e=>/death|kill|dragon|baron/i.test(e.textContent||''));
            m?.click();})()`,
        );
      }, 1200);
    });
  }

  // Dev-only: LVR_DEV_OPEN_CLIP=1 (with LVR_MOCK=1) opens a clip with a drawing, for screenshots.
  if (!app.isPackaged && process.env['LVR_DEV_OPEN_CLIP'] === '1') {
    win.webContents.once('did-finish-load', () => {
      void win.webContents.executeJavaScript(
        `(async()=>{const g=(await window.lvr.listGames())[0];
          const r=await window.lvr.exportClip(g.id,60000,75000,'Dev clip');
          await window.lvr.updateClip(r.clip.id,{description:'Arrow and circle drawn at the in-point.',drawings:[{id:'d1',tMs:60000,holdMs:60000,
            shapes:[{tool:'arrow',color:'#ff4d4f',points:[[0.2,0.25],[0.45,0.5]]},{tool:'circle',color:'#ffd60a',points:[[0.5,0.45],[0.7,0.7]]}]}]});})()`,
      );
    });
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(resolve(__dirname, '../renderer/index.html'));
  return win;
}

const WEB_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,
} as const;

/** One window per clip; the renderer shows the clip editor when the URL hash is `#clip=<id>`. */
function openClipWindow(clipId: string): void {
  const existing = clipWindows.get(clipId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#0f1115',
    title: 'Clip · LoL VOD Review',
    autoHideMenuBar: true,
    webPreferences: WEB_PREFERENCES,
  });
  clipWindows.set(clipId, win);
  win.on('closed', () => clipWindows.delete(clipId));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file:')) e.preventDefault();
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}#clip=${encodeURIComponent(clipId)}`);
  else void win.loadFile(resolve(__dirname, '../renderer/index.html'), { hash: `clip=${encodeURIComponent(clipId)}` });
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/** Used by the tray/other entry points to deep-link the renderer. */
export function navigate(route: { view: 'library' } | { view: 'game'; gameId: string } | { view: 'settings' }): void {
  showWindow();
  mainWindow?.webContents.send(IPC.navigate, route);
}

function applyAutostart(enabled: boolean): void {
  // In dev `process.execPath` is electron.exe, which would register a broken login item.
  if (!app.isPackaged) {
    console.log(`[autostart] ${enabled ? 'would enable' : 'would disable'} (skipped in dev)`);
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--hidden'] });
}

/** Strict CSP in production; dev needs inline scripts for Vite/React Refresh so it is skipped. */
function installCsp(): void {
  if (!app.isPackaged) return;
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: lvr-media:",
    'media-src lvr-media: blob:',
    "font-src 'self'",
    "connect-src 'self'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
}
