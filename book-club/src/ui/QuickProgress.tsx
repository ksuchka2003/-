import { useDraft, DraftNote } from './useDraft';
import { useEffect, useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '../db';
import { updateReadingProgress } from '../local';
import { percent } from '../domain';
import { Modal, Field, Loading, ErrorNote, useTask } from './shared';

export function QuickProgress({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const book = useLiveQuery(() => getDB().personal_books.get(bookId), [bookId]);
  const [initial, setInitial] = useState<{ pages: number; total: number; chapter: string } | null>(
    null,
  );
  const [loadError, setLoadError] = useState('');
  const draft = useDraft('progress:' + bookId, initial);
  const values = draft.value,
    setValues = draft.setValue;
  const base = useRef<typeof initial>(null);
  const { run, busy, error } = useTask();
  useEffect(() => {
    let active = true;
    void Promise.all([getDB().personal_books.get(bookId), getDB().reading_progress.get(bookId)])
      .then(([b, p]) => {
        if (active && b) {
          const initial = { pages: p?.pages || 0, total: b.totalPages, chapter: p?.chapter || '' };
          base.current = initial;
          setInitial(initial);
        } else if (active) setLoadError('Книга уже удалена');
      })
      .catch(() => {
        if (active) setLoadError('Не удалось открыть прогресс');
      });
    return () => {
      active = false;
    };
  }, [bookId]);
  const save = async (finished = false) => {
    if (
      values &&
      (await run(
        () =>
          updateReadingProgress(
            bookId,
            values.pages === base.current?.pages ? undefined : values.pages,
            values.chapter === base.current?.chapter ? undefined : values.chapter,
            values.total === base.current?.total ? undefined : values.total,
            finished,
          ),
        finished ? 'Книга прочитана' : 'Прогресс сохранён',
      ))
    ) {
      await draft.clear();
      onClose();
    }
  };
  return (
    <Modal title="Мой прогресс" onClose={onClose}>
      {loadError ? (
        <ErrorNote text={loadError} />
      ) : book?.deletedAt ? (
        <p>Книга находится в корзине.</p>
      ) : !book || !values ? (
        <Loading />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DraftNote draft={draft} onLeave={onClose} />
          <h3 className="progress-book-title">{book.title}</h3>
          <Field label="Прочитано страниц">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={values.total}
              required
              onFocus={(e) => e.currentTarget.select()}
              value={values.pages}
              onChange={(e) => setValues({ ...values, pages: Number(e.target.value) })}
            />
          </Field>
          <Field label="Текущая глава">
            <input
              maxLength={300}
              value={values.chapter}
              placeholder="Необязательно"
              onChange={(e) => setValues({ ...values, chapter: e.target.value })}
            />
          </Field>
          {values.total > 0 && (
            <p className="muted">
              {values.pages} из {values.total} стр. · {percent(values.pages, values.total)}%
            </p>
          )}
          <details className="book-extra" open={book.totalPages === 0}>
            <summary>Страницы моего издания</summary>
            <Field label="Всего страниц">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1000000}
                required
                onFocus={(e) => e.currentTarget.select()}
                value={values.total || ''}
                onChange={(e) => setValues({ ...values, total: Number(e.target.value) })}
              />
            </Field>
          </details>
          <ErrorNote text={error} />
          <footer>
            <button className="primary" disabled={busy}>
              Сохранить прогресс
            </button>
            <button type="button" disabled={busy || !values.total} onClick={() => void save(true)}>
              Дочитал(а)
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
