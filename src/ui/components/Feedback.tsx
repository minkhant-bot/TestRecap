import { AlertTriangle, Inbox, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { Button } from './Button';

interface PanelAction {
  label: string;
  onClick: () => void;
}

interface FeedbackPanelProps {
  title: string;
  description?: string;
  action?: PanelAction;
  icon?: LucideIcon;
}

export function ErrorPanel({ title, description, action, icon: Icon = AlertTriangle }: FeedbackPanelProps) {
  return (
    <div className="ds-feedback ds-feedback--error" role="alert">
      <span className="ds-feedback__icon"><Icon size={22} /></span>
      <div>
        <Badge tone="danger">စစ်ဆေးရန်လိုသည်</Badge>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {action && <Button variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={action.onClick}>{action.label}</Button>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: FeedbackPanelProps) {
  return (
    <div className="ds-feedback ds-feedback--empty">
      <span className="ds-feedback__icon"><Icon size={24} /></span>
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {action && <Button size="sm" onClick={action.onClick}>{action.label}</Button>}
      </div>
    </div>
  );
}

type StatusTone = 'queued' | 'processing' | 'complete' | 'failed' | 'cancelled';

export function StatusBadge({ status, children }: { status: StatusTone; children?: ReactNode }) {
  return (
    <span className={`ds-status ds-status--${status}`}>
      <span className="ds-status__dot" aria-hidden="true" />
      {children ?? status}
    </span>
  );
}
