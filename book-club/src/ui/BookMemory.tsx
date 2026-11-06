import { useEffect, useState } from 'react';
import { type Book, type ClubBook, type BookStats, now, uid, message } from '../domain';
import { decimal } from '../collection';
import { getDB } from '../db';
import { saveBook } from '../local';
import { PublicContent } from './Social';
import { RatingStars } from './RatingStars';
import { Modal, Field, useCloud, useTask, ErrorNote, Loading } from './shared';
export function BookStatistics({ bookId }: { bookId: string }) {
  const all = useCloud<BookStats>('club_book_stats');
  const stats = all.data?.find((s) => s.book_id === bookId);
  return (
    <section className="book-statistics">
      <ErrorNote text={all.error?.message} />
      {all.isLoading ? (
        <Loading />
      ) : (
        stats && (
          <>
            {stats.average_rating !== null && Number(stats.rating_count) > 0 ? (
              <div>
                <RatingStars value={Number(stats.average_rating)} label="Средняя оценка" />
                <span>Средняя оценка · оценок: {stats.rating_count}</span>
              </div>
            ) : (
              <p className="muted">Оценок в клубе пока нет.</p>
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
  return (
    <>
      <BookStatistics bookId={bookId} />
      <div className="section-title">
        <h2>Цитаты, которые зацепили</h2>
        <button onClick={() => onTab('quotes')}>Все цитаты</button>
      </div>
      <PublicContent type="quotes" bookId={bookId} sort="likes" limit={3} />
      <div className="section-title">
        <h2>Что осталось после книги</h2>
        <button onClick={() => onTab('reviews')}>Все мысли</button>
      </div>
      <PublicContent type="reviews" bookId={bookId} limit={3} />
    </>
  );
}
export function BookThoughtEditor({ book, onClose }: { book: ClubBook; onClose: () => void }) {
  const [personal, setPersonal] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pages, setPages] = useState(0);
  const [id] = useState(uid);
  const [text, setText] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [spoilers, setSpoilers] = useState(false);
  const [finished, setFinished] = useState(false);
  const [publish, setPublish] = useState(true);
  const { run, busy, error } = useTask();
  useEffect(() => {
    let active = true;
    void (async () => {
      const b = await getDB().personal_books.where('clubBookId').equals(book.id).first();
      const r = b ? await getDB().personal_reviews.get(b.id) : null;
      const p = b ? await getDB().reading_progress.get(b.id) : null;
      if (active) {
        setPersonal(b || null);
        setPages(p?.pages || 0);
        setFinished(b?.status === 'finished');
        if (r) {
          setText(r.text);
          setRating(r.rating);
          setSpoilers(r.spoilers);
        }
        setPublish(b?.publishReview ?? true);
        setLoading(false);
      }
    })().catch((e) => {
      if (active) {
        setLoadError(message(e));
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [book.id]);
  return (
    <Modal title={`Моё впечатление · ${book.title}`} onClose={onClose}>
      {loading ? (
        <Loading />
      ) : loadError ? (
        <ErrorNote text={loadError} />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(async () => {
                if (!text.trim() && rating === null)
                  throw new Error('Напишите впечатление или поставьте оценку');
                const b: Book = personal || {
                  id,
                  clubBookId: book.id,
                  title: book.title,
                  authors: book.authors,
                  description: book.description,
                  genre: book.genre,
                  year: book.year,
                  isbn: book.isbn,
                  cover: book.cover,
                  totalPages: book.default_pages,
                  status: 'planned',
                  notes: '',
                  publishProgress: false,
                  publishReview: false,
                  createdAt: now(),
                  updatedAt: now(),
                };
                await saveBook(
                  {
                    ...b,
                    status: finished ? 'finished' : b.status === 'finished' ? 'reading' : b.status,
                    publishReview: publish,
                    updatedAt: now(),
                  },
                  finished ? b.totalPages : pages,
                  { bookId: b.id, text: text.trim(), rating, spoilers, updatedAt: now() },
                  true,
                );
              }, 'Впечатление сохранено')
            )
              onClose();
          }}
        >
          <Field label="Что осталось после книги?">
            <textarea
              rows={5}
              maxLength={30000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Любимые мысли, с чем спорите, что увидели по-своему…"
            />
          </Field>
          <RatingStars value={rating} onChange={setRating} />
          <label className="check">
            <input
              type="checkbox"
              checked={finished}
              onChange={(e) => setFinished(e.target.checked)}
            />
            Я прочитал(а) эту книгу
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={spoilers}
              onChange={(e) => setSpoilers(e.target.checked)}
            />
            Содержит спойлеры
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
            />
            Поделиться впечатлением и оценкой в клубе
          </label>
          <ErrorNote text={error} />
          <button className="primary" disabled={busy}>
            Сохранить впечатление
          </button>
        </form>
      )}
    </Modal>
  );
}
