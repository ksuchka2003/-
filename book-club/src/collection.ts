import type { Book, ClubBook, Meeting, Reading } from './domain';
export function personalCounts(books: Pick<Book, 'status'>[]) {
  const finished = books.filter((b) => b.status === 'finished').length;
  return {
    total: books.length,
    finished,
    unfinished: books.length - finished,
    reading: books.filter((b) => b.status === 'reading').length,
  };
}
export const clubBookFinished = (book: ClubBook, history: Reading[]) =>
  book.status === 'finished' ||
  history.some((r) => r.book_id === book.id && r.status === 'finished');
export function clubCounts(books: ClubBook[], history: Reading[]) {
  const finished = books.filter((b) => clubBookFinished(b, history)).length;
  return { total: books.length, finished, unfinished: books.length - finished };
}
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11
    ? one
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? few
      : many;
export const meetingEnd = (meeting: Meeting) =>
  Date.parse(meeting.starts_at) + (meeting.duration_minutes || 120) * 60000;
export function meetingCountdown(meeting: Meeting, now = Date.now()) {
  if (meeting.cancelled) return 'Встреча отменена';
  const delta = Date.parse(meeting.starts_at) - now;
  if (delta <= 0) return meetingEnd(meeting) > now ? 'Встреча идёт' : 'Встреча прошла';
  const minutes = Math.ceil(delta / 60000),
    days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    rest = minutes % 60;
  if (delta < 60000) return 'Меньше минуты до встречи';
  const parts = [];
  if (days) parts.push(`${days} ${plural(days, 'день', 'дня', 'дней')}`);
  if (hours) parts.push(`${hours} ${plural(hours, 'час', 'часа', 'часов')}`);
  if (!days && rest) parts.push(`${rest} ${plural(rest, 'минута', 'минуты', 'минут')}`);
  return 'До встречи ' + parts.join(' ');
}
export const decimal = (value: number | string) =>
  Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
export const quoteBookKey = (q: { book_id: string | null; title: string }) =>
  q.book_id || 'title:' + q.title;
