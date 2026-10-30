/**
 * In-app updates from GitHub Releases (electron-updater reads latest.yml from the newest
 * release). Checks at start and every few hours; downloading and installing wait for the
 * user's click, and installing waits until no game is being recorded.
 */
import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateStatus } from '../shared/contracts';
import { IPC } from '../shared/ipc';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export class Updater {
  private status: UpdateStatus = { state: 'idle', current: app.getVersion(), latest: null, percent: null, error: null };

  constructor(private readonly opts: { isRecording: () => boolean; beforeInstall: () => void }) {}

  start(): void {
    if (!app.isPackaged) {
      this.status = { ...this.status, state: 'dev' };
      return;
    }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: null }));
    autoUpdater.on('update-available', (i) => this.set({ state: 'available', latest: i.version }));
    autoUpdater.on('update-not-available', (i) => this.set({ state: 'latest', latest: i.version }));
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', latest: i.version, percent: 100 }));
    autoUpdater.on('error', (e) => {
      console.warn(`[updater] ${e.message}`);
      // a failed download can be retried; a failed check just waits for the next one
      this.set({ state: this.status.latest && this.status.state === 'downloading' ? 'available' : 'error', error: e.message.split('\n')[0] ?? 'update failed' });
    });
    void this.check();
    setInterval(() => void this.check(), CHECK_EVERY_MS).unref();
  }

  get(): UpdateStatus {
    return { ...this.status };
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.get();
    if (this.status.state === 'downloading' || this.status.state === 'ready') return this.get();
    await autoUpdater.checkForUpdates().catch(() => undefined);
    return this.get();
  }

  async download(): Promise<void> {
    if (this.status.state !== 'available') return;
    this.set({ state: 'downloading', percent: 0, error: null });
    await autoUpdater.downloadUpdate().catch(() => undefined);
  }

  install(): void {
    if (this.status.state !== 'ready' || this.opts.isRecording()) return;
    this.opts.beforeInstall();
    // silent install into the same folder, then start the new version
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.updateStatus, this.get());
  }
}
