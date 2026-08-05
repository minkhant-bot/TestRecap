import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  label: string;
}

// Mobile section switcher: below 850px the horizontally-scrolling tab strip
// is replaced with a compact, Blink-styled dropdown (same trigger/panel
// pattern as AppShell's AccountMenu) instead of a native <select> — a native
// picker renders as the platform's own system dialog (a large white sheet on
// Android), which breaks the dark product chrome. Desktop keeps the tab
// strip (below), untouched.
function MobileTabSwitcher({ items, activeId, onChange, label }: TabsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const active = items.find(item => item.id === activeId) ?? items[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="adminTabsMobile" ref={containerRef}>
      <button
        type="button"
        className="adminTabsMobile__trigger"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
      >
        <span>{active.label}</span>
        <ChevronDown size={16} aria-hidden="true" className={open ? 'adminTabsMobile__chevron adminTabsMobile__chevron--open' : 'adminTabsMobile__chevron'} />
      </button>
      <ul className={`adminTabsMobile__menu${open ? ' is-open' : ''}`} role="listbox" aria-label={label} aria-hidden={!open}>
        {items.map(item => (
          <li key={item.id} role="option" aria-selected={item.id === active.id}>
            <button
              type="button"
              tabIndex={open ? 0 : -1}
              className={item.id === active.id ? 'is-active' : ''}
              onClick={() => { onChange(item.id); setOpen(false); }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Tabs({ items, activeId, onChange, label }: TabsProps) {
  const baseId = useId();
  const active = items.find((item) => item.id === activeId) ?? items[0];

  return (
    <div>
      <MobileTabSwitcher items={items} activeId={activeId} onChange={onChange} label={label} />
      <div className="adminTabs" role="tablist" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.id}
            id={`${baseId}-tab-${item.id}`}
            className={item.id === active.id ? 'active' : ''}
            role="tab"
            aria-selected={item.id === active.id}
            aria-controls={`${baseId}-panel-${item.id}`}
            tabIndex={item.id === active.id ? 0 : -1}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id={`${baseId}-panel-${active.id}`}
        className="tabs-panel"
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active.id}`}
      >
        {active.content}
      </div>
    </div>
  );
}
