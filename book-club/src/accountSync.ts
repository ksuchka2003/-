import { getDB, type LibraryDB } from './db';
import { rows, action, currentIdentity } from './cloud';
import { createLibrarySynchronizer } from './privateSync';
import type { LibraryRecord, LibraryReply } from './privateTypes';
import type { PublicProgress, PublicQuote, PublicReview } from './domain';
import { enqueueBook, saveQuote, retract } from './local';
let owner: LibraryDB | undefined;
let instance: ReturnType<typeof createLibrarySynchronizer> | undefined;
async function reconcilePublicCopies(db: LibraryDB, memberId: string) {
  const identity = currentIdentity();
  if (identity?.id !== memberId || db !== getDB())
    throw new Error('Аккаунт изменился. Откройте приложение заново.');
  const [progress, reviews, quotes] = await Promise.all([
    rows<PublicProgress>('visible_progress', memberId),
    rows<PublicReview>('visible_reviews', memberId),
    rows<PublicQuote>('public_quotes', memberId),
  ]);
  const books = await db.personal_books.toArray();
  const localQuotes = await db.quotes.toArray();
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
      for (const p of progress.filter((p) => p.member_id === identity.id))
        if (!books.some((b) => b.id === p.id)) await retract('progress', p.id, true);
      for (const r of reviews.filter((r) => r.member_id === identity.id))
        if (!books.some((b) => b.id === r.id)) await retract('review', r.id, true);
      for (const q of quotes.filter((q) => q.member_id === identity.id))
        if (!localQuotes.some((x) => x.id === q.id && x.published && !x.deletedAt))
          await retract('quote', q.id, true);
      for (const b of books)
        await enqueueBook(b, undefined, {
          ...b,
          publishProgress: progress.some((p) => p.member_id === identity.id && p.id === b.id),
          publishReview: reviews.some((r) => r.member_id === identity.id && r.id === b.id),
        });
      for (const q of localQuotes) if (q.published) await saveQuote(q);
    },
  );
}
export function accountSync() {
  const db = getDB();
  const memberId = currentIdentity()?.id;
  if (!memberId) throw new Error('Войдите через Telegram для синхронизации');
  if (owner !== db || !instance) {
    owner = db;
    instance = createLibrarySynchronizer(
      db,
      {
        pull: () => rows<LibraryRecord>('private_library_records', memberId),
        push: (changes, device) =>
          action('private.sync', { changes, device }, memberId) as Promise<LibraryReply[]>,
      },
      () => reconcilePublicCopies(db, memberId),
    );
  }
  return instance;
}
