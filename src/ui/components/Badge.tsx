import type { HTMLAttributes } from 'react';

type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return <span className={`ds-badge ds-badge--${tone} ${className}`} {...props} />;
}
