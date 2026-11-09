import { beforeEach, afterEach, it, expect } from 'vitest';
import { getDB, openLibrary, LibraryDB } from '../src/db';
import { uid, now, type Book } from '../src/domain';
import { saveBook, saveQuote, deleteBook, setSyncScope } from '../src/local';
import { saveEntry, deleteEntry, convertLegacyNote } from '../src/entries';
import {
  saveShelf,
  setBookShelves,
  moveBookShelf,
  deleteShelf,
  chooseClubReading,
} from '../src/readerLocal';
import { exportBackup, importBackup, parseBackup } from '../src/backup';
import { catalogMetadata, similarClubBooks } from '../src/bookMatches';
import { createLibrarySynchronizer } from '../src/privateSync';
import type { Entry } from '../src/readerDomain';
import type { LibraryChange, LibraryRecord } from '../src/privateTypes';
const book = (): Book => ({
  id: uid(),
  clubBookId: null,
  title: 'Дюна',
  authors: 'Фрэнк Герберт',
  description: '',
  genre: '',
  year: null,
  isbn: '',
  cover: '',
  totalPages: 480,
  status: 'reading',
  notes: '',
  publishProgress: false,
  publishReview: false,
  createdAt: now(),
  updatedAt: now(),
});
const entry = (b: Book): Entry => ({
  id: uid(),
  bookId: b.id,
  kind: 'thought',
  text: 'Мысль по книге',
  page: 12,
  chapter: 'Глава 2',
  published: false,
  deletedAt: null,
  createdAt: now(),
  updatedAt: now(),
});
async function store(b: Book) {
  await saveBook(b, 10, {
    bookId: b.id,
    rating: null,
    text: '',
    spoilers: false,
    updatedAt: now(),
  });
}
beforeEach(() => {
  const id = uid();
  openLibrary(id);
  setSyncScope(id);
});
afterEach(async () => {
  await getDB().delete();
});
it('заметки и мысли независимы, приватны по умолчанию; удаление снимает публикацию', async () => {
  const b = book(),
    first = entry(b),
    second = { ...entry(b), kind: 'note' as const };
  await store(b);
  await saveEntry(first);
  await saveEntry(second);
  expect(await getDB().entries.count()).toBe(2);
  expect(await getDB().sync_queue.count()).toBe(0);
  await saveEntry({ ...first, published: true });
  expect((await getDB().sync_queue.get('entry:' + first.id))?.payload).toEqual({
    explicit_share: true,
  });
  await deleteEntry(first.id);
  expect(await getDB().entries.get(first.id)).toBeUndefined();
  expect((await getDB().sync_queue.get('entry:' + first.id))?.payload).toBeNull();
  await deleteBook(b.id);
  expect(await getDB().entries.count()).toBe(0);
  await expect(saveEntry(second)).rejects.toThrow('восстановите');
});
it('перенос прежней заметки сохраняет текст и защищает изменения другого устройства', async () => {
  const b = { ...book(), notes: 'Старый текст' };
  await store(b);
  await convertLegacyNote({ ...entry(b), kind: 'note', text: b.notes }, b.notes);
  expect((await getDB().personal_books.get(b.id))?.notes).toBe('');
  expect((await getDB().entries.toArray())[0].text).toBe(b.notes);
  await expect(convertLegacyNote(entry(b), b.notes)).rejects.toThrow('изменена');
  expect(await getDB().entries.count()).toBe(1);
});
it('перемещение между полками сохраняет остальные полки; удаление полки не удаляет книги', async () => {
  const b = book(),
    a = { id: uid(), name: 'Любимое' },
    z = { id: uid(), name: 'Лето' },
    other = { id: uid(), name: 'Обсудить' };
  await store(b);
  for (const s of [a, z, other]) await saveShelf(s);
  await expect(saveShelf({ id: uid(), name: 'любимое' })).rejects.toThrow();
  await setBookShelves(b.id, [a.id, other.id]);
  await moveBookShelf(b.id, a.id, z.id);
  expect((await getDB().personal_books.get(b.id))?.shelfIds?.sort()).toEqual(
    [other.id, z.id].sort(),
  );
  await deleteShelf(z.id);
  expect((await getDB().personal_books.get(b.id))?.shelfIds).toEqual([other.id]);
  expect(await getDB().personal_books.count()).toBe(1);
});
it('резервная копия сохраняет мысли, полки и цитату без книги; объединение не публикует и не дублирует', async () => {
  const b = book(),
    shelf = { id: uid(), name: 'Кофе и книги' };
  await store(b);
  await saveShelf(shelf);
  await setBookShelves(b.id, [shelf.id]);
  await saveEntry({ ...entry(b), published: true });
  await saveQuote({
    id: uid(),
    bookId: null,
    text: 'Отдельная фраза',
    page: null,
    chapter: '',
    comment: '',
    favorite: true,
    deletedAt: null,
    sourceId: null,
    sourceAuthor: null,
    published: false,
    createdAt: now(),
    updatedAt: now(),
  });
  const raw = JSON.stringify(await exportBackup());
  parseBackup(raw);
  await importBackup(raw, 'replace');
  await importBackup(raw, 'merge');
  expect(await getDB().entries.count()).toBe(1);
  expect((await getDB().entries.toArray())[0].published).toBe(false);
  expect((await getDB().quotes.toArray())[0].bookId).toBeNull();
  expect(await getDB().personal_books.count()).toBe(1);
  const corrupt = JSON.parse(raw);
  corrupt.entries[0].bookId = uid();
  await expect(importBackup(JSON.stringify(corrupt), 'replace')).rejects.toThrow('отсутствующую');
  expect(await getDB().entries.count()).toBe(1);
});
it('решение об участии сохраняется до синхронизации; уже прочитанная не начинает гонку', async () => {
  const shared = { ...book(), id: uid(), default_pages: 600, status: 'reading' as const },
    cycle = uid();
  expect(catalogMetadata(shared).totalPages).toBe(600);
  expect(await chooseClubReading(shared, cycle, 'declined')).toBeNull();
  expect(await getDB().personal_books.count()).toBe(0);
  const own = await chooseClubReading(shared, cycle, 'already_read');
  expect(own?.status).toBe('finished');
  expect(own?.completedAt).toBeUndefined();
  expect((await getDB().reading_progress.get(own!.id))?.pages).toBe(600);
  expect((await getDB().sync_queue.get('participation:' + cycle))?.payload?.choice).toBe(
    'already_read',
  );
  await chooseClubReading(shared, cycle, 'reading');
  expect(await getDB().personal_books.count()).toBe(1);
  expect((await getDB().reading_progress.get(own!.id))?.pages).toBe(0);
});
it('похожие названия предлагают клубную связь, не меняя UUID автоматически', () => {
  const shared = { ...book(), default_pages: 480, status: 'planned' as const };
  expect(similarClubBooks('Дюна', [shared])).toHaveLength(1);
  expect(similarClubBooks('дю', [shared])).toHaveLength(0);
  expect(similarClubBooks('Другая книга', [shared])).toHaveLength(0);
});

it('новые записи, полки и оформление переносятся на другое устройство и удаляются без воскрешения', async () => {
  const a = getDB(),
    b = new LibraryDB('reader-device-' + uid()),
    rows = new Map<string, LibraryRecord>();
  let revision = 0;
  const transport = {
    pull: async () => [...rows.values()].map((r) => structuredClone(r)),
    push: async (changes: LibraryChange[], device: string) =>
      changes.map((c) => {
        const key = c.kind + ':' + c.entity_id,
          old = rows.get(key);
        if ((old?.revision || 0) !== c.base_revision)
          return { status: 'conflict' as const, record: old! };
        const record = {
          kind: c.kind,
          entity_id: c.entity_id,
          payload: structuredClone(c.payload),
          revision: ++revision,
          device_id: device,
        };
        rows.set(key, record);
        return { status: 'applied' as const, record };
      }),
  };
  const syncA = createLibrarySynchronizer(a, transport),
    syncB = createLibrarySynchronizer(b, transport);
  try {
    const own = book(),
      record = entry(own),
      shelf = { id: uid(), name: 'Моя полка' };
    await store(own);
    await saveEntry(record);
    await saveShelf(shelf);
    await setBookShelves(own.id, [shelf.id]);
    await a.settings.put({ key: 'palette', value: 'ink' });
    await syncA.sync();
    await syncB.sync();
    expect((await b.settings.get('_librarySync'))?.value).toMatchObject({
      phase: 'idle',
      error: '',
    });
    expect(await b.entries.get(record.id)).toEqual(record);
    expect((await b.personal_books.get(own.id))?.shelfIds).toEqual([shelf.id]);
    expect((await b.settings.get('palette'))?.value).toBe('ink');
    await b.entries.update(record.id, { text: 'Изменено на телефоне' });
    await syncB.sync();
    await syncA.sync();
    expect((await a.entries.get(record.id))?.text).toBe('Изменено на телефоне');
    await deleteBook(own.id);
    await syncA.sync();
    await syncB.sync();
    expect(await b.entries.count()).toBe(0);
    expect(await b.personal_books.count()).toBe(0);
  } finally {
    await b.delete();
  }
});

it('две одновременные попытки добавить клубную книгу переиспользуют одно издание', async () => {
  const shared = { ...book(), default_pages: 300, status: 'planned' as const };
  const { ensurePersonalClubBook } = await import('../src/readerLocal');
  const [a, b] = await Promise.all([
    ensurePersonalClubBook(shared),
    ensurePersonalClubBook(shared),
  ]);
  expect(a.id).toBe(b.id);
  expect(await getDB().personal_books.count()).toBe(1);
});
it('редактор издания сохраняет параллельные записи и прогресс, обложка действительно сбрасывается', async () => {
  const { saveBookEdition } = await import('../src/readerLocal');
  const own = { ...book(), coverData: 'data:image/jpeg;base64,' + 'A'.repeat(100) };
  await store(own);
  const initial = { book: own, pages: 10, chapter: '' };
  await getDB().personal_books.update(own.id, {
    notes: 'Правка с другого устройства',
    shelfIds: [uid()],
  });
  await getDB().reading_progress.update(own.id, { pages: 200, chapter: 'Глава 9' });
  const { coverData, ...edition } = own;
  await saveBookEdition(
    initial,
    { book: { ...edition, year: 2020 }, pages: 10, chapter: '' },
    true,
    null,
  );
  expect(await getDB().personal_books.get(own.id)).toMatchObject({
    notes: 'Правка с другого устройства',
    year: 2020,
  });
  expect((await getDB().personal_books.get(own.id))?.coverData).toBeUndefined();
  expect(await getDB().reading_progress.get(own.id)).toMatchObject({
    pages: 200,
    chapter: 'Глава 9',
  });
});
