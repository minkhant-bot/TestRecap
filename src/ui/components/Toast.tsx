import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

type ToastTone = 'info' | 'success' | 'warning' | 'danger';

interface ToastProps {
  title: string;
  message?: string;
  tone?: ToastTone;
  action?: ReactNode;
  onDismiss?: () => void;
}

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: XCircle,
};

export function Toast({ title, message, tone = 'info', action, onDismiss }: ToastProps) {
  const Icon = icons[tone];
  return (
    <div className={`ds-toast ds-toast--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={19} aria-hidden="true" />
      <div className="ds-toast__copy">
        <strong>{title}</strong>
        {message && <span>{message}</span>}
      </div>
      {action}
      {onDismiss && (
        <button className="ds-icon-action" onClick={onDismiss} aria-label="အသိပေးချက် ပိတ်မည်">
          <X size={17} />
        </button>
      )}
    </div>
  );
}
