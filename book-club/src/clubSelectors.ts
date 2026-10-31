import type { ClubBook, Reading, Meeting } from './domain';
export function currentClubBooks(books: ClubBook[], readings: Reading[]) {
  const active = readings
    .filter((r) => r.status === 'active')
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const ranked = books.filter(
    (b) =>
      b.status === 'reading' ||
      (active.some((r) => r.book_id === b.id) &&
        b.status !== 'finished' &&
        b.status !== 'archived'),
  );
  return ranked
    .map((book) => ({ book, reading: active.find((r) => r.book_id === book.id) }))
    .sort(
      (a, b) =>
        (a.reading?.position ?? Number.MAX_SAFE_INTEGER) -
          (b.reading?.position ?? Number.MAX_SAFE_INTEGER) ||
        a.book.title.localeCompare(b.book.title, 'ru'),
    );
}
export function nextClubMeeting(meetings: Meeting[], at = Date.now()) {
  return meetings
    .filter((m) => !m.cancelled && Date.parse(m.starts_at) > at)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
}
