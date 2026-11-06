import { afterEach, it, expect } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Home, Club } from '../src/ui/Club';
import { Profile } from '../src/ui/Profile';
import { Members, PublicContent } from '../src/ui/Social';
import { MyBooks } from '../src/ui/Books';
import { Quotes } from '../src/ui/Quotes';
import { Session } from '../src/ui/shared';
import { currentClubBooks, nextClubMeeting } from '../src/clubSelectors';
import { uid, type ClubBook, type Reading } from '../src/domain';
const owner = uid();
const book = (title: string, status: ClubBook['status']): ClubBook => ({
  id: uid(),
  title,
  authors: 'Автор',
  description: '',
  genre: '',
  year: null,
  isbn: '',
  cover: '',
  default_pages: 100,
  status,
});
function view(
  element: React.ReactNode,
  data: Record<string, unknown[]> = {},
  role: 'admin' | 'member' = 'member',
) {
  const q = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  for (const table of [
    'club_books',
    'club_readings',
    'meetings',
    'meeting_attendance',
    'meeting_participants',
    'member_profiles',
    'member_privacy_settings',
    'book_proposals',
    'public_quotes',
    'visible_progress',
    'visible_reviews',
    'quote_likes',
    'visible_book_polls',
    'club_quotes',
    'club_reviews',
    'club_book_stats',
    'meeting_questions',
    'meeting_reflections',
  ])
    q.setQueryData(
      ['cloud', owner, table],
      data[table] ||
        data[
          (
            { club_quotes: 'public_quotes', club_reviews: 'visible_reviews' } as Record<
              string,
              string
            >
          )[table]
        ] ||
        [],
    );
  return render(
    <QueryClientProvider client={q}>
      <MemoryRouter>
        <Session.Provider
          value={{ identity: { id: owner, role, telegramId: '42' }, error: '', notify: () => {} }}
        >
          {element}
        </Session.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
it('популярные цитаты сортируются по лайкам и раскрываются частями без потери фильтра книги', () => {
  const b = book('Солярис', 'finished');
  const rows = Array.from({ length: 26 }, (_, i) => ({
    id: uid(),
    member_id: owner,
    book_id: b.id,
    title: b.title,
    text: `Мысль ${i}`,
    page: null,
    chapter: '',
    comment: '',
    updated_at: new Date(2026, 0, i + 1).toISOString(),
  }));
  const other = { ...rows[0], id: uid(), book_id: uid(), text: 'Из другой книги' };
  view(<PublicContent type="quotes" bookId={b.id} sort="likes" />, {
    club_quotes: [...rows, other],
    quote_likes: [0, 1, 2].map(() => ({ quote_id: rows[0].id, member_id: uid() })),
  });
  expect(document.querySelector('blockquote')?.textContent).toBe('Мысль 0');
  expect(document.querySelectorAll('blockquote')).toHaveLength(24);
  expect(screen.queryByText('Из другой книги')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Показать ещё · 2' }));
  expect(document.querySelectorAll('blockquote')).toHaveLength(26);
  expect(screen.queryByRole('button', { name: /Показать ещё/ })).toBeNull();
});
it('в прогрессе видны все действующие участники, отсутствие отметки не превращается в ноль процентов', () => {
  const b = book('Дюна', 'reading'),
    reader = uid();
  view(<Club />, {
    club_books: [b],
    meeting_participants: [{ member_id: reader, name: 'Мария' }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Открыть прогресс: Дюна' }));
  expect(screen.getByRole('button', { name: 'Чтение Мария: Дюна' })).toBeVisible();
  expect(screen.getByText('Нет отметки о чтении')).toBeVisible();
  expect(screen.queryByText(/0%/)).toBeNull();
});
it('предложения находятся во всех книгах, текущий раздел содержит только чтение', () => {
  view(<Club />);
  expect(screen.queryByRole('button', { name: 'Предложить книгу' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Все книги/ }));
  fireEvent.click(screen.getByText('Предложения и голосования', { exact: true }));
  expect(screen.getByRole('button', { name: 'Предложить книгу' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Читаем/ }));
  expect(screen.queryByRole('button', { name: 'Предложить книгу' })).toBeNull();
});

it('главная показывает текущее чтение, ближайшую встречу и ссылки', () => {
  const current = book('Клубная книга', 'reading');
  view(<Home />, {
    club_books: [current],
    meetings: [
      {
        id: uid(),
        title: 'Поздняя встреча',
        starts_at: '2099-12-01T12:00:00Z',
        cancelled: false,
        place: 'Кафе',
      },
      {
        id: uid(),
        title: 'Ближайшая встреча',
        starts_at: '2099-11-01T12:00:00Z',
        cancelled: false,
        place: 'Библиотека',
      },
    ],
  });
  expect(screen.getByRole('link', { name: 'Открыть книгу «Клубная книга»' })).toHaveAttribute(
    'href',
    `/club/${current.id}`,
  );
  expect(screen.getByText('Ближайшая встреча')).toBeVisible();
  expect(screen.queryByText('Поздняя встреча')).toBeNull();
  expect(screen.getByRole('link', { name: /Все встречи/ })).toHaveAttribute('href', '/meetings');
  expect(screen.queryByText(/давайте/)).toBeNull();
});
it('пустая главная не содержит баннеров, нулевой статистики и служебных инструкций', () => {
  view(<Home />);
  expect(screen.getByText('Сейчас нет книг в чтении')).toBeVisible();
  expect(screen.getByText('Пока нет предстоящих встреч')).toBeVisible();
  expect(screen.queryByText(/Supabase|НА ПОЛЯХ|читаю сейчас|README/)).toBeNull();
});
it('пустые книги и цитаты показывают только короткое состояние без технических пояснений и поиска', () => {
  const { unmount } = view(<MyBooks />);
  expect(screen.getByText('Пока нет книг')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Поиск моих книг' })).toBeNull();
  expect(screen.queryByText(/этом браузере|резервные копии|ЛИЧНАЯ ПОЛКА/)).toBeNull();
  unmount();
  view(<Quotes />);
  expect(screen.getByText('Пока нет цитат')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Поиск цитат' })).toBeNull();
});
it('участникам не приписываются выдуманные биографии и жанры', () => {
  view(<Members />, { member_profiles: [{ member_id: owner, name: 'Анна', bio: '', genres: '' }] });
  expect(screen.getByRole('heading', { name: 'Анна' })).toBeVisible();
  expect(screen.queryByText(/У каждой книги|Открыт новым историям/)).toBeNull();
});
it('публичная лента доступна во вкладке цитат клуба', () => {
  const bookId = uid();
  view(<Quotes />, {
    public_quotes: [
      {
        id: uid(),
        member_id: owner,
        book_id: bookId,
        title: 'Книга',
        text: 'Публичная цитата',
        page: null,
        chapter: '',
        comment: '',
        updated_at: new Date().toISOString(),
      },
    ],
    member_profiles: [{ member_id: owner, name: 'Анна' }],
  });
  fireEvent.click(screen.getByRole('button', { name: /^В клубе$/ }));
  expect(screen.getByText('Публичная цитата')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Книга' })).toHaveAttribute('href', `/club/${bookId}`);
});
it('пустой список участников имеет пустое состояние', () => {
  view(<Members />);
  expect(screen.getByText('Пока нет участников')).toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
});
it('каталог разделён на текущие, будущие и прочитанные книги и поддерживает поиск', () => {
  view(<Club />, {
    club_books: [
      book('Читаем', 'reading'),
      book('Будущая книга', 'planned'),
      book('Завершённая книга', 'finished'),
    ],
  });
  expect(screen.getByRole('heading', { name: 'Читаем' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Все книги/ }));
  expect(screen.getByRole('heading', { name: 'Будущая книга' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск книг клуба' }), {
    target: { value: 'нет такого' },
  });
  expect(screen.getByText('Книги не найдены')).toBeVisible();
});
it('профиль администратора содержит явную кнопку управления', () => {
  view(
    <Profile />,
    { member_profiles: [{ member_id: owner, name: 'Анна', bio: '', genres: '' }] },
    'admin',
  );
  expect(screen.getByRole('link', { name: 'Управление клубом' })).toHaveAttribute('href', '/admin');
  expect(screen.getByText('42')).toBeVisible();
});
it('несколько главных книг сохраняют порядок, завершённые и архивные не попадают на главную', () => {
  const first = book('Первая', 'reading'),
    second = book('Вторая', 'planned'),
    archived = book('Архив', 'archived');
  const readings = [
    { id: uid(), book_id: second.id, position: 0, status: 'active' },
    { id: uid(), book_id: first.id, position: 1, status: 'active' },
    { id: uid(), book_id: archived.id, position: 2, status: 'active' },
  ] as Reading[];
  expect(currentClubBooks([first, second, archived], readings).map((x) => x.book.id)).toEqual([
    second.id,
    first.id,
  ]);
  expect(nextClubMeeting([], 0)).toBeUndefined();
});

it('читатель в текущей книге открывает только свои публикации к этой книге', () => {
  const b = book('Солярис', 'reading');
  const reader = uid();
  view(<Club />, {
    club_books: [b],
    member_profiles: [
      {
        member_id: reader,
        name: 'Анна',
        avatar_url: null,
        bio: '',
        genres: '',
        joined_at: new Date().toISOString(),
      },
    ],
    visible_progress: [
      {
        id: uid(),
        member_id: reader,
        book_id: b.id,
        title: b.title,
        status: 'reading',
        pages: 150,
        total_pages: 300,
        updated_at: new Date().toISOString(),
      },
    ],
    public_quotes: [
      {
        id: uid(),
        member_id: reader,
        book_id: b.id,
        title: b.title,
        text: 'Цитата к Солярису',
        updated_at: new Date().toISOString(),
      },
      {
        id: uid(),
        member_id: reader,
        book_id: uid(),
        title: 'Другая книга',
        text: 'Цитата к другой книге',
        updated_at: new Date().toISOString(),
      },
    ],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Открыть прогресс: Солярис' }));
  expect(screen.getByText('150 / 300 стр. · 50%')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Чтение Анна: Солярис' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByText('Цитата к Солярису')).toBeVisible();
  expect(screen.queryByText('Цитата к другой книге')).toBeNull();
});
