import { it, expect, vi } from 'vitest';
vi.mock('@tma.js/sdk-react', () => ({ init: () => () => {}, retrieveLaunchParams: () => ({}) }));
import { initializeTelegram } from '../src/telegram';
it('скрывает кнопку Назад Telegram при запуске', () => {
  const hide = vi.fn(),
    show = vi.fn();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  window.Telegram = {
    WebApp: {
      initData: '',
      colorScheme: 'light',
      ready() {},
      expand() {},
      onEvent() {},
      offEvent() {},
      BackButton: { hide, show, onClick() {}, offClick() {} },
    },
  };
  try {
    const cleanup = initializeTelegram();
    expect(hide).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
    cleanup();
  } finally {
    delete window.Telegram;
    vi.unstubAllGlobals();
  }
});
