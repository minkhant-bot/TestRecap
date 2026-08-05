import type { ReactNode } from 'react';
import { Button } from './Button';

interface PanelAction {
  label: string;
  onClick: () => void;
}

interface FeedbackPanelProps {
  title: string;
  description?: string;
  action?: PanelAction;
}

// Reference (BlinkAutomationFull_v2.jsx) has no dedicated "empty/error state"
// component, and no icon library at all — errors render as a plain
// ".alert.error" banner (its own literal pattern, e.g. ErrorState's
// Gemini-failure banner) and there is no empty-state visual, so EmptyState
// reuses the same flat ".panel" look the rest of the app uses for
// informational blocks. No icons on either, matching the reference.
export function ErrorPanel({ title, description, action }: FeedbackPanelProps) {
  return (
    <div className="alert error" role="alert">
      <strong>{title}</strong>
      {description && <div style={{ marginTop: 6 }}>{description}</div>}
      {action && (
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" onClick={action.onClick}>{action.label}</Button>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: FeedbackPanelProps) {
  return (
    <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
      <h3 style={{ margin: '0 0 6px' }}>{title}</h3>
      {description && <p className="muted" style={{ margin: '0 0 14px' }}>{description}</p>}
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}

type StatusTone = 'queued' | 'processing' | 'complete' | 'failed' | 'cancelled';

const DOT_CLASS: Record<StatusTone, string> = {
  queued: '',
  processing: 'warn',
  complete: '',
  failed: 'bad',
  cancelled: 'warn',
};

// Matches the reference's own literal Admin status pattern
// (<span><i class="statusDot ..."/>{label}</span>) — a dot + plain text,
// never a colored chip.
export function StatusBadge({ status, children }: { status: StatusTone; children?: ReactNode }) {
  return (
    <span>
      <i className={`statusDot ${DOT_CLASS[status]}`} aria-hidden="true" />
      {children ?? status}
    </span>
  );
}
