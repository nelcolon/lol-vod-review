import { useEffect, useMemo, useState } from 'react';
import type { CauseTag, Moment, Note } from '@shared/contracts';
import { CAUSE_TAGS } from '@shared/contracts';
import { formatGameTime, formatTime } from '@shared/timeline-math';
import { THEME_LABEL } from '../lib/format';
import { useStore } from '../store';

interface Props {
  moment: Moment;
  notes: Note[];
  currentMs: number;
  onSeek: (ms: number) => void;
  onReplay: (m: Moment) => void;
}

export function MomentCard({ moment, notes, currentMs, onSeek, onReplay }: Props) {
  const saveNote = useStore((s) => s.saveNote);
  const setTags = useStore((s) => s.setTags);
  const exportClip = useStore((s) => s.exportClip);

  const existing = useMemo(() => notes.filter((n) => n.momentId === moment.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null, [notes, moment.id]);
  const [text, setText] = useState(existing?.text ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setText(existing?.text ?? '');
    setSavedAt(null);
  }, [existing?.id, existing?.text, moment.id]);

  const dirty = text !== (existing?.text ?? '');

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const input: { id?: string; momentId: string; videoTMs: number; text: string } = { momentId: moment.id, videoTMs: moment.tTriggerMs, text };
    if (existing) input.id = existing.id;
    const n = await saveNote(input);
    setSaving(false);
    if (n) setSavedAt(Date.now());
  };

  const toggleTag = (t: CauseTag) => {
    const has = moment.tags.includes(t);
    void setTags(moment.id, has ? moment.tags.filter((x) => x !== t) : [...moment.tags, t]);
  };

  return (
    <div className={`moment-card theme-${moment.theme}`}>
      <div className="mc-head">
        <div>
          <span className={`theme-chip theme-${moment.theme}`}>{THEME_LABEL[moment.theme]}</span>
          <span className="score-inline">{Math.round(moment.score * 100)}</span>
          <h3>{moment.title}</h3>
          <div className="muted small">
            game {formatGameTime(moment.triggerGameTimeS)} · video {formatTime(moment.tTriggerMs)} · window {formatTime(moment.tStartMs)}–{formatTime(moment.tEndMs)}
            {moment.reviewedAt && ' · ✓ reviewed'}
          </div>
        </div>
        <div className="mc-actions">
          <button type="button" onClick={() => onReplay(moment)} title="Seek to the window start and play">
            Replay window
          </button>
          <button type="button" onClick={() => onSeek(Math.max(0, currentMs - 60_000))} title="Seek 60 s before the current position">
            Jump 60 s earlier
          </button>
          <button type="button" onClick={() => void exportClip(moment.tStartMs, moment.tEndMs)} title="ffmpeg -ss -to -c copy">
            Export clip
          </button>
        </div>
      </div>

      <ul className="reasons">
        {moment.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>

      <div className="prompt">
        <strong>What did I know?</strong> <strong>What should I have done?</strong>
      </div>

      <div className="tags">
        {CAUSE_TAGS.map((t) => (
          <button key={t} type="button" className={`tag ${moment.tags.includes(t) ? 'on' : ''}`} onClick={() => toggleTag(t)}>
            {t}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void save();
        }}
        placeholder="Your note (Ctrl+Enter to save)…"
        rows={3}
      />
      <div className="mc-foot">
        <button type="button" className="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
        {savedAt && !dirty && <span className="muted small">Saved</span>}
        {dirty && <span className="muted small">Unsaved changes</span>}
      </div>
    </div>
  );
}
