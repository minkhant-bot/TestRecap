import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
}

// Reference (BlinkAutomationFull_v2.jsx) ".panel" is a single flat padded
// box with no header/content split — a heading, if any, is just a plain
// <h3> at the top of the box.
export function Card({ title, description, children, className = '', ...props }: CardProps) {
  return (
    <section className={`panel ${className}`} {...props}>
      {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
      {description && <p className="muted" style={{ marginTop: title ? -8 : 0 }}>{description}</p>}
      {children}
    </section>
  );
}
