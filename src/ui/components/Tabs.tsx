import { useId, type ReactNode } from 'react';

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

export function Tabs({ items, activeId, onChange, label }: TabsProps) {
  const baseId = useId();
  const active = items.find((item) => item.id === activeId) ?? items[0];

  return (
    <div className="ds-tabs">
      <div className="ds-tabs__list" role="tablist" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.id}
            id={`${baseId}-tab-${item.id}`}
            className="ds-tabs__tab"
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
        className="ds-tabs__panel"
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active.id}`}
      >
        {active.content}
      </div>
    </div>
  );
}
