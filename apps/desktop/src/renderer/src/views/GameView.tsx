import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Moment } from '@shared/contracts';
import { formatTime, nextMomentIndex, prevMomentIndex } from '@shared/timeline-math';
import { MomentCard } from '../components/MomentCard';
import { MomentsRail } from '../components/MomentsRail';
import { NotesPanel } from '../components/NotesPanel';
import { PlayStatePanel } from '../components/PlayStatePanel';
import { Timeline } from '../components/Timeline';
import { formatDate, RESULT_LABEL, roleLabel } from '../lib/format';
import { player } from '../lib/player';
import { useKeyboard } from '../lib/useKeyboard';
import { useStore } from '../store';

const RATES: Record<string, number> = { '1': 1, '2': 1.5, '3': 2, '4': 4 };

export function GameView() {
  const bundle = useStore((s) => s.bundle);
  const loading = useStore((s) => s.bundleLoading);
  const playerState = useStore((s) => s.player);
  const setPlayer = useStore((s) => s.setPlayer);
  const selectedMomentId = useStore((s) => s.selectedMomentId);
  const selectMoment = useStore((s) => s.selectMoment);
  const navigate = useStore((s) => s.navigate);
  const saveNote = useStore((s) => s.saveNote);
  const showToast = useStore((s) => s.showToast);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const segment = bundle?.segments[0] ?? null;
  const fps = segment?.fps ?? 60;
  const src = useMemo(() => (segment ? window.lvr.mediaUrl(segment.path) : ''), [segment]);

  const momentsByTime = useMemo(() => [...(bundle?.moments ?? [])].sort((a, b) => a.tStartMs - b.tStartMs), [bundle]);
  const starts = useMemo(() => momentsByTime.map((m) => m.tStartMs), [momentsByTime]);
  const selected = bundle?.moments.find((m) => m.id === selectedMomentId) ?? null;

  // attach the <video> element to the controller and mirror its state into the store
  useEffect(() => {
    const el = videoRef.current;
    player.attach(el);
    if (!el) return;
    const sync = () => setPlayer({ currentMs: el.currentTime * 1000 });
    const onMeta = () => setPlayer({ durationMs: Number.isFinite(el.duration) ? el.duration * 1000 : (segment?.durationMs ?? 0) });
    const onPlay = () => setPlayer({ playing: true });
    const onPause = () => setPlayer({ playing: false });
    const onRate = () => setPlayer({ rate: el.playbackRate });
    const onVolume = () => setPlayer({ muted: el.muted });
    el.muted = player.muted;
    setPlayer({ muted: el.muted });
    const onError = () => showToast(`Video failed to load (${el.error?.code ?? '?'}). Is dev-assets/sample.mp4 present?`, 'error');
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('timeupdate', sync);
    el.addEventListener('seeked', sync);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ratechange', onRate);
    el.addEventListener('volumechange', onVolume);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('timeupdate', sync);
      el.removeEventListener('seeked', sync);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ratechange', onRate);
      el.removeEventListener('volumechange', onVolume);
      el.removeEventListener('error', onError);
      player.attach(null);
    };
  }, [segment, setPlayer, showToast]);

  // smooth playhead while playing (timeupdate is only ~4 Hz)
  useEffect(() => {
    if (!playerState.playing) return;
    const loop = () => {
      setPlayer({ currentMs: player.currentMs });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playerState.playing, setPlayer]);

  const seek = useCallback(
    (ms: number) => {
      player.seek(ms);
      setPlayer({ currentMs: ms });
    },
    [setPlayer],
  );

  const goToMoment = useCallback(
    (m: Moment) => {
      selectMoment(m.id);
      seek(m.tStartMs);
      player.play();
    },
    [seek, selectMoment],
  );

  // Fullscreen the video area only; Esc leaves fullscreen instead of going back to the library.
  const fsExitAt = useRef(0);
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) fsExitAt.current = performance.now();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  const addBookmark = useCallback(async () => {
    const t = player.currentMs;
    const n = await saveNote({ momentId: selectedMomentId, videoTMs: t, text: '' });
    if (n) showToast(`Bookmark at ${formatTime(t)}`);
  }, [saveNote, selectedMomentId, showToast]);

  const handlers = useMemo(
    () => ({
      ' ': () => player.toggle(),
      k: () => player.pause(),
      K: () => player.pause(),
      j: () => player.skip(-10_000),
      J: () => player.skip(-10_000),
      l: () => player.skip(10_000),
      L: () => player.skip(10_000),
      ArrowLeft: () => player.skip(-5_000),
      ArrowRight: () => player.skip(5_000),
      m: () => player.toggleMute(),
      M: () => player.toggleMute(),
      ',': () => player.stepFrame(-1, fps),
      '.': () => player.stepFrame(1, fps),
      '[': () => {
        const i = prevMomentIndex(starts, player.currentMs);
        const m = i >= 0 ? momentsByTime[i] : undefined;
        if (m) goToMoment(m);
      },
      ']': () => {
        const i = nextMomentIndex(starts, player.currentMs);
        const m = i >= 0 ? momentsByTime[i] : undefined;
        if (m) goToMoment(m);
      },
      '1': () => player.setRate(RATES['1']!),
      '2': () => player.setRate(RATES['2']!),
      '3': () => player.setRate(RATES['3']!),
      '4': () => player.setRate(RATES['4']!),
      b: () => void addBookmark(),
      B: () => void addBookmark(),
      f: () => toggleFullscreen(),
      F: () => toggleFullscreen(),
      Escape: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        // Chromium may already have left fullscreen on this same Esc press.
        else if (performance.now() - fsExitAt.current > 300) navigate({ view: 'library' });
      },
    }),
    [fps, starts, momentsByTime, goToMoment, addBookmark, navigate, toggleFullscreen],
  );
  useKeyboard(handlers, Boolean(bundle));

  if (loading || !bundle) return <p className="muted">Loading game…</p>;
  if (!segment) return <p className="muted">No video was recorded for this game.</p>;
  const { game } = bundle;
  const durationMs = playerState.durationMs || segment.durationMs;

  return (
    <section className="game">
      <div className="game-head">
        <button type="button" onClick={() => navigate({ view: 'library' })} title="Esc">
          ← Library
        </button>
        <h1>
          {game.myChampion} <span className="muted">{roleLabel(game.myRole)}</span>
        </h1>
        <span className={`result ${game.result}`}>{RESULT_LABEL[game.result]}</span>
        <span className="mono">
          {game.kills}/{game.deaths}/{game.assists}
        </span>
        <span className="muted">
          {game.queueName} · {formatDate(game.startedAt)} · patch {game.patch}
        </span>
        <div className="spacer" />
        <span className="muted small">{segment.width}×{segment.height}@{segment.fps} · {segment.codec}</span>
      </div>

      <div className="game-body">
        <div className="player-col">
          <div className="video-wrap" ref={wrapRef}>
            <video
              ref={videoRef}
              src={src}
              preload="auto"
              playsInline
              onClick={() => player.toggle()}
              // The two clicks of a double-click toggle play twice, so only fullscreen changes.
              onDoubleClick={toggleFullscreen}
            />
          </div>
          <div className="controls">
            <button type="button" onClick={() => player.toggle()} title="Space">
              {playerState.playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" onClick={() => player.skip(-10_000)} title="J">
              −10 s
            </button>
            <button type="button" onClick={() => player.skip(10_000)} title="L">
              +10 s
            </button>
            <button type="button" onClick={() => player.stepFrame(-1, fps)} title=",">
              ◂ frame
            </button>
            <button type="button" onClick={() => player.stepFrame(1, fps)} title=".">
              frame ▸
            </button>
            <button type="button" className={playerState.muted ? 'on' : ''} onClick={() => player.toggleMute()} title="M">
              {playerState.muted ? 'Unmute' : 'Mute'}
            </button>
            <span className="mono time">
              {formatTime(playerState.currentMs, true)} / {formatTime(durationMs)}
            </span>
            <div className="spacer" />
            <div className="chips">
              {Object.entries(RATES).map(([key, r]) => (
                <button key={key} type="button" className={`chip ${playerState.rate === r ? 'on' : ''}`} onClick={() => player.setRate(r)} title={key}>
                  {r}×
                </button>
              ))}
            </div>
          </div>

          <Timeline
            durationMs={durationMs}
            currentMs={playerState.currentMs}
            events={bundle.events}
            moments={bundle.moments}
            selectedMomentId={selectedMomentId}
            onSeek={seek}
            onSelectMoment={selectMoment}
            onGoToMoment={goToMoment}
          />

          {selected ? (
            <>
              <MomentCard moment={selected} notes={bundle.notes} currentMs={playerState.currentMs} onSeek={seek} onReplay={goToMoment} />
              <PlayStatePanel gameId={bundle.game.id} moment={selected} />
            </>
          ) : (
            <div className="moment-card empty muted">Pick a moment on the right (or press ] ) to start the review.</div>
          )}

          <NotesPanel notes={bundle.notes} clips={bundle.clips} moments={bundle.moments} onSeek={seek} onSelectMoment={selectMoment} />
        </div>

        <MomentsRail moments={bundle.moments} onGoToMoment={goToMoment} />
      </div>
    </section>
  );
}
