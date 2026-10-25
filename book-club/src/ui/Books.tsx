import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, SlidersHorizontal, Trash2, LockKeyhole } from 'lucide-react';
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
} from '../domain';
import { searchBooks } from '../bookSearch';
import { Modal, Field, Empty, Cover, useTask, ErrorNote, useSession } from './shared';
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
}: {
  value: Metadata;
  onChange: (b: Metadata) => void;
}) {
  const set = (key: keyof Metadata, v: unknown) => onChange({ ...value, [key]: v });
  return (
    <>
      <div className="form-grid">
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
        <Field label="Страниц в моём издании">
          <input
            type="number"
            min="0"
            max="1000000"
            required
            value={value.totalPages}
            onChange={(e) => set('totalPages', Number(e.target.value))}
          />
        </Field>
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
            min="0"
            max="3000"
            value={value.year ?? ''}
            onChange={(e) => set('year', e.target.value ? Number(e.target.value) : null)}
          />
        </Field>
        <Field label="ISBN">
          <input maxLength={30} value={value.isbn} onChange={(e) => set('isbn', e.target.value)} />
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
          maxLength={10000}
          rows={3}
          value={value.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
    </>
  );
}
export function BookLookup({ onSelect }: { onSelect: (b: Metadata) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Metadata[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    if (q.trim().length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const timeout = setTimeout(() => {
      setBusy(true);
      searchBooks(q, controller.signal)
        .then(setResults)
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 450);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [q]);
  return (
    <section className="lookup">
      <Field label="Найти издание автоматически">
        <input
          value={q}
          placeholder="Название, автор или ISBN"
          onChange={(e) => setQ(e.target.value)}
        />
      </Field>
      <ErrorNote text={error} />
      {busy && <p className="muted">Ищем в Google Books и Open Library…</p>}
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
  useEffect(() => {
    if (book) {
      getDB()
        .reading_progress.get(book.id)
        .then((p) => setPages(p?.pages || 0));
      getDB()
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
                saveBook({ ...value, updatedAt: now() }, pages, { ...review, updatedAt: now() }),
              'Книга сохранена на устройстве',
            )
          )
            onClose();
        }}
      >
        {!book && <BookLookup onSelect={(b) => setValue({ ...value, ...b })} />}
        <MetadataFields value={value} onChange={(b) => setValue({ ...value, ...b })} />
        <div className="form-grid">
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
              aria-label="Прочитано страниц"
              type="number"
              min="0"
              max={value.totalPages}
              required
              value={pages}
              onChange={(e) => setPages(Number(e.target.value))}
            />
          </Field>
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
        </div>
        <Field label="Мой отзыв">
          <textarea
            rows={4}
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
          />{' '}
          Содержит спойлеры
        </label>
        <Field label="Приватные заметки">
          <textarea
            rows={3}
            maxLength={50000}
            value={value.notes}
            onChange={(e) => setValue({ ...value, notes: e.target.value })}
          />
        </Field>
        {identity && value.clubBookId ? (
          <fieldset>
            <legend>Публикация в клубе</legend>
            <p className="hint">
              Также включите соответствующие разрешения в профиле. Пока операция в очереди,
              изменение ещё не подтверждено сервером.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={value.publishProgress}
                onChange={(e) => setValue({ ...value, publishProgress: e.target.checked })}
              />{' '}
              Публиковать статус и прогресс
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={value.publishReview}
                onChange={(e) => setValue({ ...value, publishReview: e.target.checked })}
              />{' '}
              Публиковать отзыв и оценку
            </label>
          </fieldset>
        ) : (
          <p className="hint">
            <LockKeyhole size={14} /> Только на этом устройстве. Для публикации добавьте книгу из
            клуба.
          </p>
        )}
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
              <Trash2 size={16} /> Удалить
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
          <p className="eyebrow">ВАША ЛИЧНАЯ ПОЛКА</p>
          <h1>
            Мои книги <em>{books.length}</em>
          </h1>
        </div>
        <button className="primary" onClick={() => setEdit(true)}>
          <Plus size={18} /> Добавить
        </button>
      </div>
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
      <p className="hint">
        <LockKeyhole size={14} /> Личные данные сохраняются в этом браузере. Делайте резервные копии
        в профиле.
      </p>
      {!filtered.length ? (
        <Empty title={q ? 'Ничего не найдено' : 'История чтения начинается здесь'}>
          Добавьте книгу вручную или найдите своё издание по названию.
        </Empty>
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
                  <div className="progress">
                    <i style={{ width: `${percent(p, b.totalPages)}%` }} />
                  </div>
                  <small>
                    {p} из {b.totalPages} стр. <b>{percent(p, b.totalPages)}%</b>
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
