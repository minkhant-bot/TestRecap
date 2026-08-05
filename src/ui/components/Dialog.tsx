import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  busy?: boolean;
}

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
  // The escape-key listener below is attached once per open/close transition
  // (deps: [open]), but `busy`/`onClose` can change while still open (e.g. a
  // submit starts). Reading them through refs — updated every render —
  // keeps the listener's checks current instead of using whatever values
  // were in scope at the moment the dialog opened.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    scrollPositionRef.current = window.scrollY;
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
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.width = previousWidth;
      window.scrollTo({ top: scrollPositionRef.current, left: 0, behavior: 'auto' });
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
