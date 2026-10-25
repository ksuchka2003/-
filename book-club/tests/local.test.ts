import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { getDB, openLibrary, purgeTrash } from '../src/db';
import { saveBook, saveQuote, trashQuote, restoreQuote } from '../src/local';
import { exportBackup, importBackup } from '../src/backup';
import { now, uid, percent, type Book } from '../src/domain';
const book = (): Book => ({
  id: uid(),
  clubBookId: null,
  title: 'Дюна',
  authors: 'Фрэнк Герберт',
  description: '',
  genre: 'Фантастика',
  year: 1965,
  isbn: '',
  cover: '',
  totalPages: 480,
  status: 'reading',
  notes: 'Личная заметка',
  publishProgress: false,
  publishReview: false,
  createdAt: now(),
  updatedAt: now(),
});
beforeEach(() => {
  openLibrary(uid());
});
afterEach(async () => {
  await getDB().delete();
});
describe('личные данные', () => {
  it('сохраняет издание и считает прогресс', async () => {
    const b = book();
    await saveBook(b, 200, {
      bookId: b.id,
      rating: 9,
      text: 'Отзыв',
      spoilers: false,
      updatedAt: now(),
    });
    expect((await getDB().personal_books.get(b.id))?.totalPages).toBe(480);
    expect(percent(200, 480)).toBe(42);
    expect(percent(0, 0)).toBe(0);
  });
  it('отклоняет неверные страницы до записи', async () => {
    const b = book();
    await expect(
      saveBook(b, 481, { bookId: b.id, rating: null, text: '', spoilers: false, updatedAt: now() }),
    ).rejects.toThrow();
    expect(await getDB().personal_books.count()).toBe(0);
  });
  it('управляет цитатами и корзиной', async () => {
    const b = book();
    await getDB().personal_books.add(b);
    const q = {
      id: uid(),
      bookId: b.id,
      text: 'Страх убивает разум',
      page: 1,
      chapter: '',
      comment: '',
      favorite: true,
      deletedAt: null,
      sourceId: null,
      sourceAuthor: null,
      published: false,
      createdAt: now(),
      updatedAt: now(),
    };
    await saveQuote(q);
    await trashQuote(q.id);
    expect((await getDB().quotes.get(q.id))?.deletedAt).toBeTruthy();
    await restoreQuote(q.id);
    expect((await getDB().quotes.get(q.id))?.published).toBe(false);
    await getDB().quotes.update(q.id, {
      deletedAt: new Date(Date.now() - 31 * 86400000).toISOString(),
    });
    await purgeTrash();
    expect(await getDB().quotes.count()).toBe(0);
  });
  it('экспортирует и импортирует без дубликатов и автопубликации', async () => {
    const b = book();
    await getDB().personal_books.add(b);
    const raw = JSON.stringify(await exportBackup());
    await importBackup(raw, 'replace');
    await importBackup(raw, 'merge');
    expect(await getDB().personal_books.count()).toBe(1);
    expect((await getDB().personal_books.get(b.id))?.notes).toBe(b.notes);
  });
  it('отклоняет повреждённый импорт без изменения базы', async () => {
    const b = book();
    await getDB().personal_books.add(b);
    await expect(importBackup('{"format":"bad"}', 'replace')).rejects.toThrow();
    expect(await getDB().personal_books.count()).toBe(1);
  });
  it('не ставит приватные записи в облачную очередь и не публикует заметки', async () => {
    const b = { ...book(), clubBookId: uid() };
    const r = {
      bookId: b.id,
      rating: 8,
      text: 'Приватный отзыв',
      spoilers: false,
      updatedAt: now(),
    };
    await saveBook(b, 50, r);
    expect(await getDB().sync_queue.count()).toBe(0);
    await saveBook({ ...b, publishProgress: true }, 50, r);
    const ops = await getDB().sync_queue.toArray();
    expect(ops).toHaveLength(1);
    expect(JSON.stringify(ops)).not.toContain(b.notes);
    expect(JSON.stringify(ops)).not.toContain(r.text);
  });
});
