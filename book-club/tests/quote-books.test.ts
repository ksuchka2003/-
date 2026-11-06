import { beforeEach, afterEach, expect, it } from 'vitest';
import { getDB, openLibrary } from '../src/db';
import { resolveQuoteBook } from '../src/quoteBooks';
import { now, uid, type ClubBook } from '../src/domain';
beforeEach(() => openLibrary(uid()));
afterEach(async () => {
  await getDB().delete();
});
const club = (): ClubBook => ({
  id: uid(),
  title: 'Солярис',
  authors: 'Станислав Лем',
  description: '',
  genre: '',
  year: null,
  isbn: '',
  cover: 'https://example.com/book.jpg',
  default_pages: 300,
  status: 'reading',
});
it('выбор клубной книги создаёт личную запись со связью, повтор не создаёт дубликат', async () => {
  const c = club();
  const id = await resolveQuoteBook({
    title: c.title,
    personalId: '',
    club: c,
    catalog: [c],
    newId: uid(),
  });
  expect(await getDB().personal_books.get(id)).toMatchObject({
    clubBookId: c.id,
    authors: c.authors,
    totalPages: 300,
    cover: c.cover,
    publishReview: false,
  });
  expect(
    await resolveQuoteBook({ title: c.title, personalId: '', club: c, catalog: [c], newId: uid() }),
  ).toBe(id);
  expect(await getDB().personal_books.count()).toBe(1);
});
it('точное введённое название использует личную книгу, не сбрасывая её параметры', async () => {
  const c = club(),
    id = await resolveQuoteBook({
      title: c.title,
      personalId: '',
      club: c,
      catalog: [c],
      newId: uid(),
    });
  await getDB().personal_books.update(id, { notes: 'Личные мысли', totalPages: 450 });
  expect(
    await resolveQuoteBook({
      title: '  СОЛЯРИС ',
      personalId: '',
      club: null,
      catalog: [c],
      newId: uid(),
    }),
  ).toBe(id);
  expect(await getDB().personal_books.get(id)).toMatchObject({
    notes: 'Личные мысли',
    totalPages: 450,
  });
});
it('одинаковые названия разных книг требуют явного выбора; ручное название тоже сохраняется', async () => {
  const a = club(),
    b = { ...club(), authors: 'Другой автор' };
  await expect(
    resolveQuoteBook({ title: a.title, personalId: '', club: null, catalog: [a, b], newId: uid() }),
  ).rejects.toThrow('несколько книг');
  expect(await getDB().personal_books.count()).toBe(0);
  const id = await resolveQuoteBook({
    title: 'Моя книга',
    personalId: '',
    club: null,
    catalog: [],
    newId: uid(),
  });
  expect(await getDB().personal_books.get(id)).toMatchObject({
    title: 'Моя книга',
    clubBookId: null,
  });
});
