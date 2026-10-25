import Dexie, { type Table } from 'dexie';
import {
  type Book,
  type Progress,
  type Review,
  type Quote,
  type SyncOp,
  type ClubBook,
} from './domain';
export class LibraryDB extends Dexie {
  personal_books!: Table<Book, string>;
  personal_reviews!: Table<Review, string>;
  reading_progress!: Table<Progress, string>;
  quotes!: Table<Quote, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  club_catalog_cache!: Table<ClubBook, string>;
  sync_queue!: Table<SyncOp, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      personal_books: 'id,clubBookId,status,title,updatedAt',
      personal_reviews: 'bookId',
      reading_progress: 'bookId',
      quotes: 'id,bookId,deletedAt,sourceId',
      settings: 'key',
      club_catalog_cache: 'id',
      sync_queue: 'id,scope,createdAt,[kind+entityId]',
    });
  }
}
let db = new LibraryDB('bookclub-local');
export const getDB = () => db;
export function openLibrary(scope: string) {
  db.close();
  db = new LibraryDB(`bookclub-${scope}`);
  return db;
}
export async function purgeTrash() {
  const expired = (await db.quotes.toArray()).filter(
    (q) => q.deletedAt && Date.parse(q.deletedAt) < Date.now() - 30 * 86400000 && !q.published,
  );
  await db.quotes.bulkDelete(expired.map((q) => q.id));
}
