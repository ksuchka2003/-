import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MoreHorizontal, Quote as QuoteIcon, PenLine, BookOpen } from 'lucide-react';
import { getDB } from '../db';
import { saveBook } from '../local';
import { now, percent, personalStatuses, type Book, type Review } from '../domain';
import { bookCover } from '../covers';
import { DraftNote, useDraft } from './useDraft';
import { RatingStars } from './RatingStars';
import { Modal, Loading, Field, ErrorNote, useTask, useSession } from './shared';
import { Cover } from './shared';
export function PersonalBook({
  book,
  onClose,
  onEdit,
  onProgress,
  onQuote,
  onThought,
}: {
  book: Book;
  onClose: () => void;
  onEdit: () => void;
  onProgress: () => void;
  onQuote: () => void;
  onThought: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [quoteLimit, setQuoteLimit] = useState(3);
  const details = useLiveQuery(
    async () => ({
      progress: await getDB().reading_progress.get(book.id),
      review: await getDB().personal_reviews.get(book.id),
      quotes: (await getDB().quotes.where('bookId').equals(book.id).toArray())
        .filter((q) => !q.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }),
    [book.id],
  );
  return (
    <Modal title="Карточка книги" onClose={onClose}>
      <div className="personal-book-summary">
        <Cover title={book.title} cover={bookCover(book)} />
        <div>
          <span className="badge">{personalStatuses[book.status]}</span>
          <h2>{book.title}</h2>
          <p>{book.authors}</p>
          <button
            type="button"
            className="icon"
            aria-label="Действия с книгой"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={22} />
          </button>
          {menu && (
            <div className="book-options">
              <button onClick={onEdit}>Изменить книгу</button>
            </div>
          )}
        </div>
      </div>
      {!details ? (
        <Loading />
      ) : (
        <>
          {book.totalPages > 0 && (
            <div className="personal-progress">
              <div className="progress">
                <i
                  style={{ width: percent(details.progress?.pages || 0, book.totalPages) + '%' }}
                />
              </div>
              <p>
                {details.progress?.pages || 0} из {book.totalPages} стр. ·{' '}
                {percent(details.progress?.pages || 0, book.totalPages)}%
              </p>
              {details.progress?.chapter && <small>{details.progress.chapter}</small>}
            </div>
          )}
          <div className="personal-book-actions">
            <button className="primary" onClick={onProgress}>
              <BookOpen size={18} /> Обновить прогресс
            </button>
            <button onClick={onQuote}>
              <QuoteIcon size={18} /> Добавить цитату
            </button>
            <button onClick={onThought}>
              <PenLine size={18} /> Записать мысль
            </button>
          </div>
          {details.review?.rating && <RatingStars value={details.review.rating} />}
          {details.review?.text && (
            <section className="personal-reading-text">
              <h3>Мой отзыв</h3>
              <p className="prewrap">{details.review.text}</p>
            </section>
          )}
          {book.notes && (
            <section className="personal-reading-text">
              <h3>Личные заметки</h3>
              <p className="prewrap">{book.notes}</p>
            </section>
          )}
          {details.quotes.length > 0 && (
            <section className="personal-reading-text">
              <h3>Мои цитаты · {details.quotes.length}</h3>
              {details.quotes.slice(0, quoteLimit).map((q) => (
                <article className="personal-quote" key={q.id}>
                  <blockquote>{q.text}</blockquote>
                  {q.sourceAuthor && <small>Сохранено от {q.sourceAuthor}</small>}
                  {q.page !== null && <small>Стр. {q.page}</small>}
                  {q.chapter && <small>{q.chapter}</small>}
                  {q.comment && <p className="prewrap">{q.comment}</p>}
                </article>
              ))}
              {details.quotes.length > quoteLimit && (
                <button onClick={() => setQuoteLimit((n) => n + 10)}>Показать ещё цитаты</button>
              )}
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
type Thought = {
  text: string;
  rating: number | null;
  spoilers: boolean;
  notes: string;
  publish: boolean;
};
export function PersonalThought({ book, onClose }: { book: Book; onClose: () => void }) {
  const [initial, setInitial] = useState<Thought | null>(null),
    [loadError, setLoadError] = useState('');
  const draft = useDraft('personal-thought:' + book.id, initial);
  const { run, error, busy } = useTask(),
    { identity } = useSession();
  useEffect(() => {
    let active = true;
    void getDB()
      .personal_reviews.get(book.id)
      .then((r) => {
        if (active)
          setInitial({
            text: r?.text || '',
            rating: r?.rating ?? null,
            spoilers: r?.spoilers || false,
            notes: book.notes,
            publish: book.publishReview,
          });
      })
      .catch(() => {
        if (active) setLoadError('Не удалось открыть заметки');
      });
    return () => {
      active = false;
    };
  }, [book.id]);
  const set = <K extends keyof Thought>(key: K, value: Thought[K]) =>
    draft.setValue((old) => ({ ...old, [key]: value }));
  return (
    <Modal title="Мои мысли" onClose={onClose}>
      {loadError ? (
        <ErrorNote text={loadError} />
      ) : !draft.value || !initial ? (
        <Loading />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(async () => {
                const db = getDB(),
                  value = draft.value!;
                await db.transaction(
                  'rw',
                  [
                    db.personal_books,
                    db.reading_progress,
                    db.personal_reviews,
                    db.sync_queue,
                    db.settings,
                  ],
                  async () => {
                    const current = await db.personal_books.get(book.id);
                    if (!current || current.deletedAt) throw new Error('Книга находится в корзине');
                    const progress = await db.reading_progress.get(book.id);
                    const review: Review = (await db.personal_reviews.get(book.id)) || {
                      bookId: book.id,
                      text: '',
                      rating: null,
                      spoilers: false,
                      updatedAt: now(),
                    };
                    await saveBook(
                      {
                        ...current,
                        notes: value.notes === initial.notes ? current.notes : value.notes,
                        publishReview:
                          value.publish === initial.publish ? current.publishReview : value.publish,
                        updatedAt: now(),
                      },
                      progress?.pages || 0,
                      {
                        ...review,
                        text: value.text === initial.text ? review.text : value.text,
                        rating: value.rating === initial.rating ? review.rating : value.rating,
                        spoilers:
                          value.spoilers === initial.spoilers ? review.spoilers : value.spoilers,
                        updatedAt: now(),
                      },
                      true,
                    );
                  },
                );
                await draft.clear();
              }, 'Мысли сохранены')
            )
              onClose();
          }}
        >
          <DraftNote draft={draft} />
          <p className="muted">{book.title}</p>
          <Field label="Мой отзыв">
            <textarea
              rows={4}
              maxLength={30000}
              value={draft.value.text}
              onChange={(e) => set('text', e.target.value)}
            />
          </Field>
          <RatingStars value={draft.value.rating} onChange={(v) => set('rating', v)} />
          <label className="check">
            <input
              type="checkbox"
              checked={draft.value.spoilers}
              onChange={(e) => set('spoilers', e.target.checked)}
            />{' '}
            Содержит спойлеры
          </label>
          {identity && book.clubBookId && (
            <label className="check">
              <input
                type="checkbox"
                checked={draft.value.publish}
                onChange={(e) => set('publish', e.target.checked)}
              />{' '}
              Поделиться отзывом и оценкой в клубе
            </label>
          )}
          <Field label="Приватные заметки">
            <textarea
              rows={4}
              maxLength={50000}
              value={draft.value.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
          <ErrorNote text={error} />
          <button className="primary" disabled={busy}>
            Сохранить мысли
          </button>
        </form>
      )}
    </Modal>
  );
}
