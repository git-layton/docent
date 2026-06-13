export type ThemeMode = 'light' | 'dark' | 'system';

export interface AccentOption {
  id: string;
  label: string;
  /** Representative swatch hex shown in the settings picker */
  swatch: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: 'lavender', label: 'Lavender', swatch: '#7F77DD' },
  { id: 'jade', label: 'Jade', swatch: '#1D9E75' },
  { id: 'coral', label: 'Coral', swatch: '#D85A30' },
  { id: 'blue', label: 'Blue', swatch: '#378ADD' },
  { id: 'pink', label: 'Pink', swatch: '#D4537E' },
  { id: 'amber', label: 'Amber', swatch: '#EF9F27' },
];

export const DEFAULT_ACCENT = 'lavender';
export const DEFAULT_THEME: ThemeMode = 'system';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return media().matches ? 'dark' : 'light';
  return mode;
}

/** Stamp [data-theme] and [data-accent] on <html>; index.css does the rest. */
export function applyTheme(mode: ThemeMode, accent: string): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(mode);
  root.dataset.accent = ACCENT_OPTIONS.some(a => a.id === accent) ? accent : DEFAULT_ACCENT;
}

let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

/** Re-apply on OS theme change while mode === 'system'. Safe to call repeatedly. */
export function watchSystemTheme(getMode: () => ThemeMode, getAccent: () => string): void {
  if (systemListener) media().removeEventListener('change', systemListener);
  systemListener = () => {
    if (getMode() === 'system') applyTheme('system', getAccent());
  };
  media().addEventListener('change', systemListener);
}
