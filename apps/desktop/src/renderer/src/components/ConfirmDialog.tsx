import { useEffect, useRef, type ReactNode } from 'react';

/**
 * "Are you sure?" over the app. Cancel has the focus, so Enter or Esc never deletes by
 * accident; only a click (or Tab then Enter) on the red button confirms.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // keep the review view from also handling Esc (back to the library)
      e.stopImmediatePropagation();
      if (!busy) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="update-dialog confirm-dialog" role="alertdialog" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-title">{title}</h3>
        {children}
        <div className="update-actions">
          <span className="spacer" />
          <button type="button" ref={cancelRef} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
