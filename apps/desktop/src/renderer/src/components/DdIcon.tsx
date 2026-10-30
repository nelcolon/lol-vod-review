import { useState } from 'react';

const CDN = 'https://ddragon.leagueoflegends.com/cdn';

/** Data Dragon icon, or a text chip when there is no version/icon (offline, new item, upgraded spell). */
export function DdIcon({ v, kind, id, label, size }: { v: string | null; kind: 'item' | 'champion' | 'spell'; id: string; label: string; size: number }) {
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
