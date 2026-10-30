import { useEffect, useRef, useState } from 'react';
import type { EventRow } from '@shared/contracts';
import { clamp, formatGameTime, formatTime } from '@shared/timeline-math';
import { eventTitle } from '../lib/format';
import { player } from '../lib/player';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const HIDE_AFTER_MS = 2500;
const SHOWN_KINDS = new Set(['own_death', 'own_kill', 'own_assist', 'objective', 'tower', 'ace']);

interface Props {
  events: EventRow[];
  durationMs: number;
  currentMs: number;
  playing: boolean;
  muted: boolean;
  rate: number;
  onSeek: (ms: number) => void;
  onClip: () => void;
  onBookmark: () => void;
  onExit: () => void;
}

/**
 * Controls drawn over the video in fullscreen: event markers above a seek bar, then play,
 * volume, time, speed, clip, bookmark and exit. Hides with the cursor after a few idle
 * seconds while playing.
 */
export function FullscreenBar({ events, durationMs, currentMs, playing, muted, rate, onSeek, onClip, onBookmark, onExit }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [volume, setVolume] = useState(() => player.element?.volume ?? 1);
  const scrubbing = useRef(false);

  // show on mouse movement, hide after a while (never while paused or hovering the bar)
  useEffect(() => {
    const wrap = barRef.current?.parentElement;
    if (!wrap) return;
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!barRef.current?.matches(':hover') && !scrubbing.current) setIdle(true);
      }, HIDE_AFTER_MS);
    };
    wake();
    wrap.addEventListener('mousemove', wake);
    wrap.addEventListener('mousedown', wake);
    return () => {
      wrap.removeEventListener('mousemove', wake);
      wrap.removeEventListener('mousedown', wake);
      window.clearTimeout(timer);
    };
  }, []);
  const hidden = idle && playing;
  useEffect(() => {
    barRef.current?.parentElement?.classList.toggle('fs-idle', hidden);
  }, [hidden]);

  const msAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * durationMs;
  };
  const pct = (ms: number) => `${durationMs > 0 ? (ms / durationMs) * 100 : 0}%`;

  const setVol = (v: number) => {
    const el = player.element;
    setVolume(v);
    if (!el) return;
    el.volume = v;
    player.setMuted(v === 0);
  };
  const speedIdx = Math.max(0, SPEEDS.indexOf(rate));

  return (
    <div ref={barRef} className={`fs-bar ${hidden ? 'hidden' : ''}`} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="fs-markers">
        {events
          .filter((e) => SHOWN_KINDS.has(e.kind) && e.videoTMs >= 0)
          .map((e) => (
            <button
              key={e.id}
              type="button"
              className={`marker kind-${e.kind} ${e.lane === 'mine' ? 'mine' : ''}`}
              style={{ left: pct(e.videoTMs) }}
              title={`${eventTitle(e.name, e.payload)} · ${formatGameTime(e.gameTimeS)}`}
              onClick={() => onSeek(Math.max(0, e.videoTMs - 5000))}
            />
          ))}
      </div>
      <div
        ref={trackRef}
        className="fs-track"
        onPointerDown={(e) => {
          scrubbing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(msAt(e.clientX));
        }}
        onPointerMove={(e) => {
          setHoverMs(msAt(e.clientX));
          if (scrubbing.current) onSeek(msAt(e.clientX));
        }}
        onPointerUp={() => (scrubbing.current = false)}
        onPointerLeave={() => setHoverMs(null)}
      >
        <div className="fs-fill" style={{ width: pct(currentMs) }} />
        <div className="fs-knob" style={{ left: pct(currentMs) }} />
        {hoverMs !== null && (
          <span className="fs-hover" style={{ left: pct(hoverMs) }}>
            {formatTime(hoverMs)}
          </span>
        )}
      </div>
      <div className="fs-controls">
        <button type="button" className="fs-btn" onClick={() => player.toggle()} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="fs-btn" onClick={() => player.toggleMute()} title="Mute (M)">
          {muted || volume === 0 ? '🔇' : '🔊'}
        </button>
        <input
          className="fs-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => setVol(Number(e.target.value))}
          title="Volume"
        />
        <span className="mono fs-time">
          {formatTime(currentMs)} / {formatTime(durationMs)}
        </span>
        <span className="spacer" />
        <span className="fs-speed">
          <button type="button" className="fs-btn" onClick={() => player.setRate(SPEEDS[Math.max(0, speedIdx - 1)]!)} title="Slower">
            −
          </button>
          <span className="mono">{rate}×</span>
          <button type="button" className="fs-btn" onClick={() => player.setRate(SPEEDS[Math.min(SPEEDS.length - 1, speedIdx + 1)]!)} title="Faster">
            +
          </button>
        </span>
        <button type="button" className="fs-pill" onClick={onClip} title="Clip the last 10 s and the next 5 s">
          ✂ Add clip
        </button>
        <button type="button" className="fs-pill" onClick={onBookmark} title="Bookmark this moment (B)">
          ★ Bookmark
        </button>
        <button type="button" className="fs-btn" onClick={onExit} title="Exit fullscreen (Esc / F)">
          ⤡
        </button>
      </div>
    </div>
  );
}
