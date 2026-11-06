import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { getDB, openLibrary, purgeTrash } from '../src/db';
import {
  saveBook,
  saveQuote,
  trashQuote,
  restoreQuote,
  copyPublicQuote,
  changeBookStatus,
} from '../src/local';
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
it('личная обложка входит в резервную копию, а неподдерживаемое изображение не сохраняется', async () => {
  const b = { ...book(), coverData: 'data:image/jpeg;base64,/9j/AA==' };
  const review = { bookId: b.id, rating: 9, text: 'Отзыв', spoilers: false, updatedAt: now() };
  await saveBook(b, 10, review);
  const data = JSON.stringify(await exportBackup());
  await importBackup(data, 'replace');
  expect((await getDB().personal_books.get(b.id))?.coverData).toBe(b.coverData);
  await expect(
    saveBook({ ...b, coverData: 'data:image/svg+xml;base64,AAAA' }, 10, review),
  ).rejects.toThrow();
  expect((await getDB().personal_books.get(b.id))?.coverData).toBe(b.coverData);
});
describe('личные данные', () => {
  it('быстрая смена статуса сохраняет заметки, оценку и главу, завершение ставит полный прогресс', async () => {
    const b = book(),
      review = {
        bookId: b.id,
        rating: 9,
        text: 'Приватный отзыв',
        spoilers: true,
        updatedAt: now(),
      };
    await saveBook(b, 200, review, false, { chapter: 'Глава 7', startedOn: '2026-01-01' });
    await changeBookStatus(b.id, 'finished');
    expect(await getDB().personal_books.get(b.id)).toMatchObject({
      status: 'finished',
      notes: b.notes,
      publishReview: false,
    });
    expect(await getDB().reading_progress.get(b.id)).toMatchObject({
      pages: 480,
      chapter: 'Глава 7',
      startedOn: '2026-01-01',
    });
    expect(await getDB().personal_reviews.get(b.id)).toEqual(review);
    await changeBookStatus(b.id, 'paused');
    expect((await getDB().reading_progress.get(b.id))?.finishedOn).toBeUndefined();
    expect((await getDB().reading_progress.get(b.id))?.pages).toBe(480);
  });
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
  it('полная замена сохраняет служебные версии устройства для синхронизации', async () => {
    await getDB().settings.bulkPut([
      { key: '_privateDevice', value: 'device-id' },
      { key: '_syncClock', value: 123 },
      { key: 'theme', value: 'dark' },
    ]);
    const backup = await exportBackup();
    backup.settings = [];
    await importBackup(JSON.stringify(backup), 'replace');
    expect((await getDB().settings.get('_privateDevice'))?.value).toBe('device-id');
    expect((await getDB().settings.get('_syncClock'))?.value).toBe(123);
    expect(await getDB().settings.get('theme')).toBeUndefined();
  });
  it('отклоняет повреждённый импорт без изменения базы', async () => {
    const b = book();
    await getDB().personal_books.add(b);
    await expect(importBackup('{"format":"bad"}', 'replace')).rejects.toThrow();
    expect(await getDB().personal_books.count()).toBe(1);
  });
  it('не ставит приватные записи в публичную очередь и не публикует заметки', async () => {
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
    expect(await getDB().sync_queue.count()).toBe(0);
    await saveBook({ ...b, publishReview: true }, 50, r, true);
    const ops = await getDB().sync_queue.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('review');
    expect(ops[0].payload).toMatchObject({ text: 'Приватный отзыв', explicit_share: true });
    expect(ops[0].payload).not.toHaveProperty('notes');
  });
});

it('личная цитата делится без каталога; быстрый лайк избранного не теряет согласие на публикацию', async () => {
  const b = book();
  await getDB().personal_books.add(b);
  const q = {
    id: uid(),
    bookId: b.id,
    text: 'Моя цитата',
    page: null,
    chapter: '',
    comment: '',
    favorite: false,
    deletedAt: null,
    sourceId: null,
    sourceAuthor: null,
    published: true,
    createdAt: now(),
    updatedAt: now(),
  };
  await saveQuote(q, true);
  await saveQuote({ ...q, favorite: true });
  const pending = await getDB().sync_queue.get('quote:' + q.id);
  expect(pending?.payload).toMatchObject({
    book_id: null,
    explicit_share: true,
    text: 'Моя цитата',
  });
  await saveQuote({ ...q, published: false });
  expect((await getDB().sync_queue.get('quote:' + q.id))?.payload).toBeNull();
});
it('сохранение цитаты из личной книги другого участника создаёт независимую приватную копию', async () => {
  const q = {
    id: uid(),
    book_id: null,
    title: 'Не в каталоге',
    text: 'Чужая цитата',
    page: 5,
    chapter: '',
    comment: 'Комментарий',
  };
  await copyPublicQuote(q, 'Анна');
  expect((await getDB().quotes.toArray())[0]).toMatchObject({
    sourceId: q.id,
    sourceAuthor: 'Анна',
    published: false,
    text: q.text,
  });
  expect((await getDB().personal_books.toArray())[0].clubBookId).toBeNull();
  await expect(copyPublicQuote(q, 'Анна')).rejects.toThrow('уже сохранена');
  expect(await getDB().sync_queue.count()).toBe(0);
});

it('сохраняет главу и даты, быстрые обновления страниц их не стирают; неверные даты откатывают книгу', async () => {
  const b = book(),
    r = { bookId: b.id, rating: null, text: '', spoilers: false, updatedAt: now() };
  await saveBook(b, 10, r, false, {
    chapter: 'Глава 2',
    startedOn: '2019-01-01',
    finishedOn: '2019-01-03',
  });
  await saveBook(b, 20, r);
  expect(await getDB().reading_progress.get(b.id)).toMatchObject({
    pages: 20,
    chapter: 'Глава 2',
    startedOn: '2019-01-01',
    finishedOn: '2019-01-03',
  });
  await expect(
    saveBook({ ...b, title: 'Не должно сохраниться' }, 30, r, false, {
      startedOn: '2019-01-05',
      finishedOn: '2019-01-03',
    }),
  ).rejects.toThrow();
  expect((await getDB().personal_books.get(b.id))?.title).toBe(b.title);
  await saveBook(b, 20, r, false, { chapter: '', startedOn: undefined, finishedOn: undefined });
  const p = await getDB().reading_progress.get(b.id);
  expect(p).not.toHaveProperty('startedOn');
  expect(p).not.toHaveProperty('finishedOn');
});
