import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  leadingIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingIcon, id: providedId, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const descriptionId = `${id}-description`;

  return (
    <div className={`ds-field ${className}`}>
      <label htmlFor={id} className="ds-field__label">{label}</label>
      <div className={`ds-input-wrap ${error ? 'ds-input-wrap--error' : ''}`}>
        {leadingIcon && <span className="ds-input-wrap__icon" aria-hidden="true">{leadingIcon}</span>}
        <input
          ref={ref}
          id={id}
          className="ds-input"
          aria-invalid={Boolean(error)}
          aria-describedby={hint || error ? descriptionId : undefined}
          {...props}
        />
      </div>
      {(error || hint) && (
        <span id={descriptionId} className={error ? 'ds-field__error' : 'ds-field__hint'}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
});
