import { useCloud } from './shared';
import type { ClubBook } from '../domain';
export type ReadingAward = {
  id: string;
  book_id: string;
  member_id: string;
  kind: 'first' | 'last';
};
export function ReadingAwards({ memberId, bookId }: { memberId: string; bookId?: string }) {
  const awards = useCloud<ReadingAward>('club_reading_awards'),
    books = useCloud<ClubBook>('club_books');
  const own =
    awards.data?.filter((a) => a.member_id === memberId && (!bookId || a.book_id === bookId)) || [];
  if (!own.length) return null;
  return (
    <span className="reading-awards">
      {own.map((a) => {
        const title = books.data?.find((b) => b.id === a.book_id)?.title || 'Книга',
          label = a.kind === 'first' ? 'Первый финиш' : 'Последний финиш';
        return (
          <span
            key={a.id}
            className={`reading-award ${a.kind}`}
            title={`${label}: ${title}`}
            aria-label={`${label}: ${title}`}
          >
            {a.kind === 'first' ? '🥇' : '💩'}
            <span>{label}</span>
          </span>
        );
      })}
    </span>
  );
}
