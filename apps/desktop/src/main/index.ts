import { app, BrowserWindow, session, shell } from 'electron';
import { join, resolve } from 'node:path';
import type { Backend } from './backend';
import { installMediaProtocol, registerMediaScheme } from './media-protocol';
import { MockBackend } from './mock-backend';
import { registerIpc } from './ipc';
import { clipsDir, devAssetsDir, mockStatePath, recordingsDir, sampleVideoPath, settingsPath } from './paths';
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
let tray: AppTray | null = null;
let quitting = false;
const startHidden = process.argv.includes('--hidden');

/** The seam: swap `MockBackend` for a core-backed implementation here. */
function createBackend(): Backend {
  return new MockBackend({
    sampleVideo: sampleVideoPath(),
    statePath: mockStatePath(),
    mediaRoots: [devAssetsDir(), recordingsDir(), clipsDir()],
  });
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

  registerIpc({ backend, settings, getWindow: () => mainWindow });

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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
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

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(resolve(__dirname, '../renderer/index.html'));
  return win;
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
