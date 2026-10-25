import { z } from 'zod';
import { getDB } from './db';
import {
  bookSchema,
  reviewSchema,
  progressSchema,
  quoteSchema,
  validProgress,
  now,
} from './domain';
import { retract } from './local';
export const backupSchema = z.object({
  format: z.literal('bookclub'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  books: z.array(bookSchema).max(10000),
  reviews: z.array(reviewSchema).max(10000),
  progress: z.array(progressSchema).max(10000),
  quotes: z.array(quoteSchema).max(50000),
  settings: z.array(z.object({ key: z.string().max(100), value: z.unknown() })).max(100),
});
export async function exportBackup() {
  const db = getDB();
  return {
    format: 'bookclub' as const,
    version: 1 as const,
    exportedAt: now(),
    books: await db.personal_books.toArray(),
    reviews: await db.personal_reviews.toArray(),
    progress: await db.reading_progress.toArray(),
    quotes: await db.quotes.toArray(),
    settings: (await db.settings.toArray()).filter((s) => !s.key.startsWith('_')),
  };
}
export function parseBackup(raw: string) {
  if (raw.length > 20 * 1024 * 1024) throw new Error('Файл больше 20 МБ');
  const b = backupSchema.parse(JSON.parse(raw));
  const ids = new Set(b.books.map((x) => x.id));
  const clubIds = b.books.map((x) => x.clubBookId).filter(Boolean);
  if (new Set(clubIds).size !== clubIds.length) throw new Error('Книга клуба повторяется в файле');
  for (const rows of [b.books, b.quotes])
    if (new Set(rows.map((x) => x.id)).size !== rows.length)
      throw new Error('В файле повторяются UUID');
  for (const rows of [b.reviews, b.progress])
    if (new Set(rows.map((x) => x.bookId)).size !== rows.length)
      throw new Error('Повторяются данные книги');
  for (const row of [...b.reviews, ...b.progress, ...b.quotes])
    if (!ids.has(row.bookId)) throw new Error('Ссылка на отсутствующую книгу');
  for (const p of b.progress)
    validProgress(p.pages, b.books.find((x) => x.id === p.bookId)!.totalPages);
  return b;
}
export async function importBackup(raw: string, mode: 'merge' | 'replace') {
  const b = parseBackup(raw);
  const db = getDB();
  await db.transaction(
    'rw',
    [
      db.personal_books,
      db.personal_reviews,
      db.reading_progress,
      db.quotes,
      db.settings,
      db.sync_queue,
    ],
    async () => {
      if (mode === 'replace') {
        for (const row of await db.personal_books.toArray()) {
          await retract('progress', row.id, row.publishProgress);
          await retract('review', row.id, row.publishReview);
        }
        for (const row of await db.quotes.toArray()) await retract('quote', row.id, row.published);
        await db.personal_books.clear();
        await db.personal_reviews.clear();
        await db.reading_progress.clear();
        await db.quotes.clear();
        await db.settings.where('key').notEqual('_syncClock').delete();
      }
      // Импорт никогда не публикует данные. При объединении существующие UUID сохраняются.
      const added = new Set<string>();
      const mapping = new Map<string, string>();
      for (const book of b.books) {
        const existing =
          (await db.personal_books.get(book.id)) ||
          (book.clubBookId
            ? await db.personal_books.where('clubBookId').equals(book.clubBookId).first()
            : undefined);
        mapping.set(book.id, existing?.id || book.id);
        if (!existing) {
          await db.personal_books.add({ ...book, publishProgress: false, publishReview: false });
          added.add(book.id);
        }
      }
      for (const r of b.reviews) if (added.has(r.bookId)) await db.personal_reviews.put(r);
      for (const p of b.progress) if (added.has(p.bookId)) await db.reading_progress.put(p);
      for (const q of b.quotes)
        if (!(await db.quotes.get(q.id)))
          await db.quotes.add({ ...q, bookId: mapping.get(q.bookId)!, published: false });
      for (const s of b.settings)
        if (s.key === 'theme' && ['light', 'dark', 'system'].includes(String(s.value))) {
          if (!(await db.settings.get(s.key))) await db.settings.add(s);
        }
    },
  );
}
export async function downloadBackup() {
  const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `книжный-клуб-${now().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
