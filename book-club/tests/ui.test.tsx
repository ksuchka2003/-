import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemberDetail } from '../src/ui/Social';
import { CloudGate, Session } from '../src/ui/shared';
afterEach(cleanup);
it('показывает ограничение клуба без ложных профилей', () => {
  render(
    <Session.Provider
      value={{ identity: null, error: 'Доступ только по приглашению', notify: vi.fn() }}
    >
      <CloudGate>
        <p>Секретные данные</p>
      </CloudGate>
    </Session.Provider>,
  );
  expect(screen.getByText('Войдите через Telegram')).toBeVisible();
  expect(screen.queryByText('Секретные данные')).toBeNull();
});
it('не выдумывает профиль при отсутствии подключения', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <MemberDetail />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('Войдите через Telegram')).toBeVisible();
});
