import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

/** Reusable input with consistent sizing and optional label/error. */
export function Input({ label, error, className = '', id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-tiny font-black uppercase tracking-widest text-neutral-400">
          {label}
        </label>
      )}
      <input
        id={id}
        {...props}
        className={`w-full px-3 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm outline-none focus:border-secondary-light transition-colors ${className}`}
      />
      {error && <span className="text-tiny text-error">{error}</span>}
    </div>
  );
}
