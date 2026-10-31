import { useMemo, useState } from 'react';
import type { Game, GameResult } from '@shared/contracts';
import { queueName, RECORDABLE_QUEUES } from '@shared/contracts';
import { formatBytes, formatDate, formatDuration, RESULT_LABEL, REVIEW_LABEL, roleLabel } from '../lib/format';
import bottomIcon from '../assets/roles/bottom.png';
import jungleIcon from '../assets/roles/jungle.png';
import middleIcon from '../assets/roles/middle.png';
import topIcon from '../assets/roles/top.png';
import utilityIcon from '../assets/roles/utility.png';
import { DdIcon } from '../components/DdIcon';
import { DeleteGamesDialog } from '../components/DeleteGamesDialog';
import { FolderIcon, TrashIcon } from '../components/Icons';
import { useStore } from '../store';

const ROLE_ICON: Record<string, string> = { TOP: topIcon, JUNGLE: jungleIcon, MIDDLE: middleIcon, BOTTOM: bottomIcon, UTILITY: utilityIcon };

const sorted = (names: Iterable<string>) => [...new Set(names)].filter(Boolean).sort((a, b) => a.localeCompare(b));

/** Search box over champion names with suggestions; matches any part of the name. */
function ChampSearch({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const id = `champ-${label.toLowerCase()}`;
  return (
    <label className="champ-search">
      {label}
      <span className="champ-search-box">
        <input
          type="search"
          list={id}
          value={value}
          placeholder="Any champion"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        />
        <datalist id={id}>
          {options.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </span>
    </label>
  );
}

/** "cait" matches Caitlyn, "lee sin" matches Lee Sin; case and spaces/apostrophes don't matter. */
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
const matches = (name: string, query: string) => !query.trim() || norm(name).includes(norm(query));

/** Champion portraits with a role badge, side by side; the first one larger. */
function Lineup({ champs, v }: { champs: Game['opponents']; v: string | null }) {
  if (champs.length === 0) return <span className="muted">—</span>;
  return (
    <span className="lib-vs">
      {champs.map((o, i) => (
        <span key={o.role} className={`lib-champ ${i > 0 ? 'secondary' : ''}`} title={`${o.champion} (${roleLabel(o.role)})`}>
          <span className="lib-portrait">
            <DdIcon v={v} kind="champion" id={o.championKey} label={o.champion} size={i === 0 ? 36 : 32} />
            {ROLE_ICON[o.role] && <img className="lib-role-badge" src={ROLE_ICON[o.role]} alt={roleLabel(o.role)} />}
          </span>
          <span>{o.champion}</span>
        </span>
      ))}
    </span>
  );
}

export function Library() {
  const games = useStore((s) => s.games);
  const loading = useStore((s) => s.gamesLoading);
  const result = useStore((s) => s.libraryResult);
  const queue = useStore((s) => s.libraryQueue);
  const setResult = useStore((s) => s.setLibraryResult);
  const setQueue = useStore((s) => s.setLibraryQueue);
  const openGame = useStore((s) => s.openGame);
  const recordingId = useStore((s) => (s.recorder && s.recorder.state !== 'idle' ? s.recorder.gameId : null));

  const queuesPresent = useMemo(() => {
    const ids = new Set(games.map((g) => g.queueId));
    return RECORDABLE_QUEUES.filter((q) => ids.has(q.id)).concat(
      [...ids].filter((id) => !RECORDABLE_QUEUES.some((q) => q.id === id)).map((id) => ({ id, label: queueName(id), defaultOn: false })),
    );
  }, [games]);

  const [champ, setChamp] = useState('');
  const [withChamp, setWithChamp] = useState('');
  const [against, setAgainst] = useState('');
  const champs = useMemo(() => sorted(games.map((g) => g.myChampion)), [games]);
  const withChamps = useMemo(() => sorted(games.flatMap((g) => g.allies.map((a) => a.champion))), [games]);
  const againstChamps = useMemo(() => sorted(games.flatMap((g) => g.opponents.map((o) => o.champion))), [games]);

  const filtered = games.filter(
    (g) =>
      (result === 'all' || g.result === result) &&
      (queue === 'all' || g.queueId === queue) &&
      matches(g.myChampion, champ) &&
      (!withChamp.trim() || g.allies.some((a) => matches(a.champion, withChamp))) &&
      (!against.trim() || g.opponents.some((o) => matches(o.champion, against))),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<Game[] | null>(null);
  const isRecording = (g: Game) => g.status === 'recording' || g.id === recordingId;
  const deletable = filtered.filter((g) => !isRecording(g));
  // only rows still shown count (a filter or a delete may have hidden some)
  const picked = deletable.filter((g) => selected.has(g.id));
  const allPicked = deletable.length > 0 && picked.length === deletable.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const anyFilter = result !== 'all' || queue !== 'all' || !!champ.trim() || !!withChamp.trim() || !!against.trim();

  return (
    <section className="library">
      <div className="toolbar">
        <h1>Library</h1>
        <div className="spacer" />
        <ChampSearch label="Champion" value={champ} options={champs} onChange={setChamp} />
        <ChampSearch label="With" value={withChamp} options={withChamps} onChange={setWithChamp} />
        <ChampSearch label="Against" value={against} options={againstChamps} onChange={setAgainst} />
        <label>
          Result
          <select value={result} onChange={(e) => setResult(e.target.value as 'all' | GameResult)}>
            <option value="all">All</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
            <option value="remake">Remakes</option>
          </select>
        </label>
        <label>
          Queue
          <select value={String(queue)} onChange={(e) => setQueue(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All</option>
            {queuesPresent.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        {anyFilter && (
          <button
            type="button"
            className="link small"
            onClick={() => {
              setResult('all');
              setQueue('all');
              setChamp('');
              setWithChamp('');
              setAgainst('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {picked.length > 0 && (
        <div className="lib-selection">
          <strong>{picked.length} selected</strong>
          <button type="button" className="danger" onClick={() => setToDelete(picked)}>
            Delete selected
          </button>
          <button type="button" className="link small" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      {toDelete && (
        <DeleteGamesDialog
          games={toDelete}
          onClose={(deleted) => {
            setToDelete(null);
            if (deleted.length) setSelected((prev) => new Set([...prev].filter((id) => !deleted.includes(id))));
          }}
        />
      )}
      {loading && games.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No games match. Recordings appear here after each game ends.</p>
      ) : (
        <table className="games">
          <thead>
            <tr>
              <th className="lib-check">
                <input
                  type="checkbox"
                  checked={allPicked}
                  ref={(el) => {
                    if (el) el.indeterminate = picked.length > 0 && !allPicked;
                  }}
                  onChange={() => setSelected(allPicked ? new Set() : new Set(deletable.map((g) => g.id)))}
                  disabled={deletable.length === 0}
                  title={allPicked ? 'Unselect all' : 'Select all shown'}
                  aria-label="Select all"
                />
              </th>
              <th>Date</th>
              <th>Champion</th>
              <th>With</th>
              <th>Against</th>
              <th>Queue</th>
              <th>Result</th>
              <th>KDA</th>
              <th>Duration</th>
              <th>Size</th>
              <th>Review</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr
                key={g.id}
                className={`res-${g.result} ${selected.has(g.id) ? 'selected' : ''}`}
                onClick={() => void openGame(g.id)}
                tabIndex={0}
                onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && void openGame(g.id)}
              >
                <td className="lib-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(g.id)}
                    disabled={isRecording(g)}
                    onChange={() => toggle(g.id)}
                    title={isRecording(g) ? 'Being recorded' : 'Select'}
                    aria-label={`Select ${g.myChampion} ${formatDate(g.startedAt)}`}
                  />
                </td>
                <td>{formatDate(g.startedAt)}</td>
                <td>
                  <span className="lib-champ">
                    <DdIcon v={g.iconVersion} kind="champion" id={g.myChampionKey} label={g.myChampion} size={36} />
                    {ROLE_ICON[g.myRole] ? <img className="lib-role" src={ROLE_ICON[g.myRole]} alt={roleLabel(g.myRole)} title={roleLabel(g.myRole)} /> : <span className="lib-role" />}
                    <span>
                      <strong>{g.myChampion}</strong>
                      <span className="muted small">{ROLE_ICON[g.myRole] ? roleLabel(g.myRole) : ''}</span>
                    </span>
                  </span>
                </td>
                <td>
                  <Lineup champs={g.allies} v={g.iconVersion} />
                </td>
                <td>
                  <Lineup champs={g.opponents} v={g.iconVersion} />
                </td>
                <td>{g.queueName}</td>
                <td>
                  <span className={`result ${g.result}`}>{RESULT_LABEL[g.result]}</span>
                </td>
                <td className="mono">
                  {g.kills}/{g.deaths}/{g.assists}
                </td>
                <td className="mono">{formatDuration(g.durationS)}</td>
                <td className="mono">{formatBytes(g.sizeBytes)}</td>
                <td>
                  <span className={`review ${g.reviewStatus}`}>{REVIEW_LABEL[g.reviewStatus]}</span>
                </td>
                <td className="lib-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="icon-btn" onClick={() => void window.lvr.revealGame(g.id)} title="Show in folder" aria-label="Show in folder">
                    <FolderIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger-hover"
                    onClick={() => setToDelete([g])}
                    disabled={isRecording(g)}
                    title={isRecording(g) ? 'Being recorded' : 'Delete'}
                    aria-label="Delete"
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
