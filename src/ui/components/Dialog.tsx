import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  busy?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Global popup primitive for the Interaction Rule (CLAUDE.md): forms,
// confirmations, approvals, uploads, and destructive actions render here
// instead of as inline expanding panels. Reuses only existing design tokens
// (.panel look, --accent, --radius-*) — no new visual language. Deliberately
// excluded from anywhere the View Video Preview renders (CLAUDE.md
// exception) — that flow is untouched and does not use this component.
export function Dialog({ open, onClose, title, children, busy = false }: DialogProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);
  const triggerRef = useRef<HTMLElement | null>(null);
  // The escape-key/focus-trap listener below is attached once per open/close
  // transition (deps: [open]), but `busy`/`onClose` can change while still
  // open (e.g. a submit starts). Reading them through refs — updated every
  // render — keeps the listener's checks current instead of using whatever
  // values were in scope at the moment the dialog opened.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    scrollPositionRef.current = window.scrollY;
    // Restore focus to whatever triggered this dialog (the button the user
    // just clicked) once it closes, rather than leaving focus lost on <body>.
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { body } = document;
    const previousPosition = body.style.position;
    const previousTop = body.style.top;
    const previousWidth = body.style.width;
    // Fixed-position lock (not overflow:hidden) preserves the exact scroll
    // offset underneath — overflow:hidden alone still lets touch/wheel
    // scroll the background on some mobile browsers and visibly jumps the
    // page to the top on release.
    body.style.position = 'fixed';
    body.style.top = `-${scrollPositionRef.current}px`;
    body.style.width = '100%';
    cardRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current();
    };
    // Keeps Tab/Shift+Tab cycling within the dialog only — background page
    // controls must never receive focus while a modal is open.
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !cardRef.current) return;
      const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(element => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        cardRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey ? active === first || !cardRef.current.contains(active) : active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const handleKeydown = (event: KeyboardEvent) => {
      closeOnEscape(event);
      trapTab(event);
    };
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.width = previousWidth;
      window.scrollTo({ top: scrollPositionRef.current, left: 0, behavior: 'auto' });
      if (triggerRef.current && document.contains(triggerRef.current)) {
        triggerRef.current.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialogBackdrop"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div
        className="dialogCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="dialogCard__header">
          <strong id={titleId}>{title}</strong>
          <button
            type="button"
            className="btn ghost iconBtn"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="dialogCard__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// Shared confirmation-body content for Dialog: a description, then a
// primary action (danger-styled when the action is destructive) and a
// Cancel action. Used for every confirm/approve/reject/ban/delete-style
// dialog across the app so button placement and destructive styling stay
// consistent in one place.
export function ConfirmBody({
  description, dangerous, busy, onConfirm, onCancel, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
}: {
  description?: string; dangerous?: boolean; busy: boolean;
  onConfirm(): void; onCancel(): void; confirmLabel?: string; cancelLabel?: string;
}) {
  return (
    <>
      {description && <p className="muted">{description}</p>}
      <div className="row wrap" style={{ marginTop: 12 }}>
        <Button variant={dangerous ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
      </div>
    </>
  );
}
