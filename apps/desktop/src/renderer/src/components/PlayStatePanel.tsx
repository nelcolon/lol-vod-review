import { useEffect, useState } from 'react';
import type { Moment, PlayItem, PlayItemChange, PlayKill, PlayPlayer, PlayState } from '@shared/contracts';
import { formatGameTime } from '@shared/timeline-math';
import deadIcon from '../assets/ui/dead.png';
import goldIcon from '../assets/ui/gold.png';
import scoreIcon from '../assets/ui/score.png';
import shopIcon from '../assets/ui/shop.png';
import { CollapseToggle, useCollapsed } from '../lib/collapse';

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

function Items({ items, v, size = 36 }: { items: PlayItem[]; v: string | null; size?: number }) {
  return (
    <span className="ps-items">
      {items.map((it, i) => (
        <span key={i} className="ps-item">
          <Icon v={v} kind="item" id={String(it.id)} label={`${it.name}${it.gold ? ` (${it.gold} g)` : ''}`} size={size} />
          {it.count > 1 && <span className="ps-count">{it.count}</span>}
        </span>
      ))}
    </span>
  );
}

/** In-game UI glyphs (Data Dragon's scoreboard icons, bundled). */
const Gold = () => <img className="ui-icon" src={goldIcon} alt="gold" />;

/** Champion icon for a kill; turrets/minions/monsters as a word. */
function KillTarget({ k, v }: { k: PlayKill; v: string | null }) {
  const label = `${k.champion} · ${formatGameTime(k.t)}`;
  if (!k.championKey) {
    return (
      <span className="ps-kill-text" title={label}>
        {k.champion}
      </span>
    );
  }
  return <Icon v={v} kind="champion" id={k.championKey} label={label} size={32} />;
}

/** "Used" / "Bought" box: item icons with counts; purchases say whether they came after the fight. */
function ChangeBox({ kind, items, v, triggerS }: { kind: 'used' | 'bought'; items: PlayItemChange[]; v: string | null; triggerS: number }) {
  const afterFight = kind === 'bought' && items.every((c) => c.t !== null && c.t > triggerS);
  return (
    <div className={`ps-box ps-box-${kind}`}>
      {kind === 'bought' && <img className="ui-icon" src={shopIcon} alt="shop" />}
      <span className="ps-box-label">{kind === 'used' ? 'Used' : afterFight ? 'Bought after the fight' : 'Bought'}</span>
      {items.map((c) => (
        <span key={c.id} className="ps-item">
          <Icon v={v} kind="item" id={String(c.id)} label={`${c.name}${c.t !== null ? ` · bought at ${formatGameTime(c.t)}` : ''}`} size={34} />
          {c.count > 1 && <span className="ps-count">{c.count}</span>}
        </span>
      ))}
    </div>
  );
}

function PlayerRow({ p, v, hasItems, showGold, triggerS }: { p: PlayPlayer; v: string | null; hasItems: boolean; showGold: boolean; triggerS: number }) {
  const involved = p.isMe || p.roles.length > 0;
  const fate = p.killed.length > 0 && p.killedBy.length > 0 ? 'traded' : p.killedBy.length > 0 ? 'died' : p.killed.length > 0 ? 'killer' : '';
  return (
    <div className={`ps-player ${involved ? 'involved' : ''} ${p.isMe ? 'me' : ''} ${fate}`}>
      <div className="ps-line">
        <span className="ps-portrait">
          <Icon v={v} kind="champion" id={p.championKey} label={p.champion} size={40} />
          {hasItems && (
            <span className="ps-level" title={p.level > p.levelBefore ? `Level ${p.levelBefore} → ${p.level} during the play` : `Level ${p.level}`}>
              {p.level}
            </span>
          )}
        </span>
        <span className="ps-spells">
          {p.spells.map((s, i) => (
            <Icon key={i} v={v} kind="spell" id={spellIcon(s.key)} label={s.name} size={19} />
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
        {p.level > p.levelBefore && (
          <span className="ps-up small mono" title={`Level ${p.levelBefore} → ${p.level} during the play`}>
            ▲{p.level - p.levelBefore} lv
          </span>
        )}
        {hasItems && (
          <span className="ps-stat mono small" title="Kills / deaths / assists">
            <img className="ui-icon" src={scoreIcon} alt="score" />
            {p.kills}/{p.deaths}/{p.assists}
          </span>
        )}
      </div>
      {(p.killed.length > 0 || p.killedBy.length > 0) && (
        <div className="ps-kills">
          {p.killed.length > 0 && (
            <span className="ps-kill-group" title="Killed in this play">
              <img className="ui-icon" src={scoreIcon} alt="killed" />
              {p.killed.map((k, i) => (
                <KillTarget key={i} k={k} v={v} />
              ))}
            </span>
          )}
          {p.killedBy.length > 0 && (
            <span className="ps-kill-group ps-death-group" title="Killed by">
              <img className="ui-icon" src={deadIcon} alt="killed by" />
              {p.killedBy.map((k, i) => (
                <KillTarget key={i} k={k} v={v} />
              ))}
            </span>
          )}
        </div>
      )}
      {hasItems && (
        <div className="ps-line">
          <Items items={p.items} v={v} />
          <span className="spacer" />
          <span className="ps-stat mono small" title={`Items held: ${p.itemGold} gold (wards and potions excluded)${showGold && p.totalGold !== null ? ` · ${p.totalGold} earned so far` : ''}`}>
            <Gold />
            {kGold(p.itemGold)}
          </span>
          {p.vs && (
            <span className={`ps-vs mono small ${p.vs.diff >= 0 ? 'up' : 'down'}`} title={`${p.vs.diff >= 0 ? 'Ahead of' : 'Behind'} ${p.vs.champion} (same position) by ${Math.abs(p.vs.diff)} gold in items`}>
              {p.vs.diff >= 0 ? '▲' : '▼'}
              {kGold(Math.abs(p.vs.diff))} vs
              <Icon v={v} kind="champion" id={p.vs.championKey} label={p.vs.champion} size={28} />
            </span>
          )}
        </div>
      )}
      {!hasItems && showGold && p.totalGold !== null && (
        <div className="ps-stat mono small muted" title="Total gold earned at the minute mark">
          <Gold />
          {kGold(p.totalGold)} earned
        </div>
      )}
      {(p.used.length > 0 || p.bought.length > 0 || p.sold.length > 0) && (
        <div className="ps-changes small">
          {p.used.length > 0 && <ChangeBox kind="used" items={p.used} v={v} triggerS={triggerS} />}
          {p.bought.length > 0 && <ChangeBox kind="bought" items={p.bought} v={v} triggerS={triggerS} />}
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
  const [collapsed, toggle] = useCollapsed('playState');

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
        <CollapseToggle collapsed={collapsed} onToggle={toggle} label="game state" />
        <h4>Game state at {formatGameTime(state.triggerS)}</h4>
        <span className="muted small">
          changes from {formatGameTime(state.beforeS)} to {formatGameTime(state.afterS)}
        </span>
        <span className="spacer" />
        {!collapsed && (
          <button type="button" className="link small" onClick={() => setEveryone(!everyone)}>
            {everyone ? 'Only the players in this play' : 'Show all 10 players'}
          </button>
        )}
      </div>
      {!collapsed && (
        <>
      <div className="ps-summary small">
        {state.myGold !== null && (
          <span title="Gold you were holding, not spent">
            Your unspent gold: <Gold /> <strong className="mono">{state.myGold}</strong>
          </span>
        )}
        {state.hasItems && (
          <span title="Cost of items held, your team vs theirs">
            <Gold /> Items: <strong className="mono">{kGold(teamItems(true))}</strong> vs <strong className="mono">{kGold(teamItems(false))}</strong> ({diff(teamItems(true), teamItems(false))})
          </span>
        )}
        {showGold && (
          <span title="Total gold earned, from the League client's minute-by-minute timeline">
            <Gold /> Earned by {state.goldMinute}:00: <strong className="mono">{kGold(teamGold(true))}</strong> vs <strong className="mono">{kGold(teamGold(false))}</strong> ({diff(teamGold(true), teamGold(false))})
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
                <PlayerRow key={p.name} p={p} v={v} hasItems={state.hasItems} showGold={showGold} triggerS={state.triggerS} />
              ))}
          </div>
        ))}
      </div>
      <p className="muted small ps-note">Summoner spell and item cooldowns aren't available from the game, so they aren't shown as used.</p>
        </>
      )}
    </div>
  );
}
