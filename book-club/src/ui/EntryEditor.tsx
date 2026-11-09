import { useState } from 'react';
import { type Book, now, uid } from '../domain';
import { type Entry, entryLabels } from '../readerDomain';
import { saveEntry, convertLegacyNote } from '../entries';
import { useDraft, DraftNote } from './useDraft';
import { useReadingDecision, PublicationPermission } from './ReadingParticipation';
import { Modal, Field, ErrorNote, Loading, useTask, useSession } from './shared';
export function EntryEditor({
  book,
  kind,
  entry,
  legacyText,
  onClose,
}: {
  book: Book;
  kind: 'note' | 'thought';
  entry?: Entry;
  legacyText?: string;
  onClose: () => void;
}) {
  const [initial] = useState<Entry>(
    entry || {
      id: uid(),
      bookId: book.id,
      kind,
      text: legacyText || '',
      page: null,
      chapter: '',
      published: false,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
    },
  );
  const draft = useDraft(
    'entry:' +
      (entry?.id || (legacyText !== undefined ? `legacy:${book.id}` : `new:${book.id}:${kind}`)),
    initial,
  );
  const gate = useReadingDecision(book.clubBookId);
  const { identity } = useSession(),
    { run, busy, error } = useTask();
  const value = draft.value;
  return (
    <Modal
      title={
        entry
          ? `Редактировать: ${entryLabels[kind].toLocaleLowerCase('ru')}`
          : kind === 'note'
            ? 'Новая заметка'
            : 'Новая мысль'
      }
      onClose={onClose}
    >
      {!value ? (
        <Loading />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(
                async () => {
                  const next = { ...value, updatedAt: now() };
                  if (legacyText !== undefined) await convertLegacyNote(next, legacyText);
                  else await saveEntry(next);
                  await draft.clear();
                },
                value.published
                  ? 'Запись сохранена, публикация ожидает синхронизации'
                  : 'Запись сохранена для вас',
              )
            )
              onClose();
          }}
        >
          <DraftNote draft={draft} />
          <p className="form-context">{book.title}</p>
          <Field label={kind === 'note' ? 'Текст заметки' : 'Законченная мысль'}>
            <textarea
              autoFocus
              required
              rows={7}
              maxLength={50000}
              value={value.text}
              onChange={(e) => draft.setValue((v) => ({ ...v, text: e.target.value }))}
              placeholder={
                kind === 'note' ? 'Наблюдение по ходу чтения' : 'О чём заставила задуматься книга?'
              }
            />
          </Field>
          <details className="book-extra">
            <summary>Страница и глава — необязательно</summary>
            <div className="form-grid quote-location">
              <Field label="Страница">
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  value={value.page ?? ''}
                  onChange={(e) =>
                    draft.setValue((v) => ({
                      ...v,
                      page: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </Field>
              <Field label="Глава">
                <input
                  maxLength={300}
                  value={value.chapter}
                  onChange={(e) => draft.setValue((v) => ({ ...v, chapter: e.target.value }))}
                />
              </Field>
            </div>
          </details>
          {identity && (
            <label className="check">
              <input
                type="checkbox"
                checked={value.published}
                disabled={!gate.canPublish && !value.published}
                onChange={(e) => draft.setValue((v) => ({ ...v, published: e.target.checked }))}
              />
              Поделиться {kind === 'note' ? 'заметкой' : 'мыслью'} с клубом
            </label>
          )}
          <PublicationPermission bookId={book.clubBookId} />
          <ErrorNote text={error} />
          <footer>
            <button className="primary" disabled={busy || (value.published && !gate.canPublish)}>
              {kind === 'note' ? 'Сохранить заметку' : 'Сохранить мысль'}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
