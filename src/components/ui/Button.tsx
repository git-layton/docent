import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:   'bg-primary hover:bg-primary-hover text-white',
  secondary: 'border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-secondary text-neutral-700 dark:text-neutral-200',
  ghost:     'text-neutral-500 hover:text-primary hover:bg-surface dark:hover:bg-neutral-800',
  danger:    'bg-error hover:bg-error-dark text-white',
};

const sizes: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-tiny',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-sm',
};

/** Reusable button with design-token variants and sizes. */
export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`${variants[variant]} ${sizes[size]} rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${className}`}
    />
  );
}
