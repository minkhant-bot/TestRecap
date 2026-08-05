import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
}

// Reference classes (BlinkAutomationFull_v2.jsx): plain "btn" is the default
// look; "btn accent" is the pink CTA; "btn ghost"/"btn danger" match 1:1.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn accent',
  secondary: 'btn',
  ghost: 'btn ghost',
  danger: 'btn danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', icon, loading = false, children, className = '', disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${VARIANT_CLASS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading ? <span className="spin" aria-hidden="true"><Loader2 size={16} /></span> : icon}
      {children}
    </button>
  );
});
