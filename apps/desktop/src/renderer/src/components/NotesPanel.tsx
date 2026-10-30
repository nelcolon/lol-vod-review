import type { Clip, Moment, Note } from '@shared/contracts';
import { formatTime } from '@shared/timeline-math';
import { CollapseToggle, useCollapsed } from '../lib/collapse';
import { useStore } from '../store';

interface Props {
  notes: Note[];
  clips: Clip[];
  moments: Moment[];
  onSeek: (ms: number) => void;
  onSelectMoment: (id: string | null) => void;
}

export function NotesPanel({ notes, clips, moments, onSeek, onSelectMoment }: Props) {
  const deleteNote = useStore((s) => s.deleteNote);
  const sorted = [...notes].sort((a, b) => a.videoTMs - b.videoTMs);
  const titleOf = (id: string | null) => (id ? moments.find((m) => m.id === id)?.title : null);
  const [collapsed, toggle] = useCollapsed('notes');

  if (collapsed) {
    return (
      <div className="notes-panel collapsed">
        <h4>
          <CollapseToggle collapsed onToggle={toggle} label="notes and clips" />
          Notes & bookmarks <span className="muted small">{sorted.length}</span> · Clips <span className="muted small">{clips.length}</span>
        </h4>
      </div>
    );
  }

  return (
    <div className="notes-panel">
      <div className="np-col">
        <h4>
          <CollapseToggle collapsed={false} onToggle={toggle} label="notes and clips" />
          Notes & bookmarks <span className="muted small">{sorted.length}</span>
        </h4>
        {sorted.length === 0 && <p className="muted small">Press B to drop a bookmark at the current time, or write a note on a moment.</p>}
        <ul>
          {sorted.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="link mono"
                onClick={() => {
                  onSelectMoment(n.momentId);
                  onSeek(n.videoTMs);
                }}
              >
                {formatTime(n.videoTMs)}
              </button>
              <span className="np-text">
                {titleOf(n.momentId) && <span className="muted small">{titleOf(n.momentId)} · </span>}
                {n.text || <em className="muted">bookmark</em>}
              </span>
              <button type="button" className="link danger" onClick={() => void deleteNote(n.id)} aria-label="Delete note">
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="np-col">
        <h4>
          Clips <span className="muted small">{clips.length}</span>
        </h4>
        {clips.length === 0 && <p className="muted small">Press ✂ Clip on a moment to make one. Clips open in their own window.</p>}
        <ul>
          {clips.map((c) => (
            <li key={c.id}>
              <button type="button" className="link mono" onClick={() => onSeek(c.tInMs)} title="Seek here in the game">
                {formatTime(c.tInMs)}
              </button>
              <button type="button" className="link np-text" onClick={() => void window.lvr.openClip(c.id)} title="Open the clip window">
                {c.title || c.path.split(/[\\/]/).pop()}
                {c.drawings.length > 0 && <span className="muted small"> · ✎ {c.drawings.length}</span>}
              </button>
              <span className="muted small mono">{formatTime(c.tOutMs - c.tInMs)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
