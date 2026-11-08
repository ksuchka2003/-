import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemberDetail } from '../src/ui/Social';
import { CloudGate, Session, Cover, SearchField } from '../src/ui/shared';
afterEach(cleanup);
it('очистка поиска сбрасывает запрос и возвращает фокус в поле', () => {
  const onChange = vi.fn();
  const { rerender } = render(<SearchField label="Найти книгу" value="Дюна" onChange={onChange} />);
  const input = screen.getByLabelText('Найти книгу');
  fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
  expect(onChange).toHaveBeenCalledWith('');
  expect(input).toHaveFocus();
  rerender(<SearchField label="Найти книгу" value="" onChange={onChange} />);
  expect(screen.queryByRole('button', { name: 'Очистить поиск' })).not.toBeInTheDocument();
});
it('новая обложка отображается после ошибки загрузки предыдущей', () => {
  const { rerender } = render(<Cover title="Книга" cover="https://example.com/broken.jpg" />);
  fireEvent.error(screen.getByAltText('Обложка: Книга'));
  expect(screen.getByAltText('Обложка: Книга')).not.toBeVisible();
  rerender(<Cover title="Книга" cover="https://example.com/new.jpg" />);
  expect(screen.getByAltText('Обложка: Книга')).toBeVisible();
});
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
