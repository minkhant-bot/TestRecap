import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface DropdownProps {
  trigger: (props: { open: boolean; onClick: () => void; 'aria-controls': string }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}

export function Dropdown({ trigger, children, align = 'end' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="ds-dropdown">
      {trigger({ open, onClick: () => setOpen((value) => !value), 'aria-controls': id })}
      {open && (
        <div id={id} className={`ds-dropdown__menu ds-dropdown__menu--${align}`} role="menu">
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}

export function DropdownItem({ children, onSelect, disabled = false }: DropdownItemProps) {
  return <button className="ds-dropdown__item" role="menuitem" disabled={disabled} onClick={onSelect}>{children}</button>;
}
