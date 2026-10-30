import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Riot's public static data (Data Dragon): item names and costs for the game state panel.
 * One compact JSON per version is cached under `dir`, so it works offline after the first use.
 * Icons are loaded by the renderer straight from the CDN.
 */
const CDN = 'https://ddragon.leagueoflegends.com';

export interface DdItem {
  name: string;
  /** Total cost of one unit. */
  gold: number;
  /** Potions, elixirs, Control Wards: not counted in item gold. */
  consumable: boolean;
  trinket: boolean;
}

export interface DdragonData {
  version: string;
  items: Record<string, DdItem>;
  /** Numeric champion key ("24") → Data Dragon id ("Jax"). */
  champions: Record<string, string>;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export class Ddragon {
  private versions: Promise<string[] | null> | null = null;
  private readonly loaded = new Map<string, Promise<DdragonData | null>>();

  constructor(private readonly dir: string) {}

  /** Best data for a game version like "16.21.829.8620"; falls back to the latest, then to any cached copy. */
  async forPatch(gameVersion: string | null): Promise<DdragonData | null> {
    const mm = gameVersion?.split('.').slice(0, 2).join('.') ?? '';
    const versions = await this.versionList();
    const cached = this.cachedVersions();
    const pick = (list: string[]) => (mm && list.find((v) => v.startsWith(`${mm}.`))) || list[0];
    const v = versions ? pick(versions) : pick(cached);
    if (!v) return null;
    let p = this.loaded.get(v);
    if (!p) {
      p = this.load(v);
      this.loaded.set(v, p);
    }
    return p;
  }

  private versionList(): Promise<string[] | null> {
    this.versions ??= getJson(`${CDN}/api/versions.json`)
      .then((v) => (Array.isArray(v) ? (v as string[]) : null))
      .catch((e: Error) => {
        console.warn(`[ddragon] versions: ${e.message}`);
        this.versions = null; // retry next time
        return null;
      });
    return this.versions;
  }

  /** Cached versions, newest first. */
  private cachedVersions(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch {
      return [];
    }
  }

  private async load(version: string): Promise<DdragonData | null> {
    const file = join(this.dir, `${version}.json`);
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as DdragonData;
    } catch {
      /* not cached yet */
    }
    try {
      const [itemJson, champJson] = (await Promise.all([
        getJson(`${CDN}/cdn/${version}/data/en_US/item.json`),
        getJson(`${CDN}/cdn/${version}/data/en_US/champion.json`),
      ])) as [{ data: Record<string, { name: string; gold?: { total?: number }; consumed?: boolean; tags?: string[] }> }, { data: Record<string, { id: string; key: string }> }];
      const items: Record<string, DdItem> = {};
      for (const [id, it] of Object.entries(itemJson.data)) {
        items[id] = { name: it.name, gold: it.gold?.total ?? 0, consumable: Boolean(it.consumed), trinket: it.tags?.includes('Trinket') ?? false };
      }
      const champions: Record<string, string> = {};
      for (const c of Object.values(champJson.data)) champions[c.key] = c.id;
      const data: DdragonData = { version, items, champions };
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(file, JSON.stringify(data));
      return data;
    } catch (e) {
      console.warn(`[ddragon] ${version}: ${(e as Error).message}`);
      this.loaded.delete(version);
      return null;
    }
  }
}
