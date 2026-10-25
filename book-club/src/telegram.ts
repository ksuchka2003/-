import { init, retrieveLaunchParams } from '@tma.js/sdk-react';
type WebApp = {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
  safeAreaInset?: { top: number; bottom: number };
  contentSafeAreaInset?: { top: number; bottom: number };
};
declare global {
  interface Window {
    Telegram?: { WebApp: WebApp };
  }
}
export function initializeTelegram() {
  let cleanupSDK: (() => void) | undefined;
  try {
    cleanupSDK = init();
    retrieveLaunchParams();
  } catch {
    /* Обычный браузер: только личная библиотека. */
  }
  const app = window.Telegram?.WebApp;
  const theme = () => {
    document.documentElement.dataset.theme =
      app?.colorScheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.style.setProperty(
      '--tg-top',
      `${app?.contentSafeAreaInset?.top || app?.safeAreaInset?.top || 0}px`,
    );
    document.documentElement.style.setProperty(
      '--tg-bottom',
      `${app?.contentSafeAreaInset?.bottom || app?.safeAreaInset?.bottom || 0}px`,
    );
  };
  app?.ready();
  app?.expand();
  theme();
  app?.onEvent('themeChanged', theme);
  app?.onEvent('safeAreaChanged', theme);
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', theme);
  return () => {
    cleanupSDK?.();
    app?.offEvent('themeChanged', theme);
    app?.offEvent('safeAreaChanged', theme);
    media.removeEventListener('change', theme);
  };
}
export const initData = () => window.Telegram?.WebApp.initData || '';
