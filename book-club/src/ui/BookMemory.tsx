import { useEffect, useState } from 'react';
import {
  type Book,
  type ClubBook,
  type BookStats,
  type PublicQuote,
  type PublicReview,
  message,
} from '../domain';
import { decimal } from '../collection';
import { PublicContent } from './Social';
import { RatingStars } from './RatingStars';
import { EntryEditor } from './EntryEditor';
import { EntryFeed } from './EntryFeed';
import { ensurePersonalClubBook } from '../readerLocal';
import { Modal, useCloud, ErrorNote, Loading } from './shared';
export function BookStatistics({ bookId }: { bookId: string }) {
  const all = useCloud<BookStats>('club_book_stats');
  const stats = all.data?.find((s) => s.book_id === bookId);
  if (
    !all.isLoading &&
    !all.error &&
    (!stats ||
      !(
        Number(stats.rating_count) > 0 ||
        Number(stats.finished_readers) > 0 ||
        Number(stats.pace_count) > 0
      ))
  )
    return null;
  return (
    <section className="book-statistics">
      <ErrorNote text={all.error?.message} />
      {all.isLoading ? (
        <Loading />
      ) : (
        stats && (
          <>
            {stats.average_rating !== null && Number(stats.rating_count) > 0 && (
              <div>
                <RatingStars value={Number(stats.average_rating)} label="Средняя оценка" />
                <span>Средняя оценка · оценок: {stats.rating_count}</span>
              </div>
            )}
            {Number(stats.finished_readers) > 0 && (
              <div>
                <b>{stats.finished_readers}</b>
                <span>Отметили прочтение</span>
              </div>
            )}
            {Number(stats.pace_count) > 0 &&
              stats.pages_per_day !== null &&
              stats.average_days !== null && (
                <div>
                  <b>{decimal(stats.pages_per_day)} стр./день</b>
                  <span>В среднем {decimal(stats.average_days)} дн. на книгу</span>
                  <small>По указанным датам чтения · участников: {stats.pace_count}</small>
                </div>
              )}
          </>
        )
      )}
    </section>
  );
}
export function BookMemory({ bookId, onTab }: { bookId: string; onTab: (tab: string) => void }) {
  const quotes = useCloud<PublicQuote>('club_quotes');
  const reviews = useCloud<PublicReview>('club_reviews');
  const hasQuotes = quotes.data?.some((q) => q.book_id === bookId);
  const hasReviews = reviews.data?.some((r) => r.book_id === bookId);
  return (
    <>
      <BookStatistics bookId={bookId} />
      <details className="book-extra">
        <summary>Мысли участников</summary>
        <EntryFeed kind="thought" bookId={bookId} sort="likes" limit={3} />
        <button onClick={() => onTab('thought')}>Все мысли</button>
      </details>
      <details className="book-extra">
        <summary>Заметки по ходу чтения</summary>
        <EntryFeed kind="note" bookId={bookId} sort="likes" limit={3} />
        <button onClick={() => onTab('note')}>Все заметки</button>
      </details>
      <ErrorNote text={quotes.error?.message || reviews.error?.message} />
      {quotes.isLoading || reviews.isLoading ? (
        <Loading />
      ) : (
        !quotes.error &&
        !reviews.error && (
          <>
            {!hasQuotes && !hasReviews && (
              <p className="quiet-empty">Пока нет цитат и впечатлений к этой книге.</p>
            )}
            {hasQuotes && (
              <>
                <div className="section-title">
                  <h2>Цитаты, которые зацепили</h2>
                  <button onClick={() => onTab('quotes')}>Все цитаты</button>
                </div>
                <PublicContent type="quotes" bookId={bookId} sort="likes" limit={3} />
              </>
            )}
            {hasReviews && (
              <>
                <div className="section-title">
                  <h2>Отзывы участников</h2>
                  <button onClick={() => onTab('reviews')}>Все отзывы</button>
                </div>
                <PublicContent type="reviews" bookId={bookId} limit={3} />
              </>
            )}
          </>
        )
      )}
    </>
  );
}
export function BookThoughtEditor({ book, onClose }: { book: ClubBook; onClose: () => void }) {
  const [personal, setPersonal] = useState<Book | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      const own = await ensurePersonalClubBook(book);
      if (active) setPersonal(own);
    })().catch((e) => {
      if (active) setError(message(e));
    });
    return () => {
      active = false;
    };
  }, [book.id]);
  return personal ? (
    <EntryEditor book={personal} kind="thought" onClose={onClose} />
  ) : (
    <Modal title="Моя мысль" onClose={onClose}>
      {error ? <ErrorNote text={error} /> : <Loading />}
    </Modal>
  );
}
