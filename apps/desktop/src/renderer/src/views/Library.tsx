import { useMemo } from 'react';
import type { GameResult } from '@shared/contracts';
import { RECORDABLE_QUEUES } from '@shared/contracts';
import { formatBytes, formatDate, formatDuration, RESULT_LABEL, REVIEW_LABEL, roleLabel } from '../lib/format';
import { useStore } from '../store';

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
              <tr key={g.id} onClick={() => void openGame(g.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && void openGame(g.id)}>
                <td>{formatDate(g.startedAt)}</td>
                <td>
                  <strong>{g.myChampion}</strong> <span className="muted">{roleLabel(g.myRole)}</span>
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
