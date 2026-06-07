type BadgeColor = 'primary' | 'accent' | 'error';

interface BadgeProps {
  count: number;
  color?: BadgeColor;
}

const colors: Record<BadgeColor, string> = {
  primary: 'bg-secondary',
  accent:  'bg-accent',
  error:   'bg-error',
};

/** Small counter badge for header indicators. Returns null when count is 0. */
export function Badge({ count, color = 'primary' }: BadgeProps) {
  if (count === 0) return null;
  return (
    <span className={`${colors[color]} w-4 h-4 rounded-full text-white text-micro font-black flex items-center justify-center shrink-0`}>
      {count > 9 ? '9+' : count}
    </span>
  );
}
