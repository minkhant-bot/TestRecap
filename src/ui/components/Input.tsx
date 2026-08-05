import { forwardRef, useId, type InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

// Reference (BlinkAutomationFull_v2.jsx) never shows a styled form control —
// only bare <input>/<select> in its Admin credits mock. This is the minimal
// real-product extension in app.css's ".field" rules, not a reference class.
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id: providedId, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      <input ref={ref} id={id} aria-invalid={Boolean(error)} {...props} />
      {error && <small className="error">{error}</small>}
      {!error && hint && <small>{hint}</small>}
    </div>
  );
});
