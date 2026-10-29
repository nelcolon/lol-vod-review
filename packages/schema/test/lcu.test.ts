import { describe, expect, it } from 'vitest';
import {
  CurrentSummonerSchema,
  GAMEFLOW_PHASES,
  GameflowPhaseResponseSchema,
  GameflowPhaseSchema,
  GameflowSessionSchema,
  lcuAuthHeader,
  lcuBaseUrl,
  parseLockfile,
} from '../src/index.js';
import { fixture, fixtureText } from './helpers.js';

describe('lockfile', () => {
  it('parses ProcessName:PID:Port:Password:Protocol', () => {
    const lf = parseLockfile(fixtureText('lcu/lockfile.txt'));
    expect(lf).toEqual({ processName: 'LeagueClient', pid: 23456, port: 54321, password: 'FAKEpassw0rd_xyz', protocol: 'https' });
    expect(lcuBaseUrl(lf)).toBe('https://127.0.0.1:54321');
    expect(lcuAuthHeader(lf)).toBe(`Basic ${Buffer.from('riot:FAKEpassw0rd_xyz').toString('base64')}`);
  });

  it('tolerates trailing newline / CRLF', () => {
    expect(parseLockfile('LeagueClient:1:2:pw:https\r\n').port).toBe(2);
  });

  it('rejects malformed content', () => {
    expect(() => parseLockfile('')).toThrow();
    expect(() => parseLockfile('a:b:c')).toThrow();
    expect(() => parseLockfile('LeagueClient:x:2:pw:https')).toThrow();
  });
});

describe('gameflow', () => {
  it('has all 14 phases', () => {
    expect(GAMEFLOW_PHASES).toHaveLength(14);
    expect(GameflowPhaseSchema.parse(fixture('lcu/gameflow-phase.json'))).toBe('InProgress');
    expect(GameflowPhaseSchema.safeParse('Banana').success).toBe(false);
    expect(GameflowPhaseResponseSchema.parse('Banana')).toBe('Banana');
  });

  it('parses the session loosely', () => {
    const s = GameflowSessionSchema.parse(fixture('lcu/gameflow-session.json'));
    expect(s.phase).toBe('InProgress');
    expect(s.gameData?.gameId).toBe(7000000001);
    expect(s.gameData?.queue?.id).toBe(420);
    expect(s.gameData?.queue?.gameMode).toBe('CLASSIC');
    expect(s.map?.id).toBe(11);
    expect((s as Record<string, unknown>)['gameClient']).toBeDefined();
  });

  it('parses the current summoner', () => {
    const s = CurrentSummonerSchema.parse(fixture('lcu/current-summoner.json'));
    expect(s).toMatchObject({ gameName: 'Fake Adc', tagLine: 'FAKE4', summonerId: 100000001 });
    expect((s as Record<string, unknown>)['summonerLevel']).toBe(187);
  });
});
