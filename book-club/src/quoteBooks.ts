import { getDB } from './db';
import { saveBook } from './local';
import { now, type Book, type ClubBook } from './domain';
export const bookSearchKey = (value: string) =>
  value.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ');
export async function resolveQuoteBook({
  title,
  personalId,
  club,
  catalog,
  newId,
}: {
  title: string;
  personalId: string;
  club: ClubBook | null;
  catalog: ClubBook[];
  newId: string;
}): Promise<string> {
  const db = getDB();
  if (personalId) {
    const book = await db.personal_books.get(personalId);
    if (!book) throw new Error('Книга удалена. Выберите её заново.');
    if (book.deletedAt) throw new Error('Сначала восстановите книгу из корзины');
    return book.id;
  }
  const own = await db.personal_books.toArray();
  if (club) {
    const clubId = club.id;
    const existing = own.find((b) => b.clubBookId === clubId);
    if (existing?.deletedAt) throw new Error('Сначала восстановите книгу из корзины');
    if (existing) return existing.id;
  }
  if (!club) {
    const matches = own.filter(
      (b) => !b.deletedAt && bookSearchKey(b.title) === bookSearchKey(title),
    );
    const shared = catalog.filter(
      (b) =>
        bookSearchKey(b.title) === bookSearchKey(title) &&
        !matches.some((p) => p.clubBookId === b.id),
    );
    if (matches.length + shared.length > 1)
      throw new Error('Есть несколько книг с таким названием. Выберите нужную в подсказках.');
    if (matches.length === 1) return matches[0].id;
    if (shared.length === 1) club = shared[0];
  }
  if (club && own.some((b) => b.clubBookId === club.id && b.deletedAt))
    throw new Error('Сначала восстановите книгу из корзины');
  const book: Book = {
    id: newId,
    clubBookId: club?.id || null,
    title: club?.title || title.trim(),
    authors: club?.authors || '',
    description: club?.description || '',
    genre: club?.genre || '',
    year: club?.year ?? null,
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
  await saveBook(book, 0, {
    bookId: book.id,
    rating: null,
    text: '',
    spoilers: false,
    updatedAt: now(),
  });
  return book.id;
}
