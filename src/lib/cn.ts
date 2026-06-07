import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Utility for merging Tailwind classes safely. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
