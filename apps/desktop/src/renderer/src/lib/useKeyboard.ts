import { useEffect } from 'react';

export type KeyHandlers = Record<string, (e: KeyboardEvent) => void>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Global key handling for the review flow. Handlers are keyed by `KeyboardEvent.key` (case
 * sensitive for letters, e.g. both 'j' and 'J'). Typing in inputs is left alone except Escape.
 */
export function useKeyboard(handlers: KeyHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const h = handlers[e.key];
      if (h) {
        e.preventDefault();
        h(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers, enabled]);
}
