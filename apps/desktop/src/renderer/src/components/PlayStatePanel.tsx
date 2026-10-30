import { useEffect, useState } from 'react';
import type { Moment, PlayItem, PlayPlayer, PlayState } from '@shared/contracts';
import { formatGameTime } from '@shared/timeline-math';

const CDN = 'https://ddragon.leagueoflegends.com/cdn';

/** Data Dragon has one icon per base spell: Unleashed Teleport → Teleport, Primal Smite → Smite. */
const spellIcon = (key: string) => (key.startsWith('SummonerSmite') ? 'SummonerSmite' : key.replace(/Upgrade$/, ''));

const kGold = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(g));
const ROLE_LABEL = { killer: 'Killer', victim: 'Died', assist: 'Assist' } as const;

/** Data Dragon icon, or a text chip when there is no version/icon (offline, new item, upgraded spell). */
function Icon({ v, kind, id, label, size }: { v: string | null; kind: 'item' | 'champion' | 'spell'; id: string; label: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (!v || !id || broken) {
    return (
      <span className={`dd-icon dd-text dd-${kind}`} style={{ width: size, height: size }} title={label}>
        {label.slice(0, 2)}
      </span>
    );
  }
  return <img className={`dd-icon dd-${kind}`} src={`${CDN}/${v}/img/${kind}/${id}.png`} width={size} height={size} alt={label} title={label} onError={() => setBroken(true)} />;
}

function Items({ items, v }: { items: PlayItem[]; v: string | null }) {
  return (
    <span className="ps-items">
      {items.map((it, i) => (
        <span key={i} className="ps-item">
          <Icon v={v} kind="item" id={String(it.id)} label={`${it.name}${it.gold ? ` (${it.gold} g)` : ''}`} size={22} />
          {it.count > 1 && <span className="ps-count">{it.count}</span>}
        </span>
      ))}
    </span>
  );
}

function PlayerRow({ p, v, hasItems, showGold }: { p: PlayPlayer; v: string | null; hasItems: boolean; showGold: boolean }) {
  const involved = p.isMe || p.roles.length > 0;
  const fate = p.killed.length > 0 && p.killedBy.length > 0 ? 'traded' : p.killedBy.length > 0 ? 'died' : p.killed.length > 0 ? 'killer' : '';
  return (
    <div className={`ps-player ${involved ? 'involved' : ''} ${p.isMe ? 'me' : ''} ${fate}`}>
      <div className="ps-line">
        <Icon v={v} kind="champion" id={p.championKey} label={p.champion} size={28} />
        <span className="ps-spells">
          {p.spells.map((s, i) => (
            <Icon key={i} v={v} kind="spell" id={spellIcon(s.key)} label={s.name} size={13} />
          ))}
        </span>
        <span className="ps-who">
          <span className="ps-name">{p.isMe ? `${p.champion} (you)` : p.champion}</span>
          <span className="muted small">{p.name}</span>
        </span>
        {p.roles.map((r) => (
          <span key={r} className={`ps-role ps-${r}`}>
            {ROLE_LABEL[r]}
          </span>
        ))}
        <span className="spacer" />
        {hasItems && (
          <span className="mono small" title="Level (change during the play)">
            Lv {p.level}
            {p.level > p.levelBefore && <span className="ps-up"> +{p.level - p.levelBefore}</span>}
          </span>
        )}
        {hasItems && (
          <span className="mono small" title="Kills / deaths / assists">
            {p.kills}/{p.deaths}/{p.assists}
          </span>
        )}
      </div>
      {(p.killed.length > 0 || p.killedBy.length > 0) && (
        <div className="ps-kills small">
          {p.killed.map((k, i) => (
            <span key={`k${i}`} className="ps-kill">
              killed <strong>{k.champion}</strong> <span className="mono muted">{formatGameTime(k.t)}</span>
            </span>
          ))}
          {p.killedBy.map((k, i) => (
            <span key={`d${i}`} className="ps-death">
              killed by <strong>{k.champion}</strong> <span className="mono muted">{formatGameTime(k.t)}</span>
            </span>
          ))}
        </div>
      )}
      {hasItems && (
        <div className="ps-line">
          <Items items={p.items} v={v} />
          <span className="spacer" />
          <span className="mono small" title="Cost of items held (wards and potions excluded)">
            {kGold(p.itemGold)} in items
          </span>
          {showGold && p.totalGold !== null && (
            <span className="mono small muted" title="Total gold earned at the minute mark">
              · {kGold(p.totalGold)} earned
            </span>
          )}
        </div>
      )}
      {!hasItems && showGold && p.totalGold !== null && <div className="mono small muted">{kGold(p.totalGold)} gold earned</div>}
      {(p.used.length > 0 || p.bought.length > 0 || p.sold.length > 0) && (
        <div className="ps-changes small">
          {p.used.map((c) => (
            <span key={`u${c.id}`} className="ps-used">
              used {c.count > 1 ? `${c.count}× ` : ''}
              {c.name}
            </span>
          ))}
          {p.bought.map((c) => (
            <span key={`b${c.id}`} className="ps-gained">
              bought {c.count > 1 ? `${c.count}× ` : ''}
              {c.name}
            </span>
          ))}
          {p.sold.map((c) => (
            <span key={`s${c.id}`} className="muted">
              sold {c.count > 1 ? `${c.count}× ` : ''}
              {c.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Everyone's items, levels and gold around the selected moment. */
export function PlayStatePanel({ gameId, moment }: { gameId: string; moment: Moment }) {
  const [state, setState] = useState<PlayState | null | 'loading'>('loading');
  const [everyone, setEveryone] = useState(false);

  useEffect(() => {
    let live = true;
    setState('loading');
    window.lvr
      .getPlayState(gameId, moment.id)
      .then((s) => live && setState(s))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [gameId, moment.id]);

  if (state === 'loading') return <div className="play-state muted small">Loading game state…</div>;
  if (!state || state.players.length === 0) return <div className="play-state muted small">No game state for this moment.</div>;

  const v = state.ddragonVersion;
  const showGold = state.goldMinute !== null;
  const shown = everyone ? state.players : state.players.filter((p) => p.isMe || p.roles.length > 0);
  const myTeam = state.players.find((p) => p.isMe)?.team ?? 'ORDER';
  const teamGold = (mine: boolean) => state.players.filter((p) => (p.team === myTeam) === mine).reduce((s, p) => s + (p.totalGold ?? 0), 0);
  const teamItems = (mine: boolean) => state.players.filter((p) => (p.team === myTeam) === mine).reduce((s, p) => s + p.itemGold, 0);
  const diff = (a: number, b: number) => `${a >= b ? '+' : '−'}${kGold(Math.abs(a - b))}`;

  return (
    <div className="play-state">
      <div className="ps-head">
        <h4>Game state at {formatGameTime(state.triggerS)}</h4>
        <span className="muted small">
          changes from {formatGameTime(state.beforeS)} to {formatGameTime(state.afterS)}
        </span>
        <span className="spacer" />
        <button type="button" className="link small" onClick={() => setEveryone(!everyone)}>
          {everyone ? 'Only the players in this play' : 'Show all 10 players'}
        </button>
      </div>
      <div className="ps-summary small">
        {state.myGold !== null && (
          <span title="Gold you were holding, not spent">
            Your unspent gold: <strong className="mono">{state.myGold}</strong>
          </span>
        )}
        {state.hasItems && (
          <span title="Cost of items held, your team vs theirs">
            Items: <strong className="mono">{kGold(teamItems(true))}</strong> vs <strong className="mono">{kGold(teamItems(false))}</strong> ({diff(teamItems(true), teamItems(false))})
          </span>
        )}
        {showGold && (
          <span title="Total gold earned, from the League client's minute-by-minute timeline">
            Gold at {state.goldMinute}:00: <strong className="mono">{kGold(teamGold(true))}</strong> vs <strong className="mono">{kGold(teamGold(false))}</strong> ({diff(teamGold(true), teamGold(false))})
          </span>
        )}
      </div>
      {!state.hasItems && <p className="muted small">Items weren't saved for this game (recorded before this feature). New games include them.</p>}
      <div className="ps-teams">
        {[true, false].map((mine) => (
          <div key={String(mine)} className={`ps-team ${mine ? 'ally' : 'enemy'}`}>
            <div className="ps-team-label small">{mine ? 'Your team' : 'Enemy team'}</div>
            {shown
              .filter((p) => (p.team === myTeam) === mine)
              .map((p) => (
                <PlayerRow key={p.name} p={p} v={v} hasItems={state.hasItems} showGold={showGold} />
              ))}
          </div>
        ))}
      </div>
      <p className="muted small ps-note">Summoner spell and item cooldowns aren't available from the game, so they aren't shown as used.</p>
    </div>
  );
}
