import type { ReactNode } from 'react';

interface StatCardProps {
  value: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  variant?: 'stat' | 'adminCard';
}

// Matches the reference's exact adminCard/stat markup — <b>{value}</b>
// <span>{label}</span>, no icon slot (BlinkAutomationFull_v2.jsx never puts
// an icon on these cards).
export function StatCard({ value, label, hint, variant = 'stat' }: StatCardProps) {
  return (
    <div className={variant}>
      <b>{value}</b>
      <span>{label}</span>
      {hint}
    </div>
  );
}
