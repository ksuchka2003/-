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
