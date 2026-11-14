/**
 * Storage quota: once the recordings take more than Settings → Storage quota, the oldest games
 * are deleted (games with clips or notes, and the one being recorded, are kept). Runs when the app
 * starts and after each game, never while you type a new quota, and on demand from Settings.
 */
import { planRetention } from '@lvr/core';
import type { RetentionResult, StorageUsage } from '../shared/contracts';
import type { Backend } from './backend';
import { deleteGame } from './delete-game';
import type { SettingsStore } from './settings';

const GB = 1024 ** 3;

export class Retention {
  private running: Promise<RetentionResult> | null = null;

  constructor(private readonly o: { backend: Backend; settings: SettingsStore; notify: (text: string) => void }) {}

  private async plan() {
    return planRetention(await this.o.backend.retentionCandidates(), this.o.settings.get().quotaGb * GB);
  }

  async usage(): Promise<StorageUsage> {
    const plan = await this.plan();
    return {
      usedBytes: plan.bytesBefore,
      quotaBytes: plan.quotaBytes,
      deleteCount: plan.deletions.length,
      deleteBytes: plan.bytesBefore - plan.bytesAfter,
      keptCount: plan.overQuotaAfter ? plan.exempt.length : 0,
    };
  }

  /** Deletes what the quota requires; one run at a time. */
  run(): Promise<RetentionResult> {
    this.running ??= this.enforce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async enforce(): Promise<RetentionResult> {
    const plan = await this.plan();
    const result: RetentionResult = { deleted: 0, freedBytes: 0, failed: 0 };
    for (const d of plan.deletions) {
      try {
        await deleteGame(this.o.backend, d.gameId);
        result.deleted++;
        result.freedBytes += d.bytes;
      } catch (err) {
        result.failed++;
        console.warn(`[retention] game ${d.gameId} not deleted: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (result.deleted) {
      const gb = (result.freedBytes / GB).toFixed(1);
      const msg = `Deleted ${result.deleted} old ${result.deleted === 1 ? 'game' : 'games'} (${gb} GB) to stay under your ${this.o.settings.get().quotaGb} GB storage quota.`;
      console.log(`[retention] ${msg}`);
      this.o.notify(msg);
    }
    return result;
  }
}
