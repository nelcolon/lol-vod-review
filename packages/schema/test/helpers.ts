import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Fixtures are hand-built from the verbatim 2026 samples in
 * docs/research/notes/.../gapfill_live_events_vanguard.md with every Riot ID replaced
 * by a fake one. Replace/extend with sanitized event-dump output from real games.
 */
export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
export const fixtureText = (name: string): string => readFileSync(fixturePath(name), 'utf8');
export const fixture = (name: string): unknown => JSON.parse(fixtureText(name));
