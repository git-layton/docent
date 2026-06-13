import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:   'bg-accent hover:bg-accent-strong text-on-accent',
  secondary: 'border border-edge-2 bg-panel hover:border-accent text-ink-2',
  ghost:     'text-ink-3 hover:text-accent hover:bg-wash',
  danger:    'bg-danger-soft hover:bg-danger text-danger hover:text-white border border-danger/30',
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
