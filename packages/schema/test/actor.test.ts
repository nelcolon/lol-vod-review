import { describe, expect, it } from 'vitest';
import { PlayerListSchema, classifyActor, playerGameName } from '../src/index.js';
import { fixture } from './helpers.js';

describe('classifyActor', () => {
  const names = PlayerListSchema.parse(fixture('playerlist.json')).map((p) => playerGameName(p) ?? '');

  it.each([
    ['Fake Top', 'champion'],
    ['Señor Medio', 'champion'],
    ['Fake Adc#FAKE4', 'champion'],
    ['Minion_T100L1S07', 'minion'],
    ['Minion_T200L1S07', 'minion'],
    ['Turret_T200_L0_P3_511845594', 'turret'],
    ['Turret_T2_L_03_A', 'turret'],
    ['SRU_Baron', 'monster'],
    ['SRU_Dragon_Elder', 'monster'],
    ['Somebody Else', 'unknown'],
    ['', 'unknown'],
  ] as const)('%s -> %s', (name, kind) => {
    expect(classifyActor(name, names)).toBe(kind);
  });

  it('matches players listed as Name#Tag', () => {
    expect(classifyActor('Fake Top', ['Fake Top#FAKE1'])).toBe('champion');
  });
});
