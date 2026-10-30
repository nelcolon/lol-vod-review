import { useMemo } from 'react';
import type { Game, GameResult } from '@shared/contracts';
import { RECORDABLE_QUEUES } from '@shared/contracts';
import { formatBytes, formatDate, formatDuration, RESULT_LABEL, REVIEW_LABEL, roleLabel } from '../lib/format';
import bottomIcon from '../assets/roles/bottom.png';
import jungleIcon from '../assets/roles/jungle.png';
import middleIcon from '../assets/roles/middle.png';
import topIcon from '../assets/roles/top.png';
import utilityIcon from '../assets/roles/utility.png';
import { DdIcon } from '../components/DdIcon';
import { useStore } from '../store';

const ROLE_ICON: Record<string, string> = { TOP: topIcon, JUNGLE: jungleIcon, MIDDLE: middleIcon, BOTTOM: bottomIcon, UTILITY: utilityIcon };

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

  const queuesPresent = useMemo(() => {
    const ids = new Set(games.map((g) => g.queueId));
    return RECORDABLE_QUEUES.filter((q) => ids.has(q.id)).concat(
      [...ids].filter((id) => !RECORDABLE_QUEUES.some((q) => q.id === id)).map((id) => ({ id, label: `Queue ${id}`, defaultOn: false })),
    );
  }, [games]);

  const filtered = games.filter((g) => (result === 'all' || g.result === result) && (queue === 'all' || g.queueId === queue));

  return (
    <section className="library">
      <div className="toolbar">
        <h1>Library</h1>
        <div className="spacer" />
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
      </div>
      {loading && games.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No games match. Recordings appear here after each game ends.</p>
      ) : (
        <table className="games">
          <thead>
            <tr>
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
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id} className={`res-${g.result}`} onClick={() => void openGame(g.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && void openGame(g.id)}>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
