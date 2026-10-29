import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventRow, Lane, Moment } from '@shared/contracts';
import { formatGameTime, formatTime, timeToPercent, xToTime } from '@shared/timeline-math';
import { eventTitle, KIND_LABEL } from '../lib/format';

interface Props {
  durationMs: number;
  currentMs: number;
  events: EventRow[];
  moments: Moment[];
  selectedMomentId: string | null;
  onSeek: (ms: number) => void;
  onSelectMoment: (id: string | null) => void;
  /** Called when a marker that belongs to a moment is clicked: seek to that moment's window start. */
  onGoToMoment: (m: Moment) => void;
}

/** Events that duplicate another marker at the same instant or carry no review value. */
const HIDDEN = new Set(['FirstBlood', 'FirstBrick', 'Multikill', 'MinionsSpawning', 'InhibRespawningSoon', 'InhibRespawned']);
const LANES: Lane[] = ['mine', 'team'];

interface Tooltip {
  pct: string;
  title: string;
  sub: string;
}

export function Timeline({ durationMs, currentMs, events, moments, selectedMomentId, onSeek, onSelectMoment, onGoToMoment }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  const momentByEvent = useMemo(() => {
    const map = new Map<string, Moment>();
    for (const m of moments) for (const id of m.eventIds) if (!map.has(id)) map.set(id, m);
    return map;
  }, [moments]);

  const visible = useMemo(() => events.filter((e) => !HIDDEN.has(e.name)), [events]);

  const ticks = useMemo(() => {
    if (durationMs <= 0) return [] as number[];
    const candidates = [5, 10, 15, 30, 60, 120, 300, 600];
    const stepS = candidates.find((s) => durationMs / 1000 / s <= 12) ?? 600;
    const out: number[] = [];
    for (let t = 0; t <= durationMs; t += stepS * 1000) out.push(t);
    return out;
  }, [durationMs]);

  const msFromPointer = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return xToTime(clientX - rect.left, { width: rect.width, durationMs });
    },
    [durationMs],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onSeek(msFromPointer(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ms = msFromPointer(e.clientX);
    setHoverMs(ms);
    if (dragging) onSeek(ms);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      setDragging(false);
      onSeek(msFromPointer(e.clientX));
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [dragging]);

  const markerClick = (e: React.MouseEvent, ev: EventRow) => {
    e.stopPropagation();
    const m = momentByEvent.get(ev.id);
    if (m) onGoToMoment(m);
    else {
      onSelectMoment(null);
      onSeek(Math.max(0, ev.videoTMs - 5000));
    }
  };

  const showTip = (ev: EventRow) => {
    const m = momentByEvent.get(ev.id);
    setTooltip({
      pct: timeToPercent(ev.videoTMs, durationMs),
      title: eventTitle(ev.name, ev.payload),
      sub: `${KIND_LABEL[ev.kind]} · ${formatGameTime(ev.gameTimeS)} game · ${formatTime(ev.videoTMs)} video${m ? ` · opens at ${formatTime(m.tStartMs)}` : ''}`,
    });
  };

  const playheadPct = timeToPercent(currentMs, durationMs);

  return (
    <div className={`timeline ${dragging ? 'dragging' : ''}`}>
      <div
        className="tl-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHoverMs(null);
          setTooltip(null);
        }}
      >
        <div className="tl-ruler">
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: timeToPercent(t, durationMs) }}>
              {formatTime(t)}
            </span>
          ))}
        </div>

        <div className="tl-moments">
          {moments.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`tl-moment theme-${m.theme} ${m.id === selectedMomentId ? 'selected' : ''}`}
              style={{ left: timeToPercent(m.tStartMs, durationMs), width: `calc(${timeToPercent(m.tEndMs - m.tStartMs, durationMs)})` }}
              title={`${m.title} · opens ${formatTime(m.tStartMs)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onGoToMoment(m);
              }}
            >
              <span className="tl-moment-score">{Math.round(m.score * 100)}</span>
            </button>
          ))}
        </div>

        {LANES.map((lane) => (
          <div key={lane} className={`tl-lane lane-${lane}`}>
            <span className="tl-lane-label">{lane === 'mine' ? 'me' : 'team'}</span>
            {visible
              .filter((ev) => ev.lane === lane)
              .map((ev) => {
                const inSelected = selectedMomentId !== null && momentByEvent.get(ev.id)?.id === selectedMomentId;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    className={`marker kind-${ev.kind} ${inSelected ? 'in-selected' : ''} ${ev.name === 'GameStart' || ev.name === 'GameEnd' ? 'edge' : ''}`}
                    style={{ left: timeToPercent(ev.videoTMs, durationMs) }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => markerClick(e, ev)}
                    onMouseEnter={() => showTip(ev)}
                    onMouseLeave={() => setTooltip(null)}
                    aria-label={eventTitle(ev.name, ev.payload)}
                  />
                );
              })}
          </div>
        ))}

        {hoverMs !== null && !tooltip && (
          <div className="tl-hover" style={{ left: timeToPercent(hoverMs, durationMs) }}>
            <span>{formatTime(hoverMs)}</span>
          </div>
        )}

        <div className="tl-playhead" style={{ left: playheadPct }}>
          <div className="tl-playhead-handle" />
        </div>

        {tooltip && (
          <div className="tl-tooltip" style={{ left: tooltip.pct }}>
            <strong>{tooltip.title}</strong>
            <span>{tooltip.sub}</span>
          </div>
        )}
      </div>
      <div className="tl-legend">
        <span className="lg kind-own_death">death</span>
        <span className="lg kind-own_kill">kill</span>
        <span className="lg kind-own_assist">assist</span>
        <span className="lg kind-objective">objective</span>
        <span className="lg kind-tower">tower</span>
        <span className="lg kind-ace">ace</span>
      </div>
    </div>
  );
}
