import { useState } from 'react';
import type { Game } from '@shared/contracts';
import { formatBytes, formatDate } from '../lib/format';
import { useStore } from '../store';
import { ConfirmDialog } from './ConfirmDialog';

/** Asks before deleting one or more games, then deletes them. */
export function DeleteGamesDialog({ games, onClose }: { games: Game[]; onClose: (deleted: string[]) => void }) {
  const deleteGames = useStore((s) => s.deleteGames);
  const [busy, setBusy] = useState(false);
  const one = games.length === 1 ? games[0]! : null;
  const bytes = games.reduce((n, g) => n + g.sizeBytes, 0);
  const size = bytes > 0 ? ` (${formatBytes(bytes)})` : '';

  const confirm = async () => {
    setBusy(true);
    const deleted = await deleteGames(games.map((g) => g.id));
    onClose(deleted);
  };

  return (
    <ConfirmDialog
      title={one ? 'Delete this game?' : `Delete ${games.length} games?`}
      confirmLabel={one ? 'Delete game' : `Delete ${games.length} games`}
      busy={busy}
      onConfirm={() => void confirm()}
      onCancel={() => onClose([])}
    >
      {one ? (
        <p>
          <strong>{one.myChampion || 'Unknown champion'}</strong> · {one.queueName} · {formatDate(one.startedAt)}
        </p>
      ) : (
        <ul className="confirm-list">
          {games.slice(0, 6).map((g) => (
            <li key={g.id}>
              <strong>{g.myChampion || 'Unknown champion'}</strong> · {g.queueName} · {formatDate(g.startedAt)}
            </li>
          ))}
          {games.length > 6 && <li className="muted">and {games.length - 6} more</li>}
        </ul>
      )}
      <p>
        {one ? 'The video' : 'Their videos'}
        {size}, notes, bookmarks and clips are removed from your PC. This can't be undone.
      </p>
    </ConfirmDialog>
  );
}
