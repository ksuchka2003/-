import { useEffect, useState } from 'react';
import { getDB } from '../db';
import { type Book, type Review, now } from '../domain';
import { saveBook, changeBookStatus } from '../local';
import { useDraft, DraftNote } from './useDraft';
import { RatingStars } from './RatingStars';
import { useReadingDecision, PublicationPermission } from './ReadingParticipation';
import { Modal, Field, useTask, useSession, ErrorNote, Loading } from './shared';
type ReviewDraft = { text: string; rating: number | null; spoilers: boolean; published: boolean };
export function BookReviewEditor({ book, onClose }: { book: Book; onClose: () => void }) {
  const [initial, setInitial] = useState<ReviewDraft | null>(null),
    [loadError, setLoadError] = useState('');
  const draft = useDraft('review:' + book.id, initial);
  const { identity } = useSession(),
    { run, busy, error } = useTask();
  const gate = useReadingDecision(book.clubBookId);
  const eligible = ['finished', 'abandoned'].includes(book.status);
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
            published: book.publishReview,
          });
      })
      .catch(() => {
        if (active) setLoadError('Не удалось прочитать отзыв');
      });
    return () => {
      active = false;
    };
  }, [book.id]);
  const value = draft.value;
  return (
    <Modal title="Оценка и отзыв" onClose={onClose}>
      {loadError ? (
        <ErrorNote text={loadError} />
      ) : !value || !initial ? (
        <Loading />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(async () => {
                const db = getDB();
                await db.transaction(
                  'rw',
                  [
                    db.personal_books,
                    db.personal_reviews,
                    db.reading_progress,
                    db.sync_queue,
                    db.settings,
                  ],
                  async () => {
                    const current = await db.personal_books.get(book.id);
                    if (!current || current.deletedAt) throw new Error('Книга находится в корзине');
                    const p = await db.reading_progress.get(book.id),
                      r: Review = (await db.personal_reviews.get(book.id)) || {
                        bookId: book.id,
                        rating: null,
                        text: '',
                        spoilers: false,
                        updatedAt: now(),
                      };
                    await saveBook(
                      {
                        ...current,
                        publishReview:
                          ['finished', 'abandoned'].includes(current.status) &&
                          (value.published === initial.published
                            ? current.publishReview
                            : value.published),
                        updatedAt: now(),
                      },
                      p?.pages || 0,
                      {
                        ...r,
                        text: value.text === initial.text ? r.text : value.text,
                        rating: value.rating === initial.rating ? r.rating : value.rating,
                        spoilers: value.spoilers === initial.spoilers ? r.spoilers : value.spoilers,
                        updatedAt: now(),
                      },
                      true,
                    );
                  },
                );
                await draft.clear();
              }, 'Отзыв сохранён')
            )
              onClose();
          }}
        >
          <DraftNote draft={draft} />
          <p className="form-context">{book.title}</p>
          {eligible ? (
            <RatingStars
              value={value.rating}
              onChange={(rating) => draft.setValue((v) => ({ ...v, rating }))}
            />
          ) : (
            <div className="review-status-prompt">
              <p className="section-hint">
                Оценить и опубликовать отзыв можно после прочтения или если книгу бросили. Приватный
                текст можно записать сейчас.
              </p>
              <div className="actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() => changeBookStatus(book.id, 'finished'), 'Книга прочитана')
                  }
                >
                  Дочитал(а)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() => changeBookStatus(book.id, 'abandoned'), 'Отмечено: бросил')
                  }
                >
                  Бросил
                </button>
              </div>
            </div>
          )}
          <Field label="Мой отзыв">
            <textarea
              rows={6}
              maxLength={30000}
              value={value.text}
              onChange={(e) => draft.setValue((v) => ({ ...v, text: e.target.value }))}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={value.spoilers}
              onChange={(e) => draft.setValue((v) => ({ ...v, spoilers: e.target.checked }))}
            />
            Содержит спойлеры
          </label>
          {identity && (
            <label className="check">
              <input
                type="checkbox"
                checked={eligible && value.published}
                disabled={(!eligible || !gate.canPublish) && !value.published}
                onChange={(e) => draft.setValue((v) => ({ ...v, published: e.target.checked }))}
              />
              Поделиться отзывом и оценкой в клубе
            </label>
          )}
          <PublicationPermission bookId={book.clubBookId} />
          <ErrorNote text={error} />
          <footer>
            <button
              className="primary"
              disabled={busy || (eligible && value.published && !gate.canPublish)}
            >
              Сохранить отзыв
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
