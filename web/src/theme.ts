export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'vimax-web-theme';

export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#090a0c' : '#ffffff';
}
