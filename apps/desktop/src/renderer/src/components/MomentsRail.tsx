import { useEffect, useMemo, useRef } from 'react';
import type { Moment } from '@shared/contracts';
import { formatGameTime } from '@shared/timeline-math';
import { THEME_LABEL } from '../lib/format';
import { type LaneFilter, type ThemeFilter, useStore } from '../store';

interface Props {
  moments: Moment[];
  onGoToMoment: (m: Moment) => void;
}

const THEMES: ThemeFilter[] = ['all', 'deaths', 'objectives', 'kills', 'teamfights'];
const LANES: { v: LaneFilter; label: string }[] = [
  { v: 'all', label: 'All' },
  { v: 'mine', label: 'Mine' },
  { v: 'team', label: 'Team' },
];

export function filterMoments(moments: Moment[], theme: ThemeFilter, lane: LaneFilter): Moment[] {
  return moments
    .filter((m) => theme === 'all' || m.theme === theme)
    .filter((m) => lane === 'all' || (lane === 'mine' ? m.mine : !m.mine))
    .sort((a, b) => b.score - a.score || a.tTriggerMs - b.tTriggerMs);
}

export function MomentsRail({ moments, onGoToMoment }: Props) {
  const theme = useStore((s) => s.themeFilter);
  const lane = useStore((s) => s.laneFilter);
  const setTheme = useStore((s) => s.setThemeFilter);
  const setLane = useStore((s) => s.setLaneFilter);
  const selectedId = useStore((s) => s.selectedMomentId);
  const listRef = useRef<HTMLDivElement>(null);

  const list = useMemo(() => filterMoments(moments, theme, lane), [moments, theme, lane]);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <aside className="rail">
      <div className="rail-head">
        <h2>Moments</h2>
        <span className="muted small">{list.length}</span>
      </div>
      <div className="chips">
        {THEMES.map((t) => (
          <button key={t} type="button" className={`chip ${theme === t ? 'on' : ''}`} onClick={() => setTheme(t)}>
            {t === 'all' ? 'All' : THEME_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="chips">
        {LANES.map((l) => (
          <button key={l.v} type="button" className={`chip ${lane === l.v ? 'on' : ''}`} onClick={() => setLane(l.v)}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="moment-list" ref={listRef}>
        {list.length === 0 && <p className="muted small">No moments match these filters.</p>}
        {list.map((m) => (
          <button
            key={m.id}
            type="button"
            data-id={m.id}
            className={`moment theme-${m.theme} ${m.id === selectedId ? 'selected' : ''} ${m.reviewedAt ? 'reviewed' : ''}`}
            onClick={() => onGoToMoment(m)}
          >
            <span className="score" title="Review priority">
              {Math.round(m.score * 100)}
            </span>
            <span className="body">
              <span className="title">{m.title}</span>
              <span className="meta">
                <span className={`theme-chip theme-${m.theme}`}>{THEME_LABEL[m.theme]}</span>
                <span className="muted">{formatGameTime(m.triggerGameTimeS)}</span>
                {m.mine && <span className="muted">· you</span>}
                {m.reviewedAt && <span className="muted">· ✓ reviewed</span>}
              </span>
              <ul className="reasons">
                {m.reasons.slice(0, 2).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {m.tags.length > 0 && (
                <span className="tags">
                  {m.tags.map((t) => (
                    <span key={t} className="tag on">
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
