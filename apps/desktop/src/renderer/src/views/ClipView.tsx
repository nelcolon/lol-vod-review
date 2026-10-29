/**
 * Clip window (`#clip=<id>`): a sub-video of a game. Plays the original game video inside the
 * clip's range, so trimming is instant and lossless; saving a new range re-cuts the MP4.
 * Telestrator drawings are stored on the clip and shown for `holdMs` from their time;
 * playback pauses when it reaches one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipBundle, Drawing, DrawShape, DrawTool } from '@shared/contracts';
import { clamp, formatGameTime, formatTime } from '@shared/timeline-math';
import { DrawLayer } from '../components/DrawLayer';
import { player } from '../lib/player';
import { useKeyboard } from '../lib/useKeyboard';

const PAD_MS = 30_000;
const HOLD_MS = 3_000;
const COLORS = ['#ff4d4f', '#ffd60a', '#2ee6d6', '#ffffff'];
const TOOLS: Array<{ t: DrawTool; label: string }> = [
  { t: 'arrow', label: 'Arrow' },
  { t: 'circle', label: 'Circle' },
  { t: 'pen', label: 'Pen' },
];
const RATES: Record<string, number> = { '1': 1, '2': 1.5, '3': 2, '4': 4 };

const newId = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function ClipView({ clipId }: { clipId: string }) {
  const [bundle, setBundle] = useState<ClipBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inMs, setInMs] = useState(0);
  const [outMs, setOutMs] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(player.muted);
  const [rate, setRate] = useState(1);
  const [drawMode, setDrawMode] = useState(false);
  const [tool, setTool] = useState<DrawTool>('arrow');
  const [color, setColor] = useState(COLORS[0]!);
  const [draft, setDraft] = useState<DrawShape[]>([]);
  const [editing, setEditing] = useState<Drawing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const prevMs = useRef(0);

  const load = useCallback(async () => {
    const b = await window.lvr.getClip(clipId);
    if (!b) {
      setError('This clip no longer exists.');
      return;
    }
    setBundle(b);
    setInMs(b.clip.tInMs);
    setOutMs(b.clip.tOutMs);
    setTitle(b.clip.title);
    setDescription(b.clip.description);
    setDrawings(b.clip.drawings);
  }, [clipId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.title = `${title || 'Clip'} · LoL VOD Review`;
  }, [title]);

  const segment = bundle?.segment ?? null;
  const fps = segment?.fps || 60;
  const aspect = segment && segment.width && segment.height ? segment.width / segment.height : 16 / 9;
  const src = useMemo(() => (segment ? window.lvr.mediaUrl(segment.path) : ''), [segment]);
  const saved = bundle?.clip;
  const viewStart = saved ? Math.max(0, saved.tInMs - PAD_MS) : 0;
  const viewEnd = saved ? Math.min(segment?.durationMs || Infinity, saved.tOutMs + PAD_MS) : 1;
  const span = Math.max(1, viewEnd - viewStart);
  const pct = (ms: number) => `${((clamp(ms, viewStart, viewEnd) - viewStart) / span) * 100}%`;

  // --- video wiring --------------------------------------------------------------------------
  useEffect(() => {
    const el = videoRef.current;
    player.attach(el);
    if (!el || !saved) return;
    el.muted = player.muted;
    const onMeta = () => {
      el.currentTime = saved.tInMs / 1000;
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolume = () => setMuted(el.muted);
    const onRate = () => setRate(el.playbackRate);
    const onSeeked = () => {
      prevMs.current = el.currentTime * 1000;
      setCur(prevMs.current);
    };
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('volumechange', onVolume);
    el.addEventListener('ratechange', onRate);
    el.addEventListener('seeked', onSeeked);
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('volumechange', onVolume);
      el.removeEventListener('ratechange', onRate);
      el.removeEventListener('seeked', onSeeked);
      player.attach(null);
    };
    // only when the clip itself (not the draft range) changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.id, src]);

  // Playhead loop: stop at the out-point and pause on drawings.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const t = player.currentMs;
      const prev = prevMs.current;
      const hit = drawings.find((d) => prev < d.tMs && d.tMs <= t);
      if (hit) {
        player.pause();
        player.seek(hit.tMs);
      } else if (prev < outMs && t >= outMs) {
        player.pause();
        player.seek(outMs);
      } else if (t >= viewEnd) {
        player.pause();
      }
      prevMs.current = player.currentMs;
      setCur(prevMs.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, drawings, outMs, viewEnd]);

  const seek = useCallback((ms: number) => {
    const t = clamp(ms, viewStart, viewEnd);
    player.seek(t);
    prevMs.current = t;
    setCur(t);
  }, [viewStart, viewEnd]);

  const togglePlay = useCallback(() => {
    if (drawMode) return;
    if (player.element?.paused && (player.currentMs >= outMs - 50 || player.currentMs < inMs)) seek(inMs);
    player.toggle();
  }, [drawMode, inMs, outMs, seek]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  // --- persistence ---------------------------------------------------------------------------
  const persist = useCallback(
    async (patch: Parameters<typeof window.lvr.updateClip>[1], label: string) => {
      setBusy(label);
      try {
        const clip = await window.lvr.updateClip(clipId, patch);
        setBundle((b) => (b ? { ...b, clip } : b));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [clipId],
  );

  const trimDirty = !!saved && (inMs !== saved.tInMs || outMs !== saved.tOutMs);
  const saveTrim = () => void persist({ tInMs: Math.round(inMs), tOutMs: Math.round(outMs) }, 'Cutting clip…');
  const resetTrim = () => {
    if (!saved) return;
    setInMs(saved.tInMs);
    setOutMs(saved.tOutMs);
  };
  const setIn = useCallback((t: number) => setInMs(clamp(Math.round(t), viewStart, outMs - 1000)), [viewStart, outMs]);
  const setOut = useCallback((t: number) => setOutMs(clamp(Math.round(t), inMs + 1000, viewEnd)), [inMs, viewEnd]);

  // --- drawing -------------------------------------------------------------------------------
  const startDrawing = useCallback(() => {
    player.pause();
    const t = player.currentMs;
    const at = drawings.find((d) => Math.abs(d.tMs - t) < 60) ?? null;
    setEditing(at);
    setDraft(at ? at.shapes : []);
    setDrawMode(true);
  }, [drawings]);

  const cancelDrawing = useCallback(() => {
    setDrawMode(false);
    setDraft([]);
    setEditing(null);
  }, []);

  const finishDrawing = useCallback(() => {
    let next: Drawing[];
    if (editing) {
      next = draft.length ? drawings.map((d) => (d.id === editing.id ? { ...d, shapes: draft } : d)) : drawings.filter((d) => d.id !== editing.id);
    } else if (draft.length) {
      next = [...drawings, { id: newId(), tMs: Math.round(player.currentMs), holdMs: HOLD_MS, shapes: draft }].sort((a, b) => a.tMs - b.tMs);
    } else {
      cancelDrawing();
      return;
    }
    setDrawings(next);
    cancelDrawing();
    void persist({ drawings: next }, 'Saving drawing…');
  }, [editing, draft, drawings, cancelDrawing, persist]);

  const deleteDrawing = (id: string) => {
    const next = drawings.filter((d) => d.id !== id);
    setDrawings(next);
    void persist({ drawings: next }, 'Saving…');
  };

  const visibleShapes = useMemo(() => {
    if (drawMode) return draft;
    return drawings.filter((d) => cur >= d.tMs - 30 && cur < d.tMs + d.holdMs).flatMap((d) => d.shapes);
  }, [drawMode, draft, drawings, cur]);

  // --- keyboard ------------------------------------------------------------------------------
  const handlers = useMemo(
    () => ({
      ' ': () => togglePlay(),
      ArrowLeft: () => seek(player.currentMs - 5_000),
      ArrowRight: () => seek(player.currentMs + 5_000),
      ',': () => player.stepFrame(-1, fps),
      '.': () => player.stepFrame(1, fps),
      m: () => player.toggleMute(),
      M: () => player.toggleMute(),
      f: () => toggleFullscreen(),
      F: () => toggleFullscreen(),
      d: () => (drawMode ? finishDrawing() : startDrawing()),
      D: () => (drawMode ? finishDrawing() : startDrawing()),
      i: () => setIn(player.currentMs),
      I: () => setIn(player.currentMs),
      o: () => setOut(player.currentMs),
      O: () => setOut(player.currentMs),
      z: () => drawMode && setDraft((s) => s.slice(0, -1)),
      Z: () => drawMode && setDraft((s) => s.slice(0, -1)),
      '1': () => player.setRate(RATES['1']!),
      '2': () => player.setRate(RATES['2']!),
      '3': () => player.setRate(RATES['3']!),
      '4': () => player.setRate(RATES['4']!),
      Escape: () => {
        if (drawMode) cancelDrawing();
        else if (document.fullscreenElement) void document.exitFullscreen();
      },
    }),
    [togglePlay, seek, fps, toggleFullscreen, drawMode, finishDrawing, startDrawing, setIn, setOut, cancelDrawing],
  );
  useKeyboard(handlers, Boolean(bundle));

  // --- trim handle dragging ------------------------------------------------------------------
  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return viewStart + clamp((clientX - r.left) / r.width, 0, 1) * span;
  };
  const dragHandle = (which: 'in' | 'out') => (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const t = timeAt(ev.clientX);
      if (which === 'in') setIn(t);
      else setOut(t);
      seek(t);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  if (error && !bundle) return <p className="muted pad">{error}</p>;
  if (!bundle || !segment || !saved) return <p className="muted pad">Loading clip…</p>;
  const { game } = bundle;
  const nearEvents = bundle.events.filter((e) => e.videoTMs >= viewStart && e.videoTMs <= viewEnd && e.name !== 'GameStart');

  return (
    <section className="clip-view">
      <div className="clip-head">
        <input
          className="clip-title"
          value={title}
          placeholder="Name this clip (e.g. Flash too early at drake)"
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== saved.title && void persist({ title }, 'Saving…')}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="muted small">
          {game.myChampion} · {game.queueName} · clip {formatTime(saved.tOutMs - saved.tInMs)}
        </span>
        <div className="spacer" />
        {busy && <span className="muted small">{busy}</span>}
        <button type="button" onClick={() => void window.lvr.revealPath(saved.path)}>
          Show file
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (confirm('Delete this clip and its file?')) void window.lvr.deleteClip(clipId);
          }}
        >
          Delete
        </button>
      </div>
      {error && <p className="error small">{error}</p>}

      <div className="clip-body">
        <div className="player-col">
          <div className="video-wrap clip-wrap" ref={wrapRef}>
            <video
              ref={videoRef}
              src={src}
              preload="auto"
              playsInline
              onClick={() => togglePlay()}
              // The two clicks of a double-click toggle play twice, so only fullscreen changes.
              onDoubleClick={toggleFullscreen}
            />
            <DrawLayer shapes={visibleShapes} aspect={aspect} editable={drawMode} tool={tool} color={color} onAdd={(s) => setDraft((d) => [...d, s])} />
          </div>

          {drawMode ? (
            <div className="controls draw-bar">
              <strong>Drawing at {formatTime(cur, true)}</strong>
              <div className="chips">
                {TOOLS.map(({ t, label }) => (
                  <button key={t} type="button" className={`chip ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="swatches">
                {COLORS.map((c) => (
                  <button key={c} type="button" className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`color ${c}`} />
                ))}
              </div>
              <button type="button" onClick={() => setDraft((s) => s.slice(0, -1))} disabled={!draft.length} title="Z">
                Undo
              </button>
              <button type="button" onClick={() => setDraft([])} disabled={!draft.length}>
                Clear
              </button>
              <div className="spacer" />
              <button type="button" onClick={cancelDrawing} title="Esc">
                Cancel
              </button>
              <button type="button" className="primary" onClick={finishDrawing} title="D">
                Done
              </button>
            </div>
          ) : (
            <div className="controls">
              <button type="button" onClick={togglePlay} title="Space">
                {playing ? 'Pause' : 'Play'}
              </button>
              <button type="button" onClick={() => seek(player.currentMs - 5_000)} title="←">
                −5 s
              </button>
              <button type="button" onClick={() => seek(player.currentMs + 5_000)} title="→">
                +5 s
              </button>
              <button type="button" onClick={() => player.stepFrame(-1, fps)} title=",">
                ◂ frame
              </button>
              <button type="button" onClick={() => player.stepFrame(1, fps)} title=".">
                frame ▸
              </button>
              <button type="button" className={muted ? 'on' : ''} onClick={() => player.toggleMute()} title="M">
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" className="primary" onClick={startDrawing} title="D">
                ✎ Draw
              </button>
              <span className="mono time">
                {formatTime(cur - inMs, true)} / {formatTime(outMs - inMs)}
              </span>
              <div className="spacer" />
              <div className="chips">
                {Object.entries(RATES).map(([key, r]) => (
                  <button key={key} type="button" className={`chip ${rate === r ? 'on' : ''}`} onClick={() => player.setRate(r)} title={key}>
                    {r}×
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="clip-bar" ref={barRef} onPointerDown={(e) => seek(timeAt(e.clientX))}>
            <div className="clip-range" style={{ left: pct(inMs), width: `calc(${pct(outMs)} - ${pct(inMs)})` }} />
            {nearEvents.map((e) => (
              <span key={e.id} className={`clip-ev marker kind-${e.kind}`} style={{ left: pct(e.videoTMs) }} title={`${e.name} · ${formatGameTime(e.gameTimeS)}`} />
            ))}
            {drawings.map((d) => (
              <span key={d.id} className="clip-draw" style={{ left: pct(d.tMs) }} title={`Drawing at ${formatTime(d.tMs - inMs)}`} />
            ))}
            <span className="clip-handle in" style={{ left: pct(inMs) }} onPointerDown={dragHandle('in')} title="Drag to trim the start (I)" />
            <span className="clip-handle out" style={{ left: pct(outMs) }} onPointerDown={dragHandle('out')} title="Drag to trim the end (O)" />
            <span className="clip-playhead" style={{ left: pct(cur) }} />
          </div>
          <div className="clip-bar-legend muted small">
            <span>{formatTime(viewStart)}</span>
            <span>Drag the handles, or press I / O at the playhead, to trim. The grey area is the game around the clip.</span>
            <span>{formatTime(viewEnd)}</span>
          </div>
          {trimDirty && (
            <div className="trim-actions">
              <span className="small">
                New range {formatTime(inMs)}–{formatTime(outMs)} ({formatTime(outMs - inMs)})
              </span>
              <button type="button" onClick={resetTrim}>
                Reset
              </button>
              <button type="button" className="primary" onClick={saveTrim} disabled={!!busy}>
                Save trim
              </button>
            </div>
          )}
        </div>

        <aside className="clip-side">
          <h4>Description</h4>
          <textarea
            rows={6}
            value={description}
            maxLength={4000}
            placeholder="What happened, what should have happened…"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== saved.description && void persist({ description }, 'Saving…')}
          />
          <h4>
            Drawings <span className="muted small">{drawings.length}</span>
          </h4>
          {drawings.length === 0 && <p className="muted small">Pause where you want to explain something, press D (or ✎ Draw), then draw arrows and circles. Playback pauses on each drawing.</p>}
          <ul className="clip-drawings">
            {drawings.map((d) => (
              <li key={d.id}>
                <button type="button" className="link mono" onClick={() => seek(d.tMs)}>
                  {formatTime(d.tMs - inMs, true)}
                </button>
                <span className="muted small">{d.shapes.length} shape{d.shapes.length === 1 ? '' : 's'}</span>
                <button type="button" className="link danger" onClick={() => deleteDrawing(d.id)} aria-label="Delete drawing">
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small keys">Space play · ←/→ ±5 s · , . frame · D draw · Z undo · I/O trim · M mute · F fullscreen</p>
        </aside>
      </div>
    </section>
  );
}
