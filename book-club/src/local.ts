import { getDB } from './db';
import {
  bookSchema,
  quoteSchema,
  reviewSchema,
  now,
  uid,
  validProgress,
  type Book,
  type Quote,
  type Review,
  type SyncOp,
} from './domain';
let scope = 'local';
export function setSyncScope(value: string) {
  scope = value;
}
export async function queue(
  kind: SyncOp['kind'],
  entityId: string,
  payload: Record<string, unknown> | null,
) {
  const db = getDB();
  const id = `${kind}:${entityId}`;
  await db.transaction('rw', [db.sync_queue, db.settings], async () => {
    const last = await db.sync_queue.get(id);
    const clock = await db.settings.get('_syncClock');
    const version = Math.max(
      Date.now() * 1000,
      Number(clock?.value || 0) + 1,
      (last?.version || 0) + 1,
    );
    await db.settings.put({ key: '_syncClock', value: version });
    await db.sync_queue.put({
      id,
      scope,
      kind,
      entityId,
      payload,
      revision: uid(),
      version,
      attempts: 0,
      error: '',
      createdAt: now(),
    });
  });
}
export async function retract(kind: SyncOp['kind'], id: string, published = false) {
  if (published || (await getDB().sync_queue.get(`${kind}:${id}`))) await queue(kind, id, null);
}
export async function enqueueBook(book: Book, review?: Review, previous?: Book) {
  const progress = await getDB().reading_progress.get(book.id);
  if (book.clubBookId) {
    if (
      book.publishProgress ||
      previous?.publishProgress ||
      (await getDB().sync_queue.get(`progress:${book.id}`))
    )
      await queue(
        'progress',
        book.id,
        book.publishProgress
          ? {
              book_id: book.clubBookId,
              title: book.title,
              status: book.status,
              pages: progress?.pages || 0,
              total_pages: book.totalPages,
            }
          : null,
      );
    const r = review || (await getDB().personal_reviews.get(book.id));
    if (
      book.publishReview ||
      previous?.publishReview ||
      (await getDB().sync_queue.get(`review:${book.id}`))
    )
      await queue(
        'review',
        book.id,
        book.publishReview && r
          ? {
              book_id: book.clubBookId,
              title: book.title,
              rating: r.rating,
              text: r.text,
              spoilers: r.spoilers,
            }
          : null,
      );
  }
}
export async function saveBook(book: Book, pages: number, review: Review) {
  const parsed = bookSchema.parse(book);
  const parsedReview = reviewSchema.parse(review);
  if (parsedReview.bookId !== parsed.id) throw new Error('Отзыв относится к другой книге');
  validProgress(pages, book.totalPages);
  if ((book.publishProgress || book.publishReview) && !book.clubBookId)
    throw new Error('Для публикации добавьте книгу из каталога клуба');
  const db = getDB();
  if (
    book.clubBookId &&
    (await db.personal_books.where('clubBookId').equals(book.clubBookId).toArray()).some(
      (b) => b.id !== book.id,
    )
  )
    throw new Error('Эта книга уже есть в вашей библиотеке');
  await db.transaction(
    'rw',
    [db.personal_books, db.reading_progress, db.personal_reviews, db.sync_queue, db.settings],
    async () => {
      const previous = await db.personal_books.get(parsed.id);
      await db.personal_books.put(parsed);
      await db.reading_progress.put({ bookId: book.id, pages, updatedAt: now() });
      await db.personal_reviews.put(parsedReview);
      await enqueueBook(parsed, parsedReview, previous);
    },
  );
}
export async function deleteBook(id: string) {
  const db = getDB();
  await db.transaction(
    'rw',
    [
      db.personal_books,
      db.personal_reviews,
      db.reading_progress,
      db.quotes,
      db.sync_queue,
      db.settings,
    ],
    async () => {
      const quotes = await db.quotes.where('bookId').equals(id).toArray();
      const book = await db.personal_books.get(id);
      for (const q of quotes) await retract('quote', q.id, q.published);
      await retract('progress', id, book?.publishProgress);
      await retract('review', id, book?.publishReview);
      await db.quotes.bulkDelete(quotes.map((q) => q.id));
      await db.personal_books.delete(id);
      await db.personal_reviews.delete(id);
      await db.reading_progress.delete(id);
    },
  );
}
export async function saveQuote(quote: Quote) {
  const q = quoteSchema.parse(quote);
  const db = getDB();
  const book = await db.personal_books.get(q.bookId);
  if (!book) throw new Error('Выберите книгу');
  if (q.published && !book.clubBookId)
    throw new Error('Для публикации нужна книга из каталога клуба');
  await db.transaction('rw', [db.quotes, db.sync_queue, db.settings], async () => {
    const previous = await db.quotes.get(q.id);
    await db.quotes.put(q);
    if (q.published || previous?.published || (await db.sync_queue.get(`quote:${q.id}`)))
      await queue(
        'quote',
        q.id,
        q.published && !q.deletedAt
          ? {
              book_id: book.clubBookId,
              title: book.title,
              text: q.text,
              page: q.page,
              chapter: q.chapter,
              comment: q.comment,
            }
          : null,
      );
  });
}
export async function trashQuote(id: string) {
  const q = await getDB().quotes.get(id);
  if (q) await saveQuote({ ...q, deletedAt: now(), updatedAt: now() });
}
export async function restoreQuote(id: string) {
  const q = await getDB().quotes.get(id);
  if (q) await saveQuote({ ...q, deletedAt: null, published: false, updatedAt: now() });
}
export async function eraseQuote(id: string) {
  const db = getDB();
  await db.transaction('rw', [db.quotes, db.sync_queue, db.settings], async () => {
    await retract('quote', id, (await db.quotes.get(id))?.published);
    await db.quotes.delete(id);
  });
}
export async function copyPublicQuote(
  q: {
    id: string;
    book_id: string;
    title: string;
    text: string;
    page: number | null;
    chapter: string;
    comment: string;
  },
  author: string,
) {
  const db = getDB();
  if (await db.quotes.where('sourceId').equals(q.id).first())
    throw new Error('Цитата уже сохранена');
  let book = await db.personal_books.where('clubBookId').equals(q.book_id).first();
  if (!book) {
    const club = await db.club_catalog_cache.get(q.book_id);
    book = {
      id: uid(),
      clubBookId: q.book_id,
      title: q.title,
      authors: club?.authors || '',
      description: club?.description || '',
      genre: club?.genre || '',
      year: club?.year || null,
      isbn: club?.isbn || '',
      cover: club?.cover || '',
      totalPages: club?.default_pages || 0,
      status: 'planned',
      notes: '',
      publishProgress: false,
      publishReview: false,
      createdAt: now(),
      updatedAt: now(),
    };
    await db.personal_books.add(book);
  }
  await saveQuote({
    id: uid(),
    bookId: book.id,
    text: q.text,
    page: q.page,
    chapter: q.chapter,
    comment: q.comment,
    favorite: false,
    deletedAt: null,
    sourceId: q.id,
    sourceAuthor: author,
    published: false,
    createdAt: now(),
    updatedAt: now(),
  });
}
