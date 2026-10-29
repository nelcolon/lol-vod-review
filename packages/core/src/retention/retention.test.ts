import { describe, expect, it } from 'vitest';
import { checkFreeSpace, estimateGameBytes, formatBytes, planRetention, statfsAdapter, type RetentionGame } from './retention.js';

const GB = 1024 ** 3;
const games: RetentionGame[] = [
  { gameId: 'a', startedAt: 1000, pinned: false, sizeBytes: 3 * GB, status: 'ready' },
  { gameId: 'b', startedAt: 2000, pinned: true, sizeBytes: 3 * GB, status: 'ready' },
  { gameId: 'c', startedAt: 3000, pinned: false, sizeBytes: 3 * GB, status: 'ready' },
  { gameId: 'd', startedAt: 4000, pinned: false, sizeBytes: 3 * GB, status: 'ready' },
  { gameId: 'e', startedAt: 5000, pinned: false, sizeBytes: 3 * GB, status: 'recording' },
];

describe('planRetention', () => {
  it('does nothing under quota', () => {
    const plan = planRetention(games, 20 * GB);
    expect(plan.deletions).toEqual([]);
    expect(plan.bytesBefore).toBe(15 * GB);
    expect(plan.bytesAfter).toBe(15 * GB);
    expect(plan.overQuotaAfter).toBe(false);
  });

  it('deletes oldest unpinned first, skipping pinned and in-flight games', () => {
    const plan = planRetention(games, 7 * GB);
    expect(plan.deletions.map((d) => d.gameId)).toEqual(['a', 'c', 'd']);
    expect(plan.exempt).toEqual([{ gameId: 'b', reason: 'pinned' }]);
    expect(plan.bytesAfter).toBe(6 * GB);
    expect(plan.overQuotaAfter).toBe(false);
  });

  it('stops as soon as usage fits, in insertion-independent order', () => {
    const shuffled = [games[3]!, games[0]!, games[2]!];
    const plan = planRetention(shuffled, 6 * GB);
    expect(plan.deletions.map((d) => d.gameId)).toEqual(['a']);
  });

  it('reports when even deleting everything eligible is not enough', () => {
    const plan = planRetention(games, 2 * GB);
    expect(plan.deletions.map((d) => d.gameId)).toEqual(['a', 'c', 'd']);
    expect(plan.exempt.map((e) => e.gameId)).toEqual(['b', 'e']);
    expect(plan.bytesAfter).toBe(6 * GB);
    expect(plan.overQuotaAfter).toBe(true);
  });

  it('honours headroom and minimum age', () => {
    const plan = planRetention(games, 15 * GB, { headroomBytes: 3 * GB });
    expect(plan.deletions.map((d) => d.gameId)).toEqual(['a']);
    const recent = planRetention(games, 7 * GB, { minAgeMs: 10_000, nowMs: 12_000 });
    expect(recent.deletions.map((d) => d.gameId)).toEqual(['a']);
    expect(recent.exempt.map((e) => e.reason)).toEqual(['pinned', 'too recent', 'too recent', 'status recording']);
  });
});

describe('free space', () => {
  it('checks available space against the estimate plus margin', async () => {
    const statfs = async () => ({ availableBytes: 10 * GB });
    const ok = await checkFreeSpace({ statfs, path: 'C:\\rec', requiredBytes: 4 * GB, marginBytes: GB });
    expect(ok).toMatchObject({ ok: true, availableBytes: 10 * GB, requiredBytes: 5 * GB });
    const low = await checkFreeSpace({ statfs, path: 'C:\\rec', requiredBytes: 9.5 * GB, marginBytes: GB });
    expect(low.ok).toBe(false);
    expect(low.message).toContain('low disk');
  });

  it('adapts node:fs statfs', async () => {
    const adapted = statfsAdapter(async () => ({ bavail: 1000, bsize: 4096 }));
    expect(await adapted('x')).toEqual({ availableBytes: 4_096_000 });
  });

  it('estimates game size from bitrate and duration', () => {
    // 12 Mbps video + 160 kbps audio for 45 min ≈ 4.1 GB
    expect(estimateGameBytes()).toBeCloseTo(((12e6 + 160e3) / 8) * 2700, -3);
    expect(estimateGameBytes(8, 1800, 0)).toBe(1.8e9);
    expect(formatBytes(1.8e9)).toBe('1.8 GB');
    expect(formatBytes(512)).toBe('512 B');
  });
});
