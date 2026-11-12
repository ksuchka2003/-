import { activePalette } from './readerDomain';

const key = 'bookclub-appearance';
export function restoreAppearance() {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    document.documentElement.dataset.palette = activePalette(value.palette);
    document.documentElement.dataset.themePreference = ['light', 'dark'].includes(value.theme)
      ? value.theme
      : 'system';
  } catch {
    /* A visual preference is optional; it never identifies the reader. */
  }
}
export function rememberAppearance(palette: unknown, theme: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ palette: activePalette(palette), theme }));
  } catch {
    /* Storage may be unavailable. */
  }
}
