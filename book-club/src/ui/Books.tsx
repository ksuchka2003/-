import { clubDay } from '../calendar';
import { PaperFragment, PaperTape, ReaderIllustration } from './EditorialArt';
import { CreativeInsert } from './CreativeInsert';
import { saveBookEdition } from '../readerLocal';
import { useEffect, useState, useRef, type SetStateAction } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, SlidersHorizontal, Trash2, ChevronDown, RotateCcw } from 'lucide-react';
import { getDB } from '../db';
import { personalCounts } from '../collection';
import { BookFinder } from './BookFinder';
import { PersonalBook, PersonalThought } from './PersonalBook';
import { QuoteEditor } from './Quotes';
import { saveBook, deleteBook, changeBookStatus, trashBook, restoreBook } from '../local';
import { DraftNote, useDraft } from './useDraft';
import { QuickProgress } from './QuickProgress';
import { bookCover } from '../covers';
import { CoverPicker, InternetCover } from './CoverPicker';
import { RatingStars } from './RatingStars';
import { similarClubBooks } from '../bookMatches';
import { ShelfManager, ShelfPicker, useShelves } from './Shelves';
import { ReadingStatus } from './ReadingStatus';
import {
  now,
  uid,
  personalStatuses,
  percent,
  type Book,
  type Metadata,
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
  useCloud,
  SearchField,
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
  pagesLabel,
}: {
  value: Metadata;
  onChange: (b: Metadata) => void;
  compact?: boolean;
  pagesLabel?: string;
}) {
  const set = (key: keyof Metadata, v: unknown) => onChange({ ...value, [key]: v });
  const extra = (
    <>
      <div className="form-grid">
        {(!compact || pagesLabel) && (
          <Field label={pagesLabel || 'Страниц в моём издании'}>
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
  setup = false,
}: {
  book?: Book;
  onClose: () => void;
  onExisting?: (b: Book) => void;
  setup?: boolean;
}) {
  type Draft = {
    book: Book;
    pages: number;
    chapter: string;
    startedOn?: string;
    finishedOn?: string;
    manual?: boolean;
  };
  const [initial, setInitial] = useState<Draft | null>(() =>
    book
      ? null
      : {
          book: {
            ...blank(),
            id: uid(),
            clubBookId: null,
            status: 'planned',
            notes: '',
            publishProgress: false,
            publishReview: false,
            createdAt: now(),
            updatedAt: now(),
          },
          pages: 0,
          chapter: '',
        },
  );
  const draft = useDraft('book:' + (book?.id || 'new'), initial);
  const { run, busy, error } = useTask(),
    club = useCloud<ClubBook>('club_books');
  const [loadError, setLoadError] = useState(''),
    [coverBusy, setCoverBusy] = useState(false),
    [duplicate, setDuplicate] = useState(false);
  useEffect(() => {
    let active = true;
    if (book)
      void getDB()
        .reading_progress.get(book.id)
        .then((p) => {
          if (active)
            setInitial({
              book,
              pages: p?.pages || 0,
              chapter: p?.chapter || '',
              startedOn: p?.startedOn || '',
              finishedOn: p?.finishedOn || '',
            });
        })
        .catch(() => {
          if (active) setLoadError('Не удалось открыть книгу');
        });
    return () => {
      active = false;
    };
  }, [book?.id]);
  if (!draft.value || !initial || loadError)
    return (
      <Modal title="Моя книга" onClose={onClose}>
        {loadError ? <ErrorNote text={loadError} /> : <Loading />}
      </Modal>
    );
  const value = draft.value.book,
    pages = draft.value.pages;
  const setValue = (next: SetStateAction<Book>) =>
    draft.setValue((old) => ({ ...old, book: typeof next === 'function' ? next(old.book) : next }));
  const similar = !value.clubBookId ? similarClubBooks(value.title, club.data || []) : [];
  const save = async (clubId?: string | null) => {
    let reused = false;
    if (
      (await run(async () => {
        const chosenId = clubId === undefined ? value.clubBookId : clubId;
        if (chosenId) {
          const own = await getDB().personal_books.where('clubBookId').equals(chosenId).first();
          if (own && own.id !== value.id) {
            reused = true;
            await draft.clear();
            onExisting?.(own);
            return;
          }
        }
        await saveBookEdition(initial, draft.value!, !!book, chosenId);
        await draft.clear();
      }, 'Книга сохранена')) &&
      !reused
    )
      onClose();
  };
  if (duplicate)
    return (
      <Modal title="Похожая книга есть в клубе" onClose={() => setDuplicate(false)}>
        <p className="section-hint">
          Связать с клубом? Ваша обложка, страницы и заполненные данные останутся вашими.
        </p>
        <div className="lookup-results">
          {similar.map((b) => (
            <button key={b.id} onClick={() => void save(b.id)} disabled={busy}>
              <Cover small title={b.title} cover={b.cover} />
              <span>
                <b>{b.title}</b>
                <small>{b.authors}</small>
                <small>Читать клубную книгу</small>
              </span>
            </button>
          ))}
        </div>
        <p className="notice">
          У отдельной книги не будет связи с каталогом: её прогресс, записи и оценка не появятся в
          карточке этой книги клуба.
        </p>
        <button disabled={busy} onClick={() => void save(null)}>
          Создать отдельную книгу
        </button>
        <ErrorNote text={error} />
      </Modal>
    );
  if (!book && !value.title.trim() && !draft.value.manual)
    return (
      <Modal title="Добавить книгу" onClose={onClose}>
        <BookFinder
          catalog={club.data || []}
          onExisting={(b) => onExisting?.(b)}
          onManual={(title) =>
            draft.setValue((old) => ({ ...old, manual: true, book: { ...old.book, title } }))
          }
          onSelect={(metadata, clubId) => setValue({ ...value, ...metadata, clubBookId: clubId })}
        />
        <ErrorNote text={club.error?.message} />
      </Modal>
    );
  return (
    <Modal
      title={setup ? 'Настроить моё издание' : book ? 'Издание и обложка' : 'Добавить книгу'}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (similar.length) setDuplicate(true);
          else void save();
        }}
      >
        <DraftNote draft={draft} />
        <CoverPicker
          title={value.title}
          authors={value.authors}
          cover={bookCover(value, club.data?.find((b) => b.id === value.clubBookId)?.cover)}
          hasCustom={!!value.coverData || !!value.cover}
          shared={!!value.clubBookId}
          onBusy={setCoverBusy}
          onChange={(coverData) => setValue((old) => ({ ...old, coverData }))}
          onUrl={(cover) => setValue(({ coverData, ...old }) => ({ ...old, cover }))}
          onReset={() =>
            setValue(({ coverData, ...old }) => ({
              ...old,
              cover: club.data?.find((b) => b.id === old.clubBookId)?.cover || '',
            }))
          }
        />
        <Field label="Страниц в моём издании">
          <input
            type="number"
            min={0}
            max={1000000}
            value={value.totalPages || ''}
            placeholder="Можно указать позже"
            onChange={(e) => setValue({ ...value, totalPages: Number(e.target.value) })}
          />
        </Field>
        <MetadataFields compact value={value} onChange={(v) => setValue({ ...value, ...v })} />
        {!!similar.length && (
          <aside className="similar-books">
            <p>Есть похожие книги в клубе</p>
            {similar.slice(0, 3).map((b) => (
              <button type="button" key={b.id} onClick={() => setDuplicate(true)}>
                <Cover small title={b.title} cover={b.cover} />
                <span>
                  {b.title}
                  <small>{b.authors}</small>
                </span>
              </button>
            ))}
          </aside>
        )}
        <details className="book-extra">
          <summary>Моё чтение</summary>
          <ReadingStatus
            value={value.status}
            onChange={(status) => {
              if (status !== 'all' && status !== 'unfinished') setValue({ ...value, status });
            }}
          />
          <Field label="Прочитано страниц">
            <input
              type="number"
              min={0}
              max={value.totalPages || 0}
              value={pages || ''}
              onChange={(e) => draft.setValue((old) => ({ ...old, pages: Number(e.target.value) }))}
            />
          </Field>
          <Field label="Текущая глава">
            <input
              maxLength={300}
              value={draft.value.chapter}
              onChange={(e) => draft.setValue((old) => ({ ...old, chapter: e.target.value }))}
            />
          </Field>
          <details className="book-extra">
            <summary>Когда читал(а) — необязательно</summary>
            <div className="form-grid">
              <Field label="Начал(а) читать">
                <input
                  type="date"
                  max={clubDay()}
                  value={draft.value.startedOn || ''}
                  onChange={(e) => draft.setValue((old) => ({ ...old, startedOn: e.target.value }))}
                />
              </Field>
              <Field label="Закончил(а) читать">
                <input
                  type="date"
                  min={draft.value.startedOn || undefined}
                  max={clubDay()}
                  value={draft.value.finishedOn || ''}
                  onChange={(e) =>
                    draft.setValue((old) => ({ ...old, finishedOn: e.target.value }))
                  }
                />
              </Field>
            </div>
          </details>
        </details>
        <ErrorNote text={error} />
        <footer>
          <button className="primary" disabled={busy || coverBusy}>
            Сохранить книгу
          </button>
          {book && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    'Переместить книгу в корзину? Записи сохранятся, публикации будут сняты после синхронизации.',
                  )
                )
                  void run(() => trashBook(book.id), 'Книга в корзине').then(async (ok) => {
                    if (ok) {
                      await draft.clear();
                      onClose();
                    }
                  });
              }}
            >
              В корзину
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
  const shelves = useShelves(),
    [manageShelves, setManageShelves] = useState(false),
    [shelfBook, setShelfBook] = useState<Book | null>(null);
  const layout =
    useLiveQuery(async () => (await getDB().settings.get('bookLayout'))?.value) || 'list';
  const reviews = useLiveQuery(() => getDB().personal_reviews.toArray()) || [];
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
    if (!mounted.current) return;
    const next = new URLSearchParams(params);
    next.delete('action');
    next.delete('setup');
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
    next.delete('setup');
    if (mounted.current && params.has('book')) setParams(next, { replace: true });
  };
  const progress = useLiveQuery(() => getDB().reading_progress.toArray()) || [];
  const shelf = params.get('shelf') || '';
  const q = params.get('q') || '';
  const status = [
    'all',
    'reading',
    'finished',
    'unfinished',
    'planned',
    'paused',
    'abandoned',
  ].includes(params.get('status') || '')
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
        (!shelf || b.shelfIds?.includes(shelf)) &&
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
      <div className="page-heading paper-page-heading">
        <PaperFragment className="heading-paper" ruled />
        <div>
          <p className="eyebrow">Личная коллекция</p>
          <h1>{trash ? 'Корзина книг' : 'Мои книги'}</h1>
        </div>
        {!trash && !trashed.length && (
          <ReaderIllustration scene="headphones" className="heading-reader" />
        )}
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
          <div className="library-controls">
            <Field label="Полка">
              <select value={shelf} onChange={(e) => updateFilter('shelf', e.target.value)}>
                <option value="">Вся коллекция</option>
                {shelves.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <button onClick={() => setManageShelves(true)}>Мои полки</button>
            <button
              aria-label="Вид библиотеки"
              onClick={() =>
                void run(
                  () =>
                    getDB().settings.put({
                      key: 'bookLayout',
                      value: layout === 'grid' ? 'list' : 'grid',
                    }),
                  'Вид изменён',
                )
              }
            >
              {layout === 'grid' ? 'Список' : 'Карточки'}
            </button>
          </div>
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
              <SearchField
                label="Поиск моих книг"
                value={q}
                onChange={(value) => updateFilter('q', value)}
              />
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
            <Empty
              title={q || books.length ? 'Книги не найдены' : 'Пока нет книг'}
              illustration={!q && !books.length ? 'headphones' : undefined}
            >
              {books.length > 0 && (
                <button
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete('q');
                    next.delete('status');
                    next.delete('sort');
                    next.delete('shelf');
                    setParams(next, { replace: true });
                  }}
                >
                  Сбросить поиск и фильтры
                </button>
              )}
            </Empty>
          ) : (
            <div className={layout === 'grid' ? 'book-list book-grid' : 'book-list'}>
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
                      <PaperTape className="cover-tape" />
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
                      {b.status === 'finished' && reviews.find((r) => r.bookId === b.id)?.rating ? (
                        <RatingStars value={reviews.find((r) => r.bookId === b.id)!.rating} />
                      ) : (
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
                      )}
                      {shelf && (
                        <button className="text-button" onClick={() => setShelfBook(b)}>
                          Переместить на полку
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {!trash && filtered.length > 0 && <CreativeInsert motif="flowers" />}
      {(edit || editorOpen) && (
        <BookEditor
          key={linked?.id || 'new'}
          setup={params.get('setup') === '1'}
          book={editorOpen ? linked : edit === true ? undefined : edit || undefined}
          onExisting={(b) => {
            setEdit(null);
            if (b.deletedAt) setParams({ view: 'trash' });
            else openBook(b);
          }}
          onClose={params.get('setup') === '1' ? closeAction : closeBook}
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
      {manageShelves && (
        <ShelfManager
          onClose={() => setManageShelves(false)}
          onDeleted={(id) => {
            if (id === shelf) updateFilter('shelf', '');
          }}
        />
      )}
      {shelfBook && (
        <ShelfPicker book={shelfBook} fromShelf={shelf} onClose={() => setShelfBook(null)} />
      )}
      {quick && <QuickReadingStatus book={quick} onClose={() => setQuick(null)} />}
    </>
  );
}
