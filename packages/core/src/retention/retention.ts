/**
 * Retention (PLAN §3.9): quota in bytes, oldest unpinned games deleted first, clips and
 * pinned games exempt, pre-game free-space check.
 */

export interface RetentionGame {
  gameId: string;
  /** ms since epoch (games.started_at). */
  startedAt: number;
  pinned: boolean;
  /** Sum of segment sizes (clips are stored separately and never counted). */
  sizeBytes: number;
  /** A game still being recorded/processed is never deleted. */
  status?: 'recording' | 'processing' | 'ready' | 'error' | (string & {});
}

export interface RetentionDeletion {
  gameId: string;
  bytes: number;
  reason: string;
}

export interface RetentionPlan {
  quotaBytes: number;
  bytesBefore: number;
  bytesAfter: number;
  deletions: RetentionDeletion[];
  /** Games skipped because they are pinned or in flight. */
  exempt: Array<{ gameId: string; reason: string }>;
  /** True when deleting every eligible game still does not fit the quota. */
  overQuotaAfter: boolean;
}

export interface PlanRetentionOptions {
  /** Delete until usage ≤ quota − headroom (so the next game has room). Default 0. */
  headroomBytes?: number;
  /** Never delete games newer than this many ms (safety). Default 0. */
  minAgeMs?: number;
  nowMs?: number;
}

export function planRetention(games: readonly RetentionGame[], quotaBytes: number, options: PlanRetentionOptions = {}): RetentionPlan {
  const headroom = options.headroomBytes ?? 0;
  const minAge = options.minAgeMs ?? 0;
  const now = options.nowMs ?? Date.now();
  const target = Math.max(0, quotaBytes - headroom);

  const bytesBefore = games.reduce((s, g) => s + Math.max(0, g.sizeBytes), 0);
  const deletions: RetentionDeletion[] = [];
  const exempt: RetentionPlan['exempt'] = [];
  let bytes = bytesBefore;

  const candidates = [...games].sort((a, b) => a.startedAt - b.startedAt);
  for (const g of candidates) {
    if (bytes <= target) break;
    if (g.pinned) {
      exempt.push({ gameId: g.gameId, reason: 'pinned' });
      continue;
    }
    if (g.status === 'recording' || g.status === 'processing') {
      exempt.push({ gameId: g.gameId, reason: `status ${g.status}` });
      continue;
    }
    if (minAge > 0 && now - g.startedAt < minAge) {
      exempt.push({ gameId: g.gameId, reason: 'too recent' });
      continue;
    }
    deletions.push({ gameId: g.gameId, bytes: g.sizeBytes, reason: 'oldest unpinned over quota' });
    bytes -= Math.max(0, g.sizeBytes);
  }

  return { quotaBytes, bytesBefore, bytesAfter: bytes, deletions, exempt, overQuotaAfter: bytes > target };
}

// --- free space ------------------------------------------------------------------------

export interface StatfsLike {
  /** Available bytes to the current user on the volume holding `path`. */
  (path: string): Promise<{ availableBytes: number }>;
}

/** Adapter for `node:fs/promises`.statfs. */
export function statfsAdapter(statfs: (path: string, opts?: { bigint?: false }) => Promise<{ bavail: number; bsize: number }>): StatfsLike {
  return async (path) => {
    const s = await statfs(path);
    return { availableBytes: s.bavail * s.bsize };
  };
}

export interface FreeSpaceCheck {
  ok: boolean;
  availableBytes: number;
  requiredBytes: number;
  /** Human-readable, e.g. "12.3 GB free, 3.0 GB needed". */
  message: string;
}

export interface FreeSpaceOptions {
  statfs: StatfsLike;
  path: string;
  /** Bytes the next game is expected to need (see `estimateGameBytes`). */
  requiredBytes: number;
  /** Extra safety margin. Default 1 GiB. */
  marginBytes?: number;
}

/** Pre-game "low disk" check. */
export async function checkFreeSpace(options: FreeSpaceOptions): Promise<FreeSpaceCheck> {
  const margin = options.marginBytes ?? 1024 ** 3;
  const { availableBytes } = await options.statfs(options.path);
  const required = options.requiredBytes + margin;
  const ok = availableBytes >= required;
  return {
    ok,
    availableBytes,
    requiredBytes: required,
    message: `${formatBytes(availableBytes)} free, ${formatBytes(required)} needed${ok ? '' : ' — low disk'}`,
  };
}

/** Expected file size for a recording: bitrate (Mbps) × duration. Default 45 min at 12 Mbps ≈ 4 GB. */
export function estimateGameBytes(bitrateMbps = 12, durationS = 45 * 60, audioKbps = 160): number {
  return Math.round(((bitrateMbps * 1e6 + audioKbps * 1e3) / 8) * durationS);
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}
