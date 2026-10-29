import type { GameResult, MarkerKind, ReviewStatus, Theme } from '@shared/contracts';

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const RESULT_LABEL: Record<GameResult, string> = { win: 'Win', loss: 'Loss', remake: 'Remake', unknown: '—' };
export const REVIEW_LABEL: Record<ReviewStatus, string> = { unreviewed: 'Not reviewed', in_progress: 'In progress', reviewed: 'Reviewed' };
export const THEME_LABEL: Record<Theme, string> = { deaths: 'Deaths', objectives: 'Objectives', kills: 'Kills', teamfights: 'Teamfights' };
export const KIND_LABEL: Record<MarkerKind, string> = {
  own_death: 'Your death',
  own_kill: 'Your kill',
  own_assist: 'Your assist',
  objective: 'Objective',
  tower: 'Structure',
  ace: 'Ace',
  other: 'Event',
};

export function roleLabel(role: string): string {
  const map: Record<string, string> = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' };
  return map[role] ?? role;
}

export function eventTitle(name: string, payload: Record<string, unknown>): string {
  const killer = typeof payload['KillerName'] === 'string' ? payload['KillerName'] : '';
  const victim = typeof payload['VictimName'] === 'string' ? payload['VictimName'] : '';
  switch (name) {
    case 'ChampionKill':
      return `${killer} killed ${victim}`;
    case 'DragonKill':
      return `${String(payload['DragonType'] ?? '')} drake — ${killer}${payload['Stolen'] === 'True' ? ' (stolen)' : ''}`;
    case 'BaronKill':
      return `Baron — ${killer}${payload['Stolen'] === 'True' ? ' (stolen)' : ''}`;
    case 'HeraldKill':
      return `Herald — ${killer}`;
    case 'HordeKill':
      return `Voidgrubs — ${killer}`;
    case 'AtakhanKill':
      return `Atakhan — ${killer}`;
    case 'TurretKilled':
      return `Tower — ${killer}`;
    case 'InhibKilled':
      return `Inhibitor — ${killer}`;
    case 'Ace':
      return `Ace by ${String(payload['Acer'] ?? '')}`;
    case 'Multikill':
      return `Multikill ×${String(payload['KillStreak'] ?? '')} — ${killer}`;
    default:
      return name;
  }
}
