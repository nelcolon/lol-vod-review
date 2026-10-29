import { describe, expect, it } from 'vitest';
import {
  ActivePlayerNameSchema,
  ActivePlayerSchema,
  AllGameDataSchema,
  GameStatsSchema,
  LiveClientErrorSchema,
  PlayerListSchema,
  RIOT_CA_PEM,
  playerGameName,
} from '../src/index.js';
import { fixture } from './helpers.js';

describe('live client fixtures', () => {
  it.each([
    ['allgamedata.json', AllGameDataSchema],
    ['allgamedata.spectator.json', AllGameDataSchema],
    ['activeplayer.json', ActivePlayerSchema],
    ['activeplayername.json', ActivePlayerNameSchema],
    ['activeplayername.spectator.json', ActivePlayerNameSchema],
    ['playerlist.json', PlayerListSchema],
    ['gamestats.json', GameStatsSchema],
    ['gamestats.practicetool.json', GameStatsSchema],
    ['error.spectator-400.json', LiveClientErrorSchema],
    ['error.not-found-404.json', LiveClientErrorSchema],
  ] as const)('%s parses', (name, schema) => {
    const r = schema.safeParse(fixture(name));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('allgamedata carries the events and players', () => {
    const d = AllGameDataSchema.parse(fixture('allgamedata.json'));
    expect(d.allPlayers).toHaveLength(10);
    expect(d.events.Events.length).toBeGreaterThan(10);
    expect(d.gameData.mapNumber).toBe(11);
  });

  it('spectator activePlayer is an error object', () => {
    const d = AllGameDataSchema.parse(fixture('allgamedata.spectator.json'));
    expect('error' in d.activePlayer).toBe(true);
  });

  it('player game name prefers riotIdGameName', () => {
    expect(playerGameName({ riotIdGameName: 'A', riotId: 'B#1' })).toBe('A');
    expect(playerGameName({ riotId: 'B C#1' })).toBe('B C');
    expect(playerGameName({ summonerName: 'S' })).toBe('S');
  });
});

describe('RIOT_CA_PEM', () => {
  it('is a PEM certificate', () => {
    expect(RIOT_CA_PEM).toMatch(/^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n$/);
  });

  it('parses as an X.509 cert for the LoL Game Engineering CA', async () => {
    const { X509Certificate } = await import('node:crypto');
    const cert = new X509Certificate(RIOT_CA_PEM as string);
    expect(cert.subject).toContain('LoL Game Engineering Certificate Authority');
    expect(cert.fingerprint256).toBe(
      'CA:8C:9D:32:5B:4C:DC:46:4C:6C:94:A5:85:C8:5E:91:EC:23:D4:0B:A5:BF:3A:E2:82:2B:95:1A:4A:50:4E:A3',
    );
  });
});
