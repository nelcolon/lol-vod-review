/**
 * Headless-ish smoke test driven by the real app: set `LVR_SMOKE=1` and the main process, once
 * the renderer has loaded, runs a script inside the page that exercises IPC, the lvr-media://
 * Range protocol and the <video> pipeline, prints one JSON line per check and exits with a
 * non-zero code on failure. Used by `npm run smoke` because nothing in this app is visually
 * verifiable from a terminal.
 */
import { app, type BrowserWindow } from 'electron';

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
    }
  } catch (err) {
    check('script threw', false, String(err && err.stack || err));
  }
  return out;
})()
`;

export function maybeRunSmoke(win: BrowserWindow): void {
  if (process.env['LVR_SMOKE'] !== '1') return;
  const timeout = setTimeout(() => {
    console.log(JSON.stringify({ name: 'smoke timeout', ok: false }));
    app.exit(2);
  }, 60_000);
  win.webContents.once('did-finish-load', async () => {
    try {
      const results = (await win.webContents.executeJavaScript(SCRIPT, true)) as { name: string; ok: boolean; info: unknown }[];
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
