import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  description?: string;
  action?: ReactNode;
}

export function Card({ title, description, action, children, className = '', ...props }: CardProps) {
  return (
    <section className={`ds-card ${className}`} {...props}>
      {(title || description || action) && (
        <header className="ds-card__header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="ds-card__content">{children}</div>
    </section>
  );
}
