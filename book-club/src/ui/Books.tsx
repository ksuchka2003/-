import { useEffect, useState, useRef, type SetStateAction } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, SlidersHorizontal, Trash2, ChevronDown, RotateCcw } from 'lucide-react';
import { getDB } from '../db';
import { personalCounts } from '../collection';
import { clubDay } from '../calendar';
import { BookFinder } from './BookFinder';
import { PersonalBook, PersonalThought } from './PersonalBook';
import { QuoteEditor } from './Quotes';
import { saveBook, deleteBook, changeBookStatus, trashBook, restoreBook } from '../local';
import { DraftNote, useDraft } from './useDraft';
import { QuickProgress } from './QuickProgress';
import { bookCover } from '../covers';
import { CoverPicker, InternetCover } from './CoverPicker';
import { RatingStars } from './RatingStars';
import { ReadingStatus } from './ReadingStatus';
import {
  now,
  uid,
  personalStatuses,
  percent,
  type Book,
  type Metadata,
  type Review,
  type ClubBook,
} from '../domain';
import { searchBooks } from '../bookSearch';
import {
  Modal,
  Field,
  Empty,
  Cover,
  useTask,
  ErrorNote,
  Loading,
  useSession,
  useCloud,
} from './shared';
const blank = (): Metadata => ({
  title: '',
  authors: '',
  description: '',
  genre: '',
  year: null,
  isbn: '',
  cover: '',
  totalPages: 0,
});
export function MetadataFields({
  value,
  onChange,
  compact = false,
}: {
  value: Metadata;
  onChange: (b: Metadata) => void;
  compact?: boolean;
}) {
  const set = (key: keyof Metadata, v: unknown) => onChange({ ...value, [key]: v });
  const extra = (
    <>
      <div className="form-grid">
        {!compact && (
          <Field label="Страниц в моём издании">
            <input
              type="number"
              min={0}
              max={1000000}
              value={value.totalPages || ''}
              placeholder="Можно не указывать"
              onChange={(e) => set('totalPages', Number(e.target.value))}
            />
          </Field>
        )}
        <Field label="Жанр">
          <input
            maxLength={150}
            value={value.genre}
            onChange={(e) => set('genre', e.target.value)}
          />
        </Field>
        <Field label="Год">
          <input
            type="number"
            min={0}
            max={3000}
            value={value.year ?? ''}
            onChange={(e) => set('year', e.target.value ? Number(e.target.value) : null)}
          />
        </Field>
      </div>
      {!compact && (
        <div className="edition-cover">
          <Cover title={value.title || 'Книга'} cover={value.cover} small />
          <details>
            <summary>Обложки из интернета</summary>
            <InternetCover
              title={value.title}
              authors={value.authors}
              onSelect={(url) => set('cover', url)}
            />
          </details>
        </div>
      )}
      <Field label="Описание">
        <textarea
          rows={3}
          maxLength={10000}
          value={value.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
    </>
  );
  return (
    <>
      <Field label="Название">
        <input
          required
          maxLength={300}
          value={value.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </Field>
      <Field label="Автор">
        <input
          maxLength={500}
          value={value.authors}
          onChange={(e) => set('authors', e.target.value)}
        />
      </Field>
      {compact ? (
        <details className="book-extra">
          <summary>Данные издания — необязательно</summary>
          {extra}
        </details>
      ) : (
        extra
      )}
    </>
  );
}
export function BookLookup({ onSelect }: { onSelect: (b: Metadata) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Metadata[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setSearched(false);
    setResults([]);
    setBusy(false);
    if (q.trim().length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const timeout = setTimeout(() => {
      setBusy(true);
      searchBooks(q, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setResults(data);
            setSearched(true);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted && e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 650);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [q, retry]);
  return (
    <section className="lookup">
      <Field label="Поиск книги в интернете">
        <input
          value={q}
          placeholder="Название или автор"
          maxLength={200}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setRetry((n) => n + 1);
            }
          }}
          onChange={(e) => setQ(e.target.value)}
        />
      </Field>
      <button
        className="lookup-search"
        type="button"
        disabled={busy || q.trim().length < 2}
        onClick={() => setRetry((n) => n + 1)}
      >
        <Search size={16} />
        Найти
      </button>
      <ErrorNote text={error} />
      {busy && <p className="muted">Ищем книги…</p>}
      {searched && !busy && !results.length && (
        <p className="hint" role="status">
          Книга не найдена. Попробуйте другое название или автора. Можно добавить книгу вручную
          ниже.
        </p>
      )}
      <div className="lookup-results">
        {results.map((b, i) => (
          <button
            type="button"
            key={`${b.isbn}-${i}`}
            onClick={() => {
              onSelect(b);
              setResults([]);
              setQ('');
            }}
          >
            <Cover title={b.title} cover={b.cover} small />
            <span>
              <b>{b.title}</b>
              <small>
                {b.authors} · {b.year || 'Год не указан'} · {b.totalPages || '?'} стр.
              </small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
export function BookEditor({
  book,
  onClose,
  onExisting,
}: {
  book?: Book;
  onClose: () => void;
  onExisting?: (b: Book) => void;
}) {
  type BookDraft = {
    book: Book;
    pages: number;
    chapter: string;
    startedOn: string;
    finishedOn: string;
    review: Review;
    manual?: boolean;
  };
  const [initial, setInitial] = useState<BookDraft | null>(() => {
    if (book) return null;
    const b: Book = {
      ...blank(),
      id: uid(),
      clubBookId: null,
      status: 'planned',
      notes: '',
      publishProgress: false,
      publishReview: false,
      createdAt: now(),
      updatedAt: now(),
    };
    return {
      book: b,
      pages: 0,
      chapter: '',
      startedOn: '',
      finishedOn: '',
      review: { bookId: b.id, rating: null, text: '', spoilers: false, updatedAt: now() },
    };
  });
  const draft = useDraft('book:' + (book?.id || 'new'), initial);
  const { busy, error, run } = useTask();
  const { identity } = useSession();
  const club = useCloud<ClubBook>('club_books');
  const [coverBusy, setCoverBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [manual, setManual] = useState(false);
  useEffect(() => {
    let active = true;
    if (book)
      void Promise.all([
        getDB().reading_progress.get(book.id),
        getDB().personal_reviews.get(book.id),
      ])
        .then(([p, r]) => {
          if (active)
            setInitial({
              book,
              pages: p?.pages || 0,
              chapter: p?.chapter || '',
              startedOn: p?.startedOn || '',
              finishedOn: p?.finishedOn || '',
              review: r || {
                bookId: book.id,
                rating: null,
                text: '',
                spoilers: false,
                updatedAt: now(),
              },
            });
        })
        .catch(() => {
          if (active)
            setLoadError('Не удалось прочитать книгу. Закройте форму и попробуйте ещё раз.');
        });
    return () => {
      active = false;
    };
  }, [book]);
  if (!draft.value || loadError)
    return (
      <Modal title={book ? 'Моя книга' : 'Добавить книгу'} onClose={onClose}>
        {loadError ? <ErrorNote text={loadError} /> : <Loading />}
      </Modal>
    );
  const { book: value, pages, chapter, startedOn, finishedOn, review } = draft.value;
  const setValue = (next: SetStateAction<Book>) =>
    draft.setValue((old) => ({ ...old, book: typeof next === 'function' ? next(old.book) : next }));
  const setPages = (pages: number) => draft.setValue((old) => ({ ...old, pages }));
  const setChapter = (chapter: string) => draft.setValue((old) => ({ ...old, chapter }));
  const setStartedOn = (startedOn: string) => draft.setValue((old) => ({ ...old, startedOn }));
  const setFinishedOn = (finishedOn: string) => draft.setValue((old) => ({ ...old, finishedOn }));
  const setReview = (review: Review) => draft.setValue((old) => ({ ...old, review }));
  const editingMetadata = manual || !!draft.value.manual;
  const chooseAnotherBook = () => {
    if (
      (value.notes || review.text || pages > 0) &&
      !confirm('Выбрать другую книгу? Несохранённые заметки и прогресс этой книги будут сброшены.')
    )
      return;
    setManual(false);
    draft.setValue(initial!);
  };
  if (!book && !editingMetadata && !value.title.trim())
    return (
      <Modal title="Добавить книгу" onClose={onClose}>
        <BookFinder
          catalog={club.data || []}
          onExisting={(b) => onExisting?.(b)}
          onManual={(title) => {
            setManual(true);
            draft.setValue((old) => ({ ...old, manual: true, book: { ...old.book, title } }));
          }}
          onSelect={(metadata, clubId) => setValue({ ...value, ...metadata, clubBookId: clubId })}
        />
      </Modal>
    );
  return (
    <Modal title={book ? 'Моя книга' : 'Добавить книгу'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(
              () =>
                saveBook(
                  { ...value, updatedAt: now() },
                  pages,
                  { ...review, updatedAt: now() },
                  true,
                  {
                    chapter,
                    startedOn: startedOn || undefined,
                    finishedOn: finishedOn || undefined,
                  },
                ),
              'Книга сохранена',
            )
          ) {
            await draft.clear();
            onClose();
          }
        }}
      >
        <DraftNote draft={draft} />
        {!book && editingMetadata && (
          <button type="button" className="text-button" onClick={chooseAnotherBook}>
            К поиску книги
          </button>
        )}
        {!book && !editingMetadata && (
          <div className="chosen-book">
            <Cover title={value.title} cover={bookCover(value)} small />
            <div>
              <h3>{value.title}</h3>
              <p>{value.authors}</p>
              <small>{value.totalPages > 0 ? value.totalPages + ' стр.' : ''}</small>
              <button type="button" onClick={chooseAnotherBook}>
                Выбрать другую
              </button>
            </div>
          </div>
        )}
        <details
          className={
            book || editingMetadata ? 'metadata-editor metadata-always' : 'metadata-editor'
          }
          open={!!book || editingMetadata}
          onToggle={(e) => {
            if (e.currentTarget.open && !book)
              draft.setValue((old) => (old.manual ? old : { ...old, manual: true }));
          }}
        >
          <summary>Изменить данные книги</summary>
          <CoverPicker
            title={value.title}
            authors={value.authors}
            cover={bookCover(value, club.data?.find((b) => b.id === value.clubBookId)?.cover)}
            hasCustom={
              !!value.coverData ||
              !!(
                value.clubBookId &&
                value.cover &&
                value.cover !== club.data?.find((b) => b.id === value.clubBookId)?.cover
              )
            }
            shared={!!value.clubBookId}
            onBusy={setCoverBusy}
            onChange={(data) => setValue((old) => ({ ...old, coverData: data }))}
            onUrl={(cover) => setValue(({ coverData, ...old }) => ({ ...old, cover }))}
            onReset={() =>
              setValue((old) => {
                const { coverData, ...rest } = old;
                return {
                  ...rest,
                  cover: club.data?.find((b) => b.id === old.clubBookId)?.cover || old.cover,
                };
              })
            }
          />
          <MetadataFields compact value={value} onChange={(b) => setValue({ ...value, ...b })} />
        </details>
        <details className="book-extra" open={!!book}>
          <summary>Моё чтение</summary>
          <div className="form-grid">
            <Field label="Страниц в моём издании">
              <input
                type="number"
                min={0}
                max={1000000}
                value={value.totalPages || ''}
                placeholder="Можно не указывать"
                onChange={(e) => setValue({ ...value, totalPages: Number(e.target.value) })}
              />
            </Field>
            <Field label="Прочитано страниц">
              <input
                type="number"
                min={0}
                max={value.totalPages}
                value={pages || ''}
                placeholder="0"
                onChange={(e) => setPages(Number(e.target.value))}
              />
            </Field>
          </div>
          <ReadingStatus
            value={value.status}
            onChange={(status) => {
              if (status !== 'all' && status !== 'unfinished') setValue({ ...value, status });
            }}
          />
          <Field label="Текущая глава">
            <input
              maxLength={300}
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              placeholder="Например, глава 7"
            />
          </Field>
          <details className="book-extra">
            <summary>Когда читал(а) — необязательно</summary>
            <div className="form-grid">
              <Field label="Начал(а) читать">
                <input
                  type="date"
                  max={clubDay()}
                  value={startedOn}
                  onChange={(e) => setStartedOn(e.target.value)}
                />
              </Field>
              <Field label="Закончил(а) читать">
                <input
                  type="date"
                  min={startedOn || undefined}
                  max={clubDay()}
                  value={finishedOn}
                  onChange={(e) => setFinishedOn(e.target.value)}
                />
              </Field>
            </div>
            {value.clubBookId && (
              <p className="muted">Эти даты используются в статистике чтения клуба.</p>
            )}
          </details>
          {identity && value.clubBookId && (
            <p className="muted">Прогресс этой книги виден участникам клуба.</p>
          )}
        </details>
        <details className="book-extra">
          <summary>Отзыв, оценка и заметки</summary>
          <RatingStars
            value={review.rating}
            onChange={(rating) => setReview({ ...review, rating })}
          />
          <Field label="Мой отзыв">
            <textarea
              rows={3}
              maxLength={30000}
              value={review.text}
              onChange={(e) => setReview({ ...review, text: e.target.value })}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={review.spoilers}
              onChange={(e) => setReview({ ...review, spoilers: e.target.checked })}
            />
            Содержит спойлеры
          </label>
          {identity && value.clubBookId && (
            <label className="check">
              <input
                type="checkbox"
                checked={value.publishReview}
                onChange={(e) => setValue({ ...value, publishReview: e.target.checked })}
              />
              Поделиться отзывом и оценкой в клубе
            </label>
          )}
          <Field label="Приватные заметки">
            <textarea
              rows={3}
              maxLength={50000}
              value={value.notes}
              onChange={(e) => setValue({ ...value, notes: e.target.value })}
            />
          </Field>
        </details>
        <ErrorNote text={error} />
        <footer>
          <button disabled={busy || coverBusy} className="primary">
            {busy ? 'Сохраняем…' : 'Сохранить книгу'}
          </button>
          {book && (
            <button
              className="danger"
              type="button"
              disabled={busy}
              onClick={async () => {
                if (
                  confirm(
                    'Переместить книгу в корзину? Заметки, отзыв, прогресс и цитаты сохранятся. Публикации будут сняты после синхронизации.',
                  )
                )
                  if (await run(() => trashBook(book.id), 'Книга в корзине')) {
                    await draft.clear();
                    onClose();
                  }
              }}
            >
              <Trash2 size={16} />В корзину
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
function QuickReadingStatus({ book, onClose }: { book: Book; onClose: () => void }) {
  const { run, busy, error } = useTask();
  return (
    <Modal title="Статус чтения" onClose={onClose}>
      <h3>{book.title}</h3>
      <fieldset disabled={busy} className="status-fieldset">
        <ReadingStatus
          value={book.status}
          onChange={(status) => {
            if (status !== 'all' && status !== 'unfinished')
              void run(() => changeBookStatus(book.id, status), 'Статус сохранён').then((ok) => {
                if (ok) onClose();
              });
          }}
        />
      </fieldset>
      <ErrorNote text={error} />
    </Modal>
  );
}
export function MyBooks() {
  const catalog = useCloud<ClubBook>('club_books');
  const allBooks = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const books = allBooks.filter((b) => !b.deletedAt);
  const trashed = allBooks.filter((b) => !!b.deletedAt);
  const [params, setParams] = useSearchParams();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const trash = params.get('view') === 'trash';
  const linked = books.find((b) => b.id === params.get('book'));
  const progressOpen = linked && params.get('action') === 'progress';
  const editorOpen = linked && params.get('action') === 'edit';
  const quoteOpen = linked && params.get('action') === 'quote';
  const thoughtOpen = linked && params.get('action') === 'thought';
  const closeAction = () => {
    const next = new URLSearchParams(params);
    next.delete('action');
    setParams(next, { replace: true });
  };
  const { run, error, busy } = useTask();
  const openBook = (book: Book, action = '') => {
    const next = new URLSearchParams(params);
    next.set('book', book.id);
    if (action) next.set('action', action);
    else next.delete('action');
    setParams(next);
  };
  const closeBook = () => {
    setEdit(null);
    const next = new URLSearchParams(params);
    next.delete('book');
    next.delete('action');
    if (mounted.current && params.has('book')) setParams(next, { replace: true });
  };
  const progress = useLiveQuery(() => getDB().reading_progress.toArray()) || [];
  const q = params.get('q') || '';
  const status = ['all', 'reading', 'finished', 'unfinished', 'planned', 'paused'].includes(
    params.get('status') || '',
  )
    ? params.get('status')!
    : 'all';
  const sort = params.get('sort') === 'title' ? 'title' : 'updated';
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || (key === 'status' && value === 'all') || (key === 'sort' && value === 'updated'))
      next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const [filters, setFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState(status);
  const [filterSort, setFilterSort] = useState(sort);
  const counts = personalCounts(books);
  const [edit, setEdit] = useState<Book | true | null>(null);
  const [quick, setQuick] = useState<Book | null>(null);
  const filtered = books
    .filter(
      (b) =>
        (status === 'all' ||
          (status === 'unfinished' ? b.status !== 'finished' : b.status === status)) &&
        `${b.title} ${b.authors}`.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'ru')
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{trash ? 'Корзина книг' : 'Мои книги'}</h1>
        </div>
        {(trashed.length > 0 || trash) && (
          <button onClick={() => setParams(trash ? {} : { view: 'trash' })}>
            {trash ? (
              'К библиотеке'
            ) : (
              <>
                <Trash2 size={17} /> Корзина · {trashed.length}
              </>
            )}
          </button>
        )}
        {!trash && (
          <button className="primary" onClick={() => setEdit(true)}>
            <Plus size={18} /> Добавить
          </button>
        )}
      </div>
      {trash ? (
        <>
          <ErrorNote text={error} />
          {!trashed.length ? (
            <Empty title="Корзина книг пуста" />
          ) : (
            <div className="book-list">
              {trashed.map((b) => (
                <article className="book-card" key={b.id}>
                  <Cover title={b.title} cover={bookCover(b)} />
                  <div>
                    <h3>{b.title}</h3>
                    <p>{b.authors}</p>
                    <small>Прогресс, заметки, отзыв и цитаты сохранены.</small>
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => restoreBook(b.id),
                            'Книга восстановлена. Публикации выключены.',
                          )
                        }
                      >
                        <RotateCcw size={16} /> Восстановить книгу
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              'Удалить книгу, заметки, отзыв, прогресс и все её цитаты навсегда? Восстановление будет невозможно.',
                            )
                          )
                            void run(() => deleteBook(b.id), 'Книга удалена навсегда');
                        }}
                      >
                        Удалить навсегда
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {books.length > 0 && (
            <div className="shelf-tabs" role="group" aria-label="Книги на полке">
              {(
                [
                  ['all', 'Все', counts.total],
                  ['reading', 'Читаю', counts.reading],
                  ['finished', 'Прочитано', counts.finished],
                  ['unfinished', 'Не прочитано', counts.unfinished],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  type="button"
                  key={key}
                  className={status === key ? 'active' : ''}
                  aria-pressed={status === key}
                  onClick={() => updateFilter('status', key)}
                >
                  {label} <b>{count}</b>
                </button>
              ))}
            </div>
          )}
          {books.length > 0 && (
            <div className="toolbar books-toolbar">
              <label className="search">
                <Search size={18} />
                <input
                  aria-label="Поиск моих книг"
                  placeholder="Название или автор"
                  value={q}
                  onChange={(e) => updateFilter('q', e.target.value)}
                />
              </label>
              <button
                type="button"
                aria-label="Фильтры книг"
                className={
                  sort !== 'updated' || ['planned', 'paused'].includes(status) ? 'selected' : ''
                }
                onClick={() => {
                  setFilterStatus(status);
                  setFilterSort(sort);
                  setFilters(true);
                }}
              >
                <SlidersHorizontal size={18} /> <span>Фильтры</span>
              </button>
            </div>
          )}
          {['planned', 'paused'].includes(status) && (
            <p className="active-shelf-filter">
              {personalStatuses[status as Book['status']]}{' '}
              <button type="button" onClick={() => updateFilter('status', 'all')}>
                Сбросить
              </button>
            </p>
          )}
          {!filtered.length ? (
            <Empty title={q || books.length ? 'Книги не найдены' : 'Пока нет книг'}>
              {books.length > 0 && (
                <button
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete('q');
                    next.delete('status');
                    next.delete('sort');
                    setParams(next, { replace: true });
                  }}
                >
                  Сбросить поиск и фильтры
                </button>
              )}
            </Empty>
          ) : (
            <div className="book-list">
              {filtered.map((b) => {
                const p = progress.find((x) => x.bookId === b.id)?.pages || 0;
                return (
                  <article className="book-card personal-book-card" key={b.id}>
                    <button
                      className="cover-open"
                      aria-label={`Открыть книгу: ${b.title}`}
                      onClick={() => openBook(b)}
                    >
                      <Cover
                        cover={bookCover(
                          b,
                          catalog.data?.find((c) => c.id === b.clubBookId)?.cover,
                        )}
                        title={b.title}
                      />
                    </button>
                    <div>
                      <button
                        className={`badge quick-status ${b.status}`}
                        aria-label={`Изменить статус: ${b.title}`}
                        onClick={() => setQuick(b)}
                      >
                        {personalStatuses[b.status]}
                        <ChevronDown size={14} />
                      </button>
                      <button className="personal-book-open" onClick={() => openBook(b)}>
                        <h3>{b.title}</h3>
                        <p>{b.authors || 'Автор не указан'}</p>
                      </button>
                      <button
                        className="progress-open"
                        aria-label={`Обновить прогресс: ${b.title}`}
                        onClick={() => openBook(b, 'progress')}
                      >
                        {b.totalPages > 0 && (
                          <div className="progress">
                            <i style={{ width: `${percent(p, b.totalPages)}%` }} />
                          </div>
                        )}
                        <small>
                          {b.totalPages > 0 ? (
                            <>
                              {p} из {b.totalPages} стр. <b>{percent(p, b.totalPages)}%</b>
                            </>
                          ) : (
                            'Количество страниц не указано'
                          )}
                        </small>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {(edit || editorOpen) && (
        <BookEditor
          key={linked?.id || 'new'}
          book={editorOpen ? linked : edit === true ? undefined : edit || undefined}
          onExisting={(b) => {
            setEdit(null);
            if (b.deletedAt) setParams({ view: 'trash' });
            else openBook(b);
          }}
          onClose={closeBook}
        />
      )}
      {progressOpen && <QuickProgress bookId={linked.id} onClose={closeBook} />}
      {linked && !progressOpen && !editorOpen && !quoteOpen && !thoughtOpen && !edit && (
        <PersonalBook
          book={linked}
          onClose={closeBook}
          onEdit={() => openBook(linked, 'edit')}
          onProgress={() => openBook(linked, 'progress')}
          onQuote={() => openBook(linked, 'quote')}
          onThought={() => openBook(linked, 'thought')}
        />
      )}
      {quoteOpen && <QuoteEditor key={linked.id} book={linked} onClose={closeAction} />}
      {thoughtOpen && <PersonalThought book={linked} onClose={closeAction} />}
      {filters && (
        <Modal title="Фильтры книг" onClose={() => setFilters(false)}>
          <ReadingStatus filter value={filterStatus} onChange={setFilterStatus} />
          <Field label="Сортировка">
            <select value={filterSort} onChange={(e) => setFilterSort(e.target.value)}>
              <option value="updated">По обновлению</option>
              <option value="title">По названию</option>
            </select>
          </Field>
          <footer>
            <button
              className="primary"
              onClick={() => {
                const next = new URLSearchParams(params);
                if (filterStatus === 'all') next.delete('status');
                else next.set('status', filterStatus);
                if (filterSort === 'updated') next.delete('sort');
                else next.set('sort', filterSort);
                setParams(next, { replace: true });
                setFilters(false);
              }}
            >
              Показать книги
            </button>
            <button
              onClick={() => {
                setFilterStatus('all');
                setFilterSort('updated');
              }}
            >
              Сбросить
            </button>
          </footer>
        </Modal>
      )}
      {quick && <QuickReadingStatus book={quick} onClose={() => setQuick(null)} />}
    </>
  );
}
