import { useEffect, useState } from 'react';
import { type Book, type ClubBook, type BookStats, type Reading, message } from '../domain';
import { RatingStars } from './RatingStars';
import { EntryEditor } from './EntryEditor';
import { ensurePersonalClubBook } from '../readerLocal';
import { Modal, useCloud, ErrorNote, Loading } from './shared';

export function BookStatistics({ bookId }: { bookId: string }) {
  const all = useCloud<BookStats>('club_book_stats');
  const stats = all.data?.find((s) => s.book_id === bookId);
  return (
    <section className="book-rating" aria-label="Рейтинг книги">
      <h2>Рейтинг клуба</h2>
      <ErrorNote text={all.error?.message} />
      {all.isLoading ? (
        <Loading />
      ) : (
        !all.error &&
        (stats?.average_rating !== null &&
        stats?.average_rating !== undefined &&
        Number(stats.rating_count) > 0 ? (
          <>
            <RatingStars value={Number(stats.average_rating)} label="Средняя оценка" />
            <small>Оценок в клубе: {stats.rating_count}</small>
          </>
        ) : (
          <p className="muted">Оценок в клубе пока нет.</p>
        ))
      )}
    </section>
  );
}

export function BookMemory({ book, readings }: { book: ClubBook; readings: Reading[] }) {
  const completed = readings.filter((r) => r.book_id === book.id && r.status === 'finished');
  const ended = completed
    .filter((r) => r.ends_on)
    .sort((a, b) => b.ends_on!.localeCompare(a.ends_on!))[0]?.ends_on;
  const date =
    ended &&
    new Date(ended + 'T12:00:00Z').toLocaleDateString('ru-RU', {
      dateStyle: 'long',
      timeZone: 'Europe/Moscow',
    });
  return (
    <section className="book-overview" aria-label="О книге">
      <dl className="book-facts">
        {book.genre && (
          <div>
            <dt>Жанр</dt>
            <dd>{book.genre}</dd>
          </div>
        )}
        {book.year && (
          <div>
            <dt>Год</dt>
            <dd>{book.year}</dd>
          </div>
        )}
        {(date || completed.length > 0 || book.status === 'finished') && (
          <div>
            <dt>Прочитано клубом</dt>
            <dd>{date || 'Дата не указана'}</dd>
          </div>
        )}
      </dl>
      {book.description && (
        <div className="book-annotation">
          <h2>Аннотация</h2>
          <p className="prewrap">{book.description}</p>
        </div>
      )}
      <BookStatistics bookId={book.id} />
    </section>
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
