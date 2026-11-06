import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { getDB } from '../db';
import { saveBook, deleteBook } from '../local';
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
import { searchBooks, normalizedIsbn } from '../bookSearch';
import { Modal, Field, Empty, Cover, useTask, ErrorNote, useSession, useCloud } from './shared';
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
        <Field label="ISBN">
          <input
            maxLength={30}
            value={value.isbn}
            onChange={(e) => set('isbn', e.target.value)}
            onBlur={() => set('isbn', normalizedIsbn(value.isbn) || value.isbn.trim())}
          />
        </Field>
      </div>
      <Field label="Обложка (HTTPS-ссылка)">
        <input
          type="url"
          pattern="https://.*"
          value={value.cover}
          onChange={(e) => set('cover', e.target.value)}
        />
      </Field>
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
      <Field label="Поиск книги по названию, автору или ISBN">
        <input
          value={q}
          placeholder="Название, автор или ISBN"
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
      {busy && <p className="muted">Ищем в Google Books и Open Library…</p>}
      {searched && !busy && !results.length && (
        <p className="hint" role="status">
          В доступных каталогах книга не найдена. Попробуйте название или заполните поля ниже — ISBN
          можно сохранить вручную.
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
export function BookEditor({ book, onClose }: { book?: Book; onClose: () => void }) {
  const [value, setValue] = useState<Book>(
    () =>
      book || {
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
  );
  const [pages, setPages] = useState(0);
  const [review, setReview] = useState<Review>({
    bookId: value.id,
    rating: null,
    text: '',
    spoilers: false,
    updatedAt: now(),
  });
  const { busy, error, run } = useTask();
  const { identity } = useSession();
  const club = useCloud<ClubBook>('club_books');
  useEffect(() => {
    if (book) {
      void getDB()
        .reading_progress.get(book.id)
        .then((p) => setPages(p?.pages || 0));
      void getDB()
        .personal_reviews.get(book.id)
        .then((r) => {
          if (r) setReview(r);
        });
    }
  }, [book]);
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
                ),
              'Книга сохранена',
            )
          )
            onClose();
        }}
      >
        {!book && (
          <>
            {!!club.data?.length && (
              <Field label="Взять книгу из клуба">
                <select
                  value={value.clubBookId || ''}
                  onChange={(e) => {
                    const b = club.data?.find((b) => b.id === e.target.value);
                    if (b)
                      setValue({
                        ...value,
                        clubBookId: b.id,
                        title: b.title,
                        authors: b.authors,
                        description: b.description,
                        genre: b.genre,
                        year: b.year,
                        isbn: b.isbn,
                        cover: b.cover,
                        totalPages: b.default_pages,
                      });
                    else setValue({ ...value, clubBookId: null });
                  }}
                >
                  <option value="">Выбрать книгу или добавить свою ниже</option>
                  {club.data.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <BookLookup onSelect={(b) => setValue({ ...value, ...b, clubBookId: null })} />
          </>
        )}
        <MetadataFields compact value={value} onChange={(b) => setValue({ ...value, ...b })} />
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
            <Field label="Личный статус">
              <select
                value={value.status}
                onChange={(e) => setValue({ ...value, status: e.target.value as Book['status'] })}
              >
                {Object.entries(personalStatuses).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
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
          {identity && value.clubBookId && (
            <p className="muted">Прогресс этой книги виден участникам клуба.</p>
          )}
        </details>
        <details className="book-extra">
          <summary>Отзыв, оценка и заметки</summary>
          <Field label="Моя оценка">
            <select
              value={review.rating || ''}
              onChange={(e) =>
                setReview({ ...review, rating: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Без оценки</option>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </select>
          </Field>
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
          <button disabled={busy} className="primary">
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
                    'Удалить книгу, её отзывы, заметки и цитаты? Публичные копии будут удалены после синхронизации.',
                  )
                )
                  if (await run(() => deleteBook(book.id), 'Книга удалена')) onClose();
              }}
            >
              <Trash2 size={16} />
              Удалить
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
export function MyBooks() {
  const books = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const progress = useLiveQuery(() => getDB().reading_progress.toArray()) || [];
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('updated');
  const [edit, setEdit] = useState<Book | true | null>(null);
  const filtered = books
    .filter(
      (b) =>
        (status === 'all' || b.status === status) &&
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
          <h1>Мои книги {books.length > 0 && <em>{books.length}</em>}</h1>
        </div>
        <button className="primary" onClick={() => setEdit(true)}>
          <Plus size={18} /> Добавить
        </button>
      </div>
      {books.length > 0 && (
        <div className="toolbar">
          <label className="search">
            <Search size={18} />
            <input
              aria-label="Поиск моих книг"
              placeholder="Название или автор"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select
            aria-label="Фильтр статуса"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Все статусы</option>
            {Object.entries(personalStatuses).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="sort">
            <SlidersHorizontal size={16} />
            <select aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="updated">По обновлению</option>
              <option value="title">По названию</option>
            </select>
          </label>
        </div>
      )}
      {!filtered.length ? (
        <Empty title={q ? 'Ничего не найдено' : 'Пока нет книг'} />
      ) : (
        <div className="book-grid">
          {filtered.map((b) => {
            const p = progress.find((x) => x.bookId === b.id)?.pages || 0;
            return (
              <button className="book-card" key={b.id} onClick={() => setEdit(b)}>
                <Cover cover={b.cover} title={b.title} />
                <div>
                  <span className={`badge ${b.status}`}>{personalStatuses[b.status]}</span>
                  <h3>{b.title}</h3>
                  <p>{b.authors || 'Автор не указан'}</p>
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
                </div>
              </button>
            );
          })}
        </div>
      )}
      {edit && <BookEditor book={edit === true ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}
