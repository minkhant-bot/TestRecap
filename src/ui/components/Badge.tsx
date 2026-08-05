import type { HTMLAttributes } from 'react';

// Reference (BlinkAutomationFull_v2.jsx) ".chip" is a single plain pill with
// no color variants — role/status color comes from a separate ".statusDot"
// (see StatusBadge in Feedback.tsx), matching how the reference's own Admin
// screen shows status: a colored dot + plain-chip text, never a colored chip.
export type BadgeProps = HTMLAttributes<HTMLSpanElement>;

export function Badge({ className = '', ...props }: BadgeProps) {
  return <span className={`chip ${className}`} {...props} />;
}
