import type { Book, ClubBook, Metadata } from './domain';
import { bookSearchKey } from './quoteBooks';
export const catalogMetadata = (b: ClubBook): Metadata => ({
  title: b.title,
  authors: b.authors,
  description: b.description,
  genre: b.genre,
  year: b.year,
  isbn: b.isbn,
  cover: b.cover,
  totalPages: b.default_pages,
});
export function similarClubBooks(title: string, catalog: ClubBook[]) {
  const key = bookSearchKey(title),
    words = key.split(' ').filter((w) => w.length > 2);
  if (key.length < 3) return [];
  return catalog.filter((b) => {
    const other = bookSearchKey(b.title);
    return (
      other === key ||
      (key.length >= 5 && (other.includes(key) || key.includes(other))) ||
      (words.length >= 2 &&
        words.filter((w) => other.split(' ').includes(w)).length / words.length >= 0.8)
    );
  });
}
export function sameBook(
  a: Pick<Metadata, 'title' | 'authors' | 'isbn'>,
  b: Pick<Metadata, 'title' | 'authors' | 'isbn'>,
) {
  const isbn = a.isbn.replace(/[^0-9X]/gi, '').toUpperCase();
  if (/^(\d{9}[\dX]|\d{13})$/.test(isbn) && isbn === b.isbn.replace(/[^0-9X]/gi, '').toUpperCase())
    return true;
  return (
    !!a.authors.trim() &&
    !!b.authors.trim() &&
    bookSearchKey(a.title) === bookSearchKey(b.title) &&
    bookSearchKey(a.authors) === bookSearchKey(b.authors)
  );
}
export function resolveBookChoice(metadata: Metadata, books: Book[], catalog: ClubBook[]) {
  const club = catalog.find((b) => sameBook(metadata, b));
  const own = books.find((b) => (club && b.clubBookId === club.id) || sameBook(metadata, b));
  return { metadata, club, own };
}
