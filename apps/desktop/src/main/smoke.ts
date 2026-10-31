/**
 * Headless-ish smoke test driven by the real app: set `LVR_SMOKE=1` and the main process, once
 * the renderer has loaded, runs a script inside the page that exercises IPC, the lvr-media://
 * Range protocol and the <video> pipeline, prints one JSON line per check and exits with a
 * non-zero code on failure. Used by `npm run smoke` because nothing in this app is visually
 * verifiable from a terminal.
 */
import { app, BrowserWindow } from 'electron';

const SCRIPT = String.raw`
(async () => {
  const out = [];
  const check = (name, ok, info) => out.push({ name, ok: !!ok, info: info ?? null });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, timeoutMs, every = 100) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) return null;
      await sleep(every);
    }
  };
  try {
    check('preload bridge present', typeof window.lvr?.listGames === 'function');
    const games = await window.lvr.listGames();
    check('listGames returns 3 mock games', games.length === 3, games.map((g) => g.myChampion));
    const bundle = await window.lvr.getGame(games[0].id);
    check('getGame returns bundle', !!bundle && bundle.moments.length > 0 && bundle.events.length > 0, bundle && { moments: bundle.moments.length, events: bundle.events.length });
    const url = window.lvr.mediaUrl(bundle.segments[0].path);
    const head = await fetch(url, { method: 'HEAD' });
    check('HEAD media 200 + Accept-Ranges', head.status === 200 && head.headers.get('accept-ranges') === 'bytes', { status: head.status, len: head.headers.get('content-length') });
    const part = await fetch(url, { headers: { Range: 'bytes=100-199' } });
    const buf = new Uint8Array(await part.arrayBuffer());
    check('Range 100-199 -> 206, 100 bytes', part.status === 206 && buf.length === 100 && (part.headers.get('content-range') || '').startsWith('bytes 100-199/'), { status: part.status, cr: part.headers.get('content-range') });
    const bad = await fetch(url, { headers: { Range: 'bytes=99999999999-' } });
    check('Unsatisfiable range -> 416', bad.status === 416, bad.status);
    const outside = await fetch(window.lvr.mediaUrl('C:\\Windows\\win.ini'));
    check('Path outside media roots -> 403', outside.status === 403, outside.status);
    const settings = await window.lvr.getSettings();
    check('getSettings has defaults', typeof settings.quotaGb === 'number' && Array.isArray(settings.queues), settings.bitratePreset);
    const status = await window.lvr.getRecorderStatus();
    check('recorder status', ['idle', 'recording', 'post_processing'].includes(status.state), status.state);

    // UI: library rendered, open first game, video loads and seeks
    const row = await waitFor(() => document.querySelector('table.games tbody tr'), 5000);
    check('library table rendered', !!row);
    row && row.click();
    const video = await waitFor(() => document.querySelector('video'), 5000);
    check('game view mounted <video>', !!video);
    const dur = await waitFor(() => (video && video.duration > 0 ? video.duration : null), 10000);
    check('video metadata loaded (~120 s)', dur !== null && Math.abs(dur - 120) < 1, dur);
    if (video) {
      const seeked = new Promise((r) => video.addEventListener('seeked', () => r(true), { once: true }));
      video.currentTime = 65.5;
      const ok = await Promise.race([seeked, sleep(8000).then(() => false)]);
      check('seek to 65.5 s via Range', ok && Math.abs(video.currentTime - 65.5) < 0.05, video.currentTime);
      const frame = await waitFor(() => (video.readyState >= 2 ? video.readyState : null), 8000);
      check('frame decodable after seek (readyState>=2)', frame !== null, frame);
      const markers = document.querySelectorAll('.marker').length;
      const moments = document.querySelectorAll('.moment').length;
      check('timeline markers + rail moments rendered', markers > 5 && moments > 3, { markers, moments });
      const ps = await window.lvr.getPlayState(bundle.game.id, bundle.moments[0].id);
      check('game state for a moment (players + items)', ps && ps.hasItems && ps.players.length > 1 && ps.players.some((p) => p.items.length > 0), ps && { players: ps.players.length, involved: ps.players.filter((p) => p.roles.length).length });
    }
  } catch (err) {
    check('script threw', false, String(err && err.stack || err));
  }
  return out;
})()
`;

type Check = { name: string; ok: boolean; info: unknown };

/** Runs in the clip window opened by `exportClip`. */
const CLIP_SCRIPT = String.raw`
(async () => {
  const out = [];
  const check = (name, ok, info) => out.push({ name, ok: !!ok, info: info ?? null });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, timeoutMs) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > timeoutMs) return null; await sleep(100); } };
  try {
    const id = decodeURIComponent(location.hash.slice('#clip='.length));
    const video = await waitFor(() => { const v = document.querySelector('.clip-view video'); return v && v.readyState >= 1 && v.currentTime > 0 ? v : null; }, 10000);
    check('clip window: video starts at the clip in-point (60 s)', video && Math.abs(video.currentTime - 60) < 0.1, video && video.currentTime);
    check('clip window: title shown', document.querySelector('.clip-title')?.value === 'smoke clip', document.querySelector('.clip-title')?.value);
    check('clip window: draw layer present', !!document.querySelector('.draw-layer'));
    const drawing = { id: 'd1', tMs: 65000, holdMs: 3000, shapes: [{ tool: 'arrow', color: '#ff4d4f', points: [[0.1, 0.1], [0.5, 0.5]] }] };
    await window.lvr.updateClip(id, { description: 'smoke', drawings: [drawing] });
    const b1 = await window.lvr.getClip(id);
    check('clip edits persist (description + drawing)', b1.clip.description === 'smoke' && b1.clip.drawings.length === 1 && b1.clip.drawings[0].shapes[0].tool === 'arrow', b1.clip.drawings);
    const before = b1.clip.path;
    const c2 = await window.lvr.updateClip(id, { tInMs: 55000, tOutMs: 80000 });
    check('trim re-cuts the file', c2.tInMs === 55000 && c2.tOutMs === 80000 && c2.path !== before, c2.path.split(/[\\/]/).pop());
  } catch (err) {
    check('clip script threw', false, String(err && err.stack || err));
  }
  return out;
})()
`;

async function runClipChecks(main: BrowserWindow): Promise<Check[]> {
  const before = new Set(BrowserWindow.getAllWindows().map((w) => w.id));
  const res = (await main.webContents.executeJavaScript(
    `(async () => { const g = (await window.lvr.listGames())[0]; return window.lvr.exportClip(g.id, 60000, 75000, 'smoke clip'); })()`,
    true,
  )) as { ok: boolean; clip: { id: string } | null; error: string | null };
  const checks: Check[] = [{ name: 'exportClip creates a clip', ok: res.ok && !!res.clip, info: res.error }];
  const win = BrowserWindow.getAllWindows().find((w) => !before.has(w.id));
  checks.push({ name: 'clip window opened', ok: !!win, info: win?.webContents.getURL().split('#')[1] ?? null });
  if (!win || !res.clip) return checks;
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)));
  checks.push(...((await win.webContents.executeJavaScript(CLIP_SCRIPT, true)) as Check[]));
  const closed = new Promise((r) => win.once('closed', () => r(true)));
  await main.webContents.executeJavaScript(`window.lvr.deleteClip(${JSON.stringify(res.clip.id)})`, true);
  const ok = await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 3000))]);
  checks.push({ name: 'deleteClip closes its window', ok: ok === true, info: null });
  return checks;
}

/** Library delete flow through the UI. LVR_SMOKE_SHOTS=<dir> also saves screenshots of each step. */
async function runDeleteChecks(main: BrowserWindow): Promise<Check[]> {
  const js = <T>(code: string) => main.webContents.executeJavaScript(code, true) as Promise<T>;
  const shotsDir = process.env['LVR_SMOKE_SHOTS'];
  const shot = async (name: string) => {
    if (!shotsDir) return;
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(shotsDir, `${name}.png`), (await main.webContents.capturePage()).toPNG());
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const checks: Check[] = [];
  const check = (name: string, ok: unknown, info: unknown = null) => checks.push({ name, ok: !!ok, info });

  // review view: Delete asks first, Cancel keeps the game
  await js(`document.querySelector('table.games tbody tr')?.click()`);
  await wait(1500);
  const headButtons = await js<string[]>(`[...document.querySelectorAll('.game-head button')].map((b) => b.textContent.trim())`);
  check('review header has Show in folder + Delete', headButtons.includes('Show in folder') && headButtons.includes('Delete'), headButtons);
  await js(`[...document.querySelectorAll('.game-head button')].find((b) => b.textContent.trim() === 'Delete').click()`);
  await wait(300);
  await shot('1-review-confirm');
  check('review Delete opens the confirmation', await js(`!!document.querySelector('.confirm-dialog')`));
  await js(`[...document.querySelectorAll('.confirm-dialog button')].find((b) => b.textContent === 'Cancel').click()`);
  await wait(200);
  check('Cancel closes it and keeps the review open', await js(`!document.querySelector('.confirm-dialog') && !!document.querySelector('video')`));
  await shot('2-review-head');

  // library: select two rows, delete them through the dialog
  await js(`[...document.querySelectorAll('.game-head button')].find((b) => b.textContent.includes('Library')).click()`);
  await wait(800);
  const before = (await js<unknown[]>(`window.lvr.listGames()`)).length;
  await js(`[...document.querySelectorAll('td.lib-check input')].slice(0, 2).forEach((c) => c.click())`);
  await wait(200);
  check('selection bar shows 2 selected', (await js<string>(`document.querySelector('.lib-selection')?.textContent ?? ''`)).includes('2 selected'));
  await shot('3-library-selected');
  await js(`document.querySelector('.lib-selection button.danger').click()`);
  await wait(300);
  await shot('4-library-confirm');
  check('confirmation lists both games', (await js<number>(`document.querySelectorAll('.confirm-list li').length`)) === 2);
  await js(`document.querySelector('.confirm-dialog button.danger').click()`);
  await wait(1500);
  const after = (await js<unknown[]>(`window.lvr.listGames()`)).length;
  check('confirmed delete removes both games', after === before - 2, { before, after });
  check('table shows the rest', (await js<number>(`document.querySelectorAll('table.games tbody tr').length`)) === after);
  await shot('5-library-after');
  return checks;
}

export function maybeRunSmoke(win: BrowserWindow): void {
  if (process.env['LVR_SMOKE'] !== '1') return;
  const timeout = setTimeout(() => {
    console.log(JSON.stringify({ name: 'smoke timeout', ok: false }));
    app.exit(2);
  }, 60_000);
  win.webContents.once('did-finish-load', async () => {
    try {
      const results = (await win.webContents.executeJavaScript(SCRIPT, true)) as Check[];
      results.push(...(await runClipChecks(win)));
      results.push(...(await runDeleteChecks(win)));
      let failed = 0;
      for (const r of results) {
        if (!r.ok) failed++;
        console.log(JSON.stringify(r));
      }
      console.log(JSON.stringify({ summary: `${results.length - failed}/${results.length} passed` }));
      clearTimeout(timeout);
      app.exit(failed ? 1 : 0);
    } catch (err) {
      console.log(JSON.stringify({ name: 'smoke error', ok: false, info: String(err) }));
      clearTimeout(timeout);
      app.exit(2);
    }
  });
}
