import { getDB } from './db';
import { type Book, type ClubBook, now, uid } from './domain';
import { saveBook, restoreBook, queue } from './local';
import { shelfSchema, type Shelf, type ReadingChoice } from './readerDomain';

export async function saveBookEdition(
  initial: { book: Book; pages: number; chapter: string; startedOn?: string; finishedOn?: string },
  value: { book: Book; pages: number; chapter: string; startedOn?: string; finishedOn?: string },
  editing: boolean,
  clubId: string | null,
) {
  const db = getDB();
  await db.transaction(
    'rw',
    [db.personal_books, db.personal_reviews, db.reading_progress, db.settings, db.sync_queue],
    async () => {
      const current = editing ? await db.personal_books.get(value.book.id) : undefined;
      if (editing && (!current || current.deletedAt)) throw new Error('Книга находится в корзине');
      const next = { ...(current || value.book) } as Book;
      for (const key of new Set([...Object.keys(initial.book), ...Object.keys(value.book)])) {
        const field = key as keyof Book;
        if (!current || JSON.stringify(initial.book[field]) !== JSON.stringify(value.book[field])) {
          if (value.book[field] === undefined)
            delete (next as unknown as Record<string, unknown>)[key];
          else (next as unknown as Record<string, unknown>)[key] = value.book[field];
        }
      }
      next.clubBookId = clubId;
      next.updatedAt = now();
      if (next.status === 'finished' && current?.status !== 'finished') next.completedAt = now();
      else if (next.status !== 'finished') delete next.completedAt;
      const p = await db.reading_progress.get(next.id);
      const pages =
        next.status === 'finished' && current?.status !== 'finished'
          ? next.totalPages
          : editing && value.pages === initial.pages
            ? p?.pages || 0
            : value.pages;
      await saveBook(
        next,
        pages,
        (await db.personal_reviews.get(next.id)) || {
          bookId: next.id,
          text: '',
          rating: null,
          spoilers: false,
          updatedAt: now(),
        },
        true,
        {
          chapter: editing && value.chapter === initial.chapter ? p?.chapter || '' : value.chapter,
          startedOn:
            value.startedOn === initial.startedOn ? p?.startedOn : value.startedOn || undefined,
          finishedOn:
            value.finishedOn === initial.finishedOn ? p?.finishedOn : value.finishedOn || undefined,
        },
      );
    },
  );
}

export function personalClubBook(book: ClubBook): Book {
  return {
    id: uid(),
    clubBookId: book.id,
    title: book.title,
    authors: book.authors,
    description: book.description || '',
    genre: book.genre || '',
    year: book.year || null,
    isbn: book.isbn || '',
    cover: book.cover || '',
    totalPages: book.default_pages || 0,
    status: 'reading',
    notes: '',
    publishProgress: false,
    publishReview: false,
    createdAt: now(),
    updatedAt: now(),
  };
}
export async function ensurePersonalClubBook(book: ClubBook) {
  const db = getDB();
  return db.transaction(
    'rw',
    [db.personal_books, db.personal_reviews, db.reading_progress, db.settings, db.sync_queue],
    async () => {
      const existing = await db.personal_books.where('clubBookId').equals(book.id).first();
      if (existing?.deletedAt) throw new Error('Сначала восстановите книгу из корзины');
      if (existing) return existing;
      const own = { ...personalClubBook(book), status: 'planned' as const };
      await saveBook(own, 0, {
        bookId: own.id,
        text: '',
        rating: null,
        spoilers: false,
        updatedAt: now(),
      });
      return own;
    },
  );
}
export async function chooseClubReading(book: ClubBook, readingId: string, choice: ReadingChoice) {
  const db = getDB();
  return db.transaction(
    'rw',
    [
      db.personal_books,
      db.personal_reviews,
      db.reading_progress,
      db.quotes,
      db.entries,
      db.settings,
      db.sync_queue,
    ],
    async () => {
      await queue('participation', readingId, { reading_id: readingId, choice });
      if (choice === 'declined') return null;
      let own = await db.personal_books.where('clubBookId').equals(book.id).first();
      if (own?.deletedAt) {
        await restoreBook(own.id);
        own = await db.personal_books.get(own.id);
      }
      own ||= personalClubBook(book);
      const progress = await db.reading_progress.get(own.id);
      const review = (await db.personal_reviews.get(own.id)) || {
        bookId: own.id,
        rating: null,
        text: '',
        spoilers: false,
        updatedAt: now(),
      };
      const restart = choice === 'reading' && own.status === 'finished';
      const status = choice === 'already_read' ? 'finished' : 'reading';
      const value = {
        ...own,
        status: status as Book['status'],
        completedAt: undefined,
        updatedAt: now(),
      };
      await saveBook(
        value,
        choice === 'already_read' ? own.totalPages : restart ? 0 : progress?.pages || 0,
        review,
        false,
        {
          chapter: restart ? '' : progress?.chapter,
          startedOn: restart ? undefined : progress?.startedOn,
          finishedOn: choice === 'already_read' ? progress?.finishedOn : undefined,
        },
      );
      return value;
    },
  );
}
export async function saveShelf(input: Shelf) {
  const shelf = shelfSchema.parse(input),
    db = getDB();
  await db.transaction('rw', db.settings, async () => {
    const shelves = ((await db.settings.get('shelves'))?.value || []) as Shelf[];
    if (
      shelves.some(
        (s) =>
          s.id !== shelf.id &&
          s.name.toLocaleLowerCase('ru') === shelf.name.toLocaleLowerCase('ru'),
      )
    )
      throw new Error('Полка с таким названием уже есть');
    await db.settings.put({
      key: 'shelves',
      value: [...shelves.filter((s) => s.id !== shelf.id), shelf],
    });
  });
}
export async function deleteShelf(id: string) {
  const db = getDB();
  await db.transaction('rw', [db.settings, db.personal_books], async () => {
    const shelves = ((await db.settings.get('shelves'))?.value || []) as Shelf[];
    await db.settings.put({ key: 'shelves', value: shelves.filter((s) => s.id !== id) });
    await db.personal_books
      .filter((b) => !!b.shelfIds?.includes(id))
      .modify((b) => {
        b.shelfIds = b.shelfIds?.filter((s) => s !== id);
        b.updatedAt = now();
      });
  });
}
export async function setBookShelves(id: string, selected: string[]) {
  const db = getDB();
  await db.transaction('rw', [db.settings, db.personal_books], async () => {
    const book = await db.personal_books.get(id);
    if (!book || book.deletedAt) throw new Error('Книга находится в корзине');
    const shelves = ((await db.settings.get('shelves'))?.value || []) as Shelf[];
    if (selected.some((s) => !shelves.some((existing) => existing.id === s)))
      throw new Error('Полка уже удалена. Откройте список заново.');
    await db.personal_books.put({ ...book, shelfIds: [...new Set(selected)], updatedAt: now() });
  });
}
export async function moveBookShelf(id: string, from: string, to: string) {
  const db = getDB();
  await db.transaction('rw', [db.settings, db.personal_books], async () => {
    const book = await db.personal_books.get(id);
    if (!book || book.deletedAt) throw new Error('Книга находится в корзине');
    const shelves = ((await db.settings.get('shelves'))?.value || []) as Shelf[];
    if (!shelves.some((s) => s.id === to)) throw new Error('Полка удалена. Выберите другую.');
    await db.personal_books.put({
      ...book,
      shelfIds: [...new Set([...(book.shelfIds || []).filter((s) => s !== from), to])],
      updatedAt: now(),
    });
  });
}
