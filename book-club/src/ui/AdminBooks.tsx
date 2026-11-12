import { useDraftForm, DraftNote } from './useDraft';
import { PaperSelect } from './PaperSelect';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronRight } from 'lucide-react';
import { currentClubBooks } from '../clubSelectors';
import { clubDay } from '../calendar';
import {
  type ClubBook,
  type Proposal,
  type Reading,
  type Metadata,
  uid,
  clubStatuses,
} from '../domain';
import { action } from '../cloud';
import {
  Field,
  Modal,
  useCloud,
  useTask,
  ErrorNote,
  Empty,
  Cover,
  Loading,
  confirmClose,
  SearchField,
} from './shared';
import { MetadataFields, BookLookup } from './Books';
import type { BookPoll } from './Polls';

function AdminBook({ book, onClose }: { book?: ClubBook; onClose: () => void }) {
  const [id] = useState(book?.id || uid());
  const [value, setValue, draft] = useDraftForm('admin:book:' + (book?.id || 'new'), {
    id,
    metadata: book
      ? { ...book, totalPages: book.default_pages }
      : ({
          title: '',
          authors: '',
          description: '',
          genre: '',
          year: null,
          isbn: '',
          cover: '',
          totalPages: 0,
        } as Metadata),
    status: book?.status || 'planned',
  });
  const v = value.metadata,
    status = value.status;
  const setV = (metadata: Metadata) => setValue((old) => ({ ...old, metadata }));
  const setStatus = (status: typeof value.status) => setValue((old) => ({ ...old, status }));
  const [form, setForm] = useState(!!book);
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  return (
    <Modal title={book ? 'Книга клуба' : 'Добавить в клуб'} onClose={onClose}>
      <DraftNote draft={draft} onLeave={onClose} />
      {!form && !draft.restored ? (
        <>
          <BookLookup
            onSelect={(value) => {
              setV(value);
              setForm(true);
            }}
          />
          <button className="finder-manual" onClick={() => setForm(true)}>
            Добавить вручную
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run(async () => {
                await action('admin.book', { ...v, id: value.id, status });
                await draft.clear();
                await query.invalidateQueries({ queryKey: ['cloud'] });
              }, 'Книга сохранена')
            )
              onClose();
          }}
        >
          {!book && (
            <button
              type="button"
              className="text-button form-return"
              onClick={() => setForm(false)}
            >
              К поиску книги
            </button>
          )}
          <MetadataFields value={v} onChange={setV} compact pagesLabel="Страниц по умолчанию" />
          <PaperSelect
            label="Клубный статус"
            value={status}
            onChange={(value) => setStatus(value as typeof status)}
            options={Object.entries(clubStatuses).map(([value, label]) => ({ value, label }))}
          />
          <details className="book-extra">
            <summary>Подобрать обложку и данные</summary>
            <BookLookup onSelect={setV} />
          </details>
          <ErrorNote text={error} />
          {book && (
            <details className="destructive-menu">
              <summary>Удаление</summary>
              <p className="muted">Чтобы сохранить историю клуба, выберите статус «Архив».</p>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (
                    confirm(
                      'Удалить книгу клуба, публичные отзывы, цитаты, лайки и историю? Для сохранения истории выберите статус «Архив».',
                    ) &&
                    (await run(async () => {
                      await action('admin.delete_book', { id });
                      await query.invalidateQueries({ queryKey: ['cloud'] });
                    }, 'Книга удалена'))
                  )
                    onClose();
                }}
              >
                Удалить из клуба
              </button>
            </details>
          )}
          <footer>
            <button disabled={busy} className="primary">
              Сохранить книгу
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}

function ReviewProposal({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const polls = useCloud<BookPoll>('visible_book_polls');
  const poll = polls.data?.find((p) => p.id === proposal.id);
  const [value, setValue, draft] = useDraftForm('admin:proposal:' + proposal.id, {
    metadata: proposal.metadata,
    reason: '',
    rejecting: false,
  });
  const v = value.metadata,
    reason = value.reason,
    rejecting = value.rejecting;
  const setV = (metadata: Metadata) => setValue((old) => ({ ...old, metadata }));
  const setReason = (reason: string) => setValue((old) => ({ ...old, reason }));
  const setRejecting = (rejecting: boolean) => setValue((old) => ({ ...old, rejecting }));
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const send = async () => {
    if (
      await run(
        async () => {
          await action('admin.proposal', {
            id: proposal.id,
            approve: !rejecting,
            metadata: v,
            reason: rejecting ? reason : '',
          });
          await draft.clear();
          await query.invalidateQueries({ queryKey: ['cloud'] });
        },
        rejecting ? 'Предложение отклонено' : 'Книга добавлена в каталог',
      )
    )
      onClose();
  };
  return (
    <Modal title="Предложение книги" onClose={onClose}>
      <DraftNote draft={draft} onLeave={onClose} />
      <div className="chosen-book">
        <Cover title={v.title} cover={v.cover} small />
        <div>
          <h3>{v.title}</h3>
          <p>{v.authors}</p>
        </div>
      </div>
      {poll && (
        <p className="poll-summary">
          За чтение: {poll.yes_votes} · Позже: {poll.later_votes} · Против: {poll.no_votes}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {!rejecting && (
          <details className="book-extra">
            <summary>Уточнить данные книги</summary>
            <MetadataFields value={v} onChange={setV} compact pagesLabel="Страниц по умолчанию" />
          </details>
        )}
        {rejecting && (
          <Field label="Причина отклонения">
            <textarea
              autoFocus
              required
              maxLength={2000}
              rows={3}
              placeholder="Коротко объясните автору предложения"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        <ErrorNote text={error} />
        <footer>
          <button
            className={rejecting ? 'danger' : 'primary'}
            disabled={busy || (rejecting && !reason.trim())}
          >
            {rejecting ? 'Отклонить предложение' : 'Добавить в каталог'}
          </button>
          <button type="button" disabled={busy} onClick={() => setRejecting(!rejecting)}>
            {rejecting ? 'Вернуться' : 'Отклонить'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ReadingEditor({
  reading,
  book,
  onClose,
}: {
  reading: Reading;
  book: ClubBook;
  onClose: () => void;
}) {
  const [v, setV, draft] = useDraftForm('admin:reading:' + reading.id, reading);
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  return (
    <Modal title="Настройки чтения" onClose={onClose}>
      <DraftNote draft={draft} onLeave={onClose} />
      <p className="form-context">{book.title}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              await action('admin.reading', v);
              await draft.clear();
              await query.invalidateQueries({ queryKey: ['cloud'] });
            })
          )
            onClose();
        }}
      >
        <Field label="Начало чтения">
          <input
            type="date"
            required
            value={v.starts_on || clubDay()}
            onChange={(e) => setV({ ...v, starts_on: e.target.value })}
          />
        </Field>
        <Field label="Плановое окончание">
          <input
            type="date"
            min={v.starts_on}
            value={v.ends_on || ''}
            onChange={(e) => setV({ ...v, ends_on: e.target.value || null })}
          />
        </Field>
        <details className="book-extra">
          <summary>Порядок и завершение чтения</summary>
          <Field label="Место на главной">
            <input
              type="number"
              required
              min={1}
              value={v.position + 1}
              onChange={(e) => setV({ ...v, position: Number(e.target.value) - 1 })}
            />
          </Field>
          <PaperSelect
            label="Состояние чтения"
            value={v.status}
            onChange={(status) => setV({ ...v, status: status as Reading['status'] })}
            options={[
              { value: 'active', label: 'Читаем сейчас' },
              { value: 'finished', label: 'Чтение завершено' },
              { value: 'cancelled', label: 'Отменено' },
            ]}
          />
        </details>
        <ErrorNote text={error} />
        <footer>
          <button disabled={busy} className="primary">
            Сохранить настройки
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function AdminBooks() {
  const books = useCloud<ClubBook>('club_books');
  const readings = useCloud<Reading>('club_readings');
  const [params, setParams] = useSearchParams();
  const readingMode = params.get('view') === 'reading';
  const search = params.get('q') || '';
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };
  const [book, setBook] = useState<ClubBook | true | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const current = new Set(
    currentClubBooks(books.data || [], readings.data || []).map((x) => x.book.id),
  );
  const listed = (books.data || [])
    .filter((b) =>
      `${b.title} ${b.authors}`
        .toLocaleLowerCase('ru')
        .includes(search.trim().toLocaleLowerCase('ru')),
    )
    .sort(
      (a, b) =>
        (readingMode ? Number(current.has(b.id)) - Number(current.has(a.id)) : 0) ||
        a.title.localeCompare(b.title, 'ru'),
    );
  const selectCurrent = async (bookId: string, active: boolean) => {
    setPending((old) => ({ ...old, [bookId]: active }));
    try {
      await run(
        async () => {
          await action('admin.current_book', { book_id: bookId, active });
          await query.invalidateQueries({ queryKey: ['cloud'] });
        },
        active ? 'Книгу читаем сейчас' : 'Книга снята с главной',
      );
    } finally {
      setPending((old) => {
        const next = { ...old };
        delete next[bookId];
        return next;
      });
    }
  };
  return (
    <>
      <div className="section-actions">
        <button className="primary" onClick={() => setBook(true)}>
          <Plus size={18} />
          Добавить книгу
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Раздел книг">
        <button aria-pressed={!readingMode} onClick={() => update('view', '')}>
          Каталог
        </button>
        <button aria-pressed={readingMode} onClick={() => update('view', 'reading')}>
          Читаем сейчас
        </button>
      </div>
      <SearchField
        className="admin-search"
        label="Поиск книг в управлении"
        value={search}
        onChange={(value) => update('q', value)}
      />
      {readingMode && (
        <p className="section-hint">
          Отметьте книги для главной страницы. Можно выбрать несколько.
        </p>
      )}
      <ErrorNote text={error || books.error?.message || readings.error?.message} />
      {books.isLoading || readings.isLoading ? (
        <Loading />
      ) : (
        !books.error &&
        !readings.error && (
          <>
            {!listed.length ? (
              <Empty title={search ? 'Книги не найдены' : 'Каталог пока пуст'}>
                {search ? 'Попробуйте другое название или автора.' : 'Добавьте первую книгу клуба.'}
              </Empty>
            ) : (
              <div className="stack admin-list">
                {listed.map((b) =>
                  readingMode ? (
                    <article className="admin-current-book" key={b.id}>
                      <label className="current-book-choice">
                        <input
                          type="checkbox"
                          aria-label={`Читаем сейчас: ${b.title}`}
                          checked={pending[b.id] ?? current.has(b.id)}
                          disabled={busy}
                          onChange={(e) => void selectCurrent(b.id, e.target.checked)}
                        />
                        <Cover title={b.title} cover={b.cover} small />
                        <span>
                          <b>{b.title}</b>
                          <small>{b.authors}</small>
                          {b.id in pending && <small role="status">Сохраняем…</small>}
                        </span>
                      </label>
                      {current.has(b.id) &&
                        readings.data?.find((r) => r.book_id === b.id && r.status === 'active') && (
                          <button
                            className="text-button"
                            onClick={() =>
                              setReading(
                                readings.data!.find(
                                  (r) => r.book_id === b.id && r.status === 'active',
                                )!,
                              )
                            }
                          >
                            Даты и порядок
                          </button>
                        )}
                    </article>
                  ) : (
                    <button
                      className="admin-book-row management-row"
                      key={b.id}
                      aria-label={`Изменить книгу: ${b.title}`}
                      onClick={() => setBook(b)}
                    >
                      <Cover title={b.title} cover={b.cover} small />
                      <span>
                        <b>{b.title}</b>
                        <small>{b.authors}</small>
                        <small>{clubStatuses[b.status]}</small>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  ),
                )}
              </div>
            )}
            {readingMode && (readings.data || []).some((r) => r.status !== 'active') && (
              <details className="book-extra admin-history">
                <summary>История чтения</summary>
                <div className="stack admin-list">
                  {(readings.data || [])
                    .filter((r) => r.status !== 'active')
                    .sort((a, b) => b.starts_on.localeCompare(a.starts_on))
                    .map((r) => (
                      <button className="management-row" key={r.id} onClick={() => setReading(r)}>
                        <span>
                          <b>{books.data?.find((b) => b.id === r.book_id)?.title}</b>
                          <small>
                            {r.status === 'finished' ? 'Прочитано' : 'Отменено'} ·{' '}
                            {new Date(r.starts_on + 'T12:00:00').toLocaleDateString('ru-RU')}
                          </small>
                        </span>
                        <ChevronRight size={18} />
                      </button>
                    ))}
                </div>
              </details>
            )}
          </>
        )
      )}
      {book && <AdminBook book={book === true ? undefined : book} onClose={() => setBook(null)} />}
      {reading && books.data?.find((b) => b.id === reading.book_id) && (
        <ReadingEditor
          reading={reading}
          book={books.data.find((b) => b.id === reading.book_id)!}
          onClose={() => setReading(null)}
        />
      )}
    </>
  );
}

export function AdminProposals() {
  const proposals = useCloud<Proposal>('book_proposals');
  const [selected, setSelected] = useState<Proposal | null>(null);
  const pending = (proposals.data || []).filter((p) => p.status === 'pending');
  return (
    <>
      <ErrorNote text={proposals.error?.message} />
      {proposals.isLoading ? (
        <Loading label="Загружаем предложения…" />
      ) : (
        !proposals.error &&
        (!pending.length ? (
          <Empty title="Новых предложений нет">
            Предложенные участниками книги появятся здесь.
          </Empty>
        ) : (
          <div className="stack admin-list">
            {pending.map((p) => (
              <button
                className="management-row"
                key={p.id}
                aria-label={`Рассмотреть: ${p.metadata.title}`}
                onClick={() => setSelected(p)}
              >
                <Cover title={p.metadata.title} cover={p.metadata.cover} small />
                <span>
                  <b>{p.metadata.title}</b>
                  <small>{p.metadata.authors}</small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        ))
      )}
      {selected && <ReviewProposal proposal={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
