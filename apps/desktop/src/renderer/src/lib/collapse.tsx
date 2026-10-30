import { useState } from 'react';

/** Open/closed state of a panel, remembered per panel across games and restarts. */
export function useCollapsed(key: string): [boolean, () => void] {
  const storageKey = `lvr.collapsed.${key}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(storageKey, c ? '0' : '1');
      } catch {
        /* storage unavailable: still toggles for this session */
      }
      return !c;
    });
  return [collapsed, toggle];
}

export function CollapseToggle({ collapsed, onToggle, label }: { collapsed: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className="collapse-toggle" onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? `Show ${label}` : `Hide ${label}`}>
      {collapsed ? '▸' : '▾'}
    </button>
  );
}
