import { getDB } from './db';
import { clubDay } from './calendar';
import {
  bookSchema,
  quoteSchema,
  reviewSchema,
  progressSchema,
  type Progress,
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
    if (
      payload &&
      last?.scope === scope &&
      last.payload?.explicit_share === true &&
      ['quote', 'review'].includes(kind)
    )
      payload = { ...payload, explicit_share: true };
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
export async function enqueueBook(
  book: Book,
  review?: Review,
  previous?: Book,
  explicitShare = false,
) {
  if (book.deletedAt) {
    await retract('review', book.id, previous?.publishReview);
    return;
  }
  if (book.clubBookId) {
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
              explicit_share: explicitShare,
            }
          : null,
      );
  }
}
export async function saveBook(
  book: Book,
  pages: number,
  review: Review,
  explicitShare = false,
  details?: Pick<Progress, 'chapter' | 'startedOn' | 'finishedOn'>,
) {
  const parsed = bookSchema.parse(book);
  if (parsed.coverData && new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 240000)
    throw new Error(
      'Обложка и текст книги слишком большие. Сократите заметки или выберите другую обложку.',
    );
  const parsedReview = reviewSchema.parse(review);
  if (parsedReview.bookId !== parsed.id) throw new Error('Отзыв относится к другой книге');
  validProgress(pages, book.totalPages);
  if (book.publishReview && !book.clubBookId)
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
      const previousProgress = await db.reading_progress.get(book.id);
      const parsedProgress = progressSchema.parse({
        ...previousProgress,
        ...details,
        bookId: book.id,
        pages,
        updatedAt: now(),
      });
      await db.reading_progress.put(
        Object.fromEntries(
          Object.entries(parsedProgress).filter(([, value]) => value !== undefined),
        ) as Progress,
      );
      await db.personal_reviews.put(parsedReview);
      await enqueueBook(parsed, parsedReview, previous, explicitShare);
    },
  );
}
export async function changeBookStatus(id: string, status: Book['status']) {
  const db = getDB();
  await db.transaction(
    'rw',
    [db.personal_books, db.reading_progress, db.personal_reviews, db.sync_queue, db.settings],
    async () => {
      const book = await db.personal_books.get(id);
      if (!book || book.deletedAt) throw new Error('Книга находится в корзине');
      if (book.status === status) return;
      const p = await db.reading_progress.get(id),
        r = (await db.personal_reviews.get(id)) || {
          bookId: id,
          rating: null,
          text: '',
          spoilers: false,
          updatedAt: now(),
        };
      await saveBook(
        { ...book, status, updatedAt: now() },
        status === 'finished' ? book.totalPages : p?.pages || 0,
        r,
        false,
        {
          chapter: p?.chapter,
          startedOn: p?.startedOn || (status === 'reading' ? clubDay() : undefined),
          finishedOn: status === 'finished' ? p?.finishedOn || clubDay() : undefined,
        },
      );
    },
  );
}
export async function updateReadingProgress(
  id: string,
  pages: number | undefined,
  chapter: string | undefined,
  totalPages: number | undefined,
  finished = false,
) {
  const db = getDB();
  await db.transaction(
    'rw',
    [db.personal_books, db.reading_progress, db.personal_reviews, db.sync_queue, db.settings],
    async () => {
      const b = await db.personal_books.get(id);
      if (!b || b.deletedAt) throw new Error('Книга находится в корзине');
      const p = await db.reading_progress.get(id);
      const total = totalPages ?? b.totalPages;
      const current = pages ?? p?.pages ?? 0;
      const r = (await db.personal_reviews.get(id)) || {
        bookId: id,
        rating: null,
        text: '',
        spoilers: false,
        updatedAt: now(),
      };
      const status = finished
        ? 'finished'
        : (b.status === 'planned' && current > 0) || (b.status === 'finished' && current < total)
          ? 'reading'
          : b.status;
      await saveBook(
        { ...b, totalPages: total, status, updatedAt: now() },
        finished ? total : current,
        r,
        false,
        {
          chapter: chapter ?? p?.chapter,
          startedOn: p?.startedOn || (status === 'reading' ? clubDay() : undefined),
          finishedOn: status === 'finished' ? p?.finishedOn || clubDay() : undefined,
        },
      );
    },
  );
}
export async function trashBook(id: string) {
  const db = getDB();
  await db.transaction(
    'rw',
    [db.personal_books, db.quotes, db.sync_queue, db.settings],
    async () => {
      const book = await db.personal_books.get(id);
      if (!book || book.deletedAt) return;
      for (const q of await db.quotes.where('bookId').equals(id).toArray()) {
        await retract('quote', q.id, q.published);
        await db.quotes.put({ ...q, published: false, updatedAt: now() });
      }
      await retract('review', id, book.publishReview);
      await db.personal_books.put({
        ...book,
        deletedAt: now(),
        publishReview: false,
        publishProgress: false,
        updatedAt: now(),
      });
    },
  );
}
export async function restoreBook(id: string) {
  const db = getDB();
  await db.transaction(
    'rw',
    [db.personal_books, db.quotes, db.sync_queue, db.settings],
    async () => {
      const book = await db.personal_books.get(id);
      if (book?.deletedAt) {
        for (const q of await db.quotes.where('bookId').equals(id).toArray()) {
          await retract('quote', q.id, q.published);
          if (q.published) await db.quotes.put({ ...q, published: false, updatedAt: now() });
        }
        await db.personal_books.put({
          ...book,
          deletedAt: null,
          publishProgress: false,
          publishReview: false,
          updatedAt: now(),
        });
      }
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
      for (const q of quotes) {
        await retract('quote', q.id, q.published);
        await db.settings.delete('_draft:quote:' + q.id);
      }
      await db.settings.delete('_draft:book:' + id);
      await db.settings.delete('_draft:personal-thought:' + id);
      await db.settings.delete('_draft:quote:new:' + id);
      if (book?.clubBookId) await db.settings.delete('_draft:thought:' + book.clubBookId);
      await retract('review', id, book?.publishReview);
      await db.quotes.bulkDelete(quotes.map((q) => q.id));
      await db.personal_books.delete(id);
      await db.personal_reviews.delete(id);
      await db.reading_progress.delete(id);
    },
  );
}
export async function saveQuote(quote: Quote, explicitShare = false) {
  const q = quoteSchema.parse(quote);
  const db = getDB();
  const book = await db.personal_books.get(q.bookId);
  if (!book) throw new Error('Выберите книгу');
  if (book.deletedAt) throw new Error('Сначала восстановите книгу из корзины');
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
              explicit_share: explicitShare,
              source_id: q.sourceId,
              source_author: q.sourceAuthor,
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
    book_id: string | null;
    title: string;
    text: string;
    page: number | null;
    chapter: string;
    comment: string;
  },
  author: string,
) {
  const db = getDB();
  await db.transaction(
    'rw',
    [db.personal_books, db.club_catalog_cache, db.quotes, db.sync_queue, db.settings],
    async () => {
      if (await db.quotes.where('sourceId').equals(q.id).first())
        throw new Error('Цитата уже сохранена');
      let book = q.book_id
        ? await db.personal_books.where('clubBookId').equals(q.book_id).first()
        : undefined;
      if (book?.deletedAt) throw new Error('Книга находится в корзине. Сначала восстановите её.');
      if (!book) {
        const club = q.book_id ? await db.club_catalog_cache.get(q.book_id) : undefined;
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
    },
  );
}
