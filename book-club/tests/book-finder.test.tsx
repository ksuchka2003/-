import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { getDB, openLibrary } from '../src/db';
import { now, uid, type Book, type ClubBook, type Metadata } from '../src/domain';
import { sameBook, resolveBookChoice, catalogMetadata } from '../src/bookMatches';
import { BookFinder } from '../src/ui/BookFinder';
import { searchBooks } from '../src/bookSearch';
vi.mock('../src/bookSearch', () => ({ searchBooks: vi.fn() }));
const meta = (): Metadata => ({
  title: 'Дюна',
  authors: 'Фрэнк Герберт',
  description: '',
  genre: '',
  year: null,
  isbn: '',
  cover: '',
  totalPages: 480,
});
const club = (): ClubBook => ({ ...meta(), id: uid(), default_pages: 600, status: 'planned' });
const own = (shared: ClubBook): Book => ({
  ...meta(),
  id: uid(),
  clubBookId: shared.id,
  status: 'reading',
  notes: 'Мои заметки',
  publishProgress: false,
  publishReview: false,
  createdAt: now(),
  updatedAt: now(),
});
beforeEach(() => {
  openLibrary(uid());
  vi.mocked(searchBooks).mockReset().mockResolvedValue([]);
});
afterEach(async () => {
  cleanup();
  await getDB().delete();
});
it('сопоставляет издания с клубом, сохраняя личное издание и существующую книгу', () => {
  const shared = club(),
    personal = own(shared);
  expect(resolveBookChoice(meta(), [], [shared]).club?.id).toBe(shared.id);
  expect(resolveBookChoice(meta(), [personal], [shared]).own).toBe(personal);
  expect(resolveBookChoice(meta(), [], [shared]).metadata.totalPages).toBe(480);
  expect(catalogMetadata(shared).totalPages).toBe(600);
});
it('не связывает одноимённые книги разных авторов или мусорные ISBN', () => {
  expect(sameBook(meta(), { ...meta(), authors: 'Другой автор' })).toBe(false);
  expect(sameBook({ ...meta(), isbn: 'bad' }, { ...meta(), title: 'Другая', isbn: 'bad' })).toBe(
    false,
  );
  expect(
    sameBook(
      { ...meta(), isbn: '5-367-00198-X' },
      { ...meta(), title: 'Оригинальное название', isbn: '536700198X' },
    ),
  ).toBe(true);
});
it('существующая книга открывается без дубликата и находится по словам названия и автора', async () => {
  const shared = club(),
    personal = own(shared);
  await getDB().personal_books.put(personal);
  const open = vi.fn(),
    select = vi.fn();
  render(<BookFinder catalog={[shared]} onExisting={open} onSelect={select} onManual={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Найти книгу'), { target: { value: 'Дюна Герберт' } });
  const section = await screen.findByRole('region', { name: 'Уже у меня' });
  fireEvent.click(within(section).getByRole('button'));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ id: personal.id, notes: personal.notes }),
  );
  expect(select).not.toHaveBeenCalled();
  expect(await getDB().personal_books.count()).toBe(1);
});
it('интернет-издание получает UUID клуба, ручной ввод доступен и при отказе сети', async () => {
  const shared = club(),
    select = vi.fn(),
    manual = vi.fn();
  vi.mocked(searchBooks).mockResolvedValue([meta()]);
  render(
    <BookFinder catalog={[shared]} onExisting={vi.fn()} onSelect={select} onManual={manual} />,
  );
  fireEvent.change(screen.getByLabelText('Найти книгу'), { target: { value: 'Дюна' } });
  const section = await screen.findByRole('region', { name: 'В интернете' });
  fireEvent.click(within(section).getByRole('button'));
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ totalPages: 480 }), shared.id);
  vi.mocked(searchBooks).mockRejectedValue(new Error('Сеть'));
  fireEvent.change(screen.getByLabelText('Найти книгу'), {
    target: { value: 'Неизвестная книга' },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('добавить вручную');
  fireEvent.click(screen.getByRole('button', { name: 'Добавить вручную' }));
  expect(manual).toHaveBeenCalledWith('Неизвестная книга');
});
