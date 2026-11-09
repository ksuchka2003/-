import { getDB } from './db';
import { entrySchema, type Entry } from './readerDomain';
import { queue, retract } from './local';
import { now } from './domain';
export async function saveEntry(value: Entry) {
  const entry = entrySchema.parse(value),
    db = getDB();
  await db.transaction(
    'rw',
    [db.personal_books, db.entries, db.sync_queue, db.settings],
    async () => {
      const book = await db.personal_books.get(entry.bookId);
      if (!book || book.deletedAt) throw new Error('Сначала восстановите книгу из корзины');
      const previous = await db.entries.get(entry.id);
      await db.entries.put(entry);
      if (entry.published || previous?.published || (await db.sync_queue.get('entry:' + entry.id)))
        await queue(
          'entry',
          entry.id,
          entry.published && !entry.deletedAt ? { explicit_share: true } : null,
        );
    },
  );
}
export async function convertLegacyNote(entry: Entry, original: string) {
  const db = getDB();
  await db.transaction(
    'rw',
    [db.personal_books, db.entries, db.sync_queue, db.settings],
    async () => {
      const book = await db.personal_books.get(entry.bookId);
      if (!book || book.deletedAt) throw new Error('Книга находится в корзине');
      if (book.notes !== original)
        throw new Error(
          'Заметка изменена на другом устройстве. Откройте её заново — ваш текст остался в черновике.',
        );
      await saveEntry(entry);
      await db.personal_books.put({ ...book, notes: '', updatedAt: now() });
    },
  );
}
export async function deleteEntry(id: string) {
  const db = getDB();
  await db.transaction('rw', [db.entries, db.sync_queue, db.settings], async () => {
    const value = await db.entries.get(id);
    if (!value) return;
    await retract('entry', id, value.published);
    await db.entries.delete(id);
    await db.settings.delete('_draft:entry:' + id);
  });
}
