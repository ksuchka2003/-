import { currentClubBooks, nextClubMeeting } from '../clubSelectors';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, ArrowUpRight, BookOpen, CalendarDays } from 'lucide-react';
import {
  type ClubBook,
  type Reading,
  type Metadata,
  type Meeting,
  clubStatuses,
  now,
  uid,
  percent,
} from '../domain';
import { getDB } from '../db';
import { saveBook } from '../local';
import { action } from '../cloud';
import { BookLookup, MetadataFields } from './Books';
import {
  CloudGate,
  Cover,
  Empty,
  useCloud,
  useTask,
  ErrorNote,
  Loading,
  Modal,
  useSession,
  dateLabel,
} from './shared';
import { PublicContent } from './Social';
import { BookPolls } from './Polls';
export function MainBooks() {
  const books = useCloud<ClubBook>('club_books');
  const readings = useCloud<Reading>('club_readings');
  const personal = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const progress = useLiveQuery(() => getDB().reading_progress.toArray()) || [];
  if (books.isLoading || readings.isLoading) return <Loading />;
  const current = currentClubBooks(books.data || [], readings.data || []);
  return (
    <>
      <ErrorNote text={books.error?.message || readings.error?.message} />
      {!current.length ? (
        <Empty title="Сейчас нет книг в чтении" />
      ) : (
        <div className="main-books">
          {current.map(({ book: b, reading: r }) => {
            const own = personal.find((p) => p.clubBookId === b.id);
            const pages = progress.find((p) => p.bookId === own?.id)?.pages || 0;
            return (
              <Link
                className="featured-book"
                key={b.id}
                aria-label={`Открыть книгу «${b.title}»`}
                to={`/club/${b.id}`}
              >
                <Cover title={b.title} cover={b.cover} />
                <div>
                  <h2>{b.title}</h2>
                  <p>{b.authors}</p>
                  {r?.ends_on && (
                    <small>
                      До {new Date(r.ends_on + 'T12:00:00').toLocaleDateString('ru-RU')}
                    </small>
                  )}
                  {own && (
                    <>
                      <div className="progress">
                        <i style={{ width: `${percent(pages, own.totalPages)}%` }} />
                      </div>
                      <small>
                        Мой прогресс: {pages} / {own.totalPages} стр.
                      </small>
                    </>
                  )}
                  <span className="book-open-label">Открыть книгу →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
export function Home() {
  const meetings = useCloud<Meeting>('meetings');
  const upcoming = nextClubMeeting(meetings.data || []);
  return (
    <>
      <div className="page-heading">
        <h1>Книжный клуб</h1>
      </div>
      <CloudGate>
        <div className="section-title">
          <h2>Читаем сейчас</h2>
          <Link to="/club">
            Все книги <ArrowUpRight size={15} />
          </Link>
        </div>
        <MainBooks />
        <div className="section-title">
          <h2>Следующая встреча</h2>
          <Link to="/meetings">
            Все встречи <ArrowUpRight size={15} />
          </Link>
        </div>
        <ErrorNote text={meetings.error?.message} />
        {meetings.isLoading ? (
          <Loading />
        ) : upcoming ? (
          <Link className="meeting-preview" to="/meetings">
            <CalendarDays size={25} />
            <div>
              <h3>{upcoming.title}</h3>
              <p>
                {dateLabel(upcoming.starts_at)}
                {upcoming.place ? ` · ${upcoming.place}` : ''}
              </p>
            </div>
            <ArrowUpRight size={18} />
          </Link>
        ) : (
          <Empty title="Пока нет предстоящих встреч" />
        )}
      </CloudGate>
    </>
  );
}
export function ProposalEditor({
  onClose,
  existing,
}: {
  onClose: () => void;
  existing?: { id: string; metadata: Metadata };
}) {
  const [v, setV] = useState<Metadata>(
    existing?.metadata || {
      title: '',
      authors: '',
      description: '',
      genre: '',
      year: null,
      isbn: '',
      cover: '',
      totalPages: 0,
    },
  );
  const [id] = useState(existing?.id || uid());
  const [draft, setDraft] = useState(false);
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  return (
    <Modal title="Предложить книгу" onClose={onClose}>
      <p className="hint">
        После отправки участники смогут проголосовать за книгу. В каталог её добавит администратор.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(
              async () => {
                await action('proposal', { id, metadata: v, status: draft ? 'draft' : 'pending' });
                await query.invalidateQueries({ queryKey: ['cloud'] });
              },
              draft ? 'Черновик сохранён' : 'Заявка отправлена',
            )
          )
            onClose();
        }}
      >
        <BookLookup onSelect={setV} />
        <MetadataFields value={v} onChange={setV} />
        <label className="check">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />{' '}
          Сохранить черновик
        </label>
        <ErrorNote text={error} />
        <button className="primary" disabled={busy}>
          {draft ? 'Сохранить' : 'Отправить на рассмотрение'}
        </button>
      </form>
    </Modal>
  );
}
export function Club() {
  const { identity } = useSession();
  const books = useCloud<ClubBook>('club_books');
  const readings = useCloud<Reading>('club_readings');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ClubBook['status']>('reading');
  const [proposal, setProposal] = useState(false);
  const categories = [
    ['reading', 'Читаем сейчас'],
    ['planned', 'Будем читать'],
    ['finished', 'Прочитано'],
  ] as const;
  const currentIds = new Set(
    currentClubBooks(books.data || [], readings.data || []).map(({ book }) => book.id),
  );
  const section = (book: ClubBook) => (currentIds.has(book.id) ? 'reading' : book.status);
  const visible = (books.data || [])
    .filter(
      (b) =>
        section(b) === status &&
        `${b.title} ${b.authors} ${b.genre}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return (
    <>
      <div className="page-heading">
        <h1>Библиотека клуба</h1>
      </div>
      <CloudGate>
        {!!books.data?.length && (
          <div className="toolbar">
            <input
              aria-label="Поиск книг клуба"
              placeholder="Название или автор"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}
        <div className="tabs" aria-label="Разделы библиотеки">
          {categories.map(([key, label]) => (
            <button
              key={key}
              className={status === key ? 'active' : ''}
              onClick={() => setStatus(key)}
            >
              {label}
              {!!(books.data || []).filter((b) => section(b) === key).length && (
                <span className="tab-count">
                  {(books.data || []).filter((b) => section(b) === key).length}
                </span>
              )}
            </button>
          ))}
        </div>
        {status === 'planned' && (
          <>
            <div className="section-actions">
              {identity && (
                <button className="primary" onClick={() => setProposal(true)}>
                  <Plus size={18} /> Предложить книгу
                </button>
              )}
            </div>
            <BookPolls />
          </>
        )}
        <ErrorNote text={books.error?.message || readings.error?.message} />
        {books.isLoading || readings.isLoading ? (
          <Loading />
        ) : !visible.length ? (
          <Empty title={q ? 'Книги не найдены' : 'В этом разделе пока нет книг'} />
        ) : (
          <div className="book-grid">
            {visible.map((b) => (
              <Link className="book-card" key={b.id} to={`/club/${b.id}`}>
                <Cover title={b.title} cover={b.cover} />
                <div>
                  <h3>{b.title}</h3>
                  <p>{b.authors}</p>
                  {b.genre && <small>{b.genre}</small>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CloudGate>
      {proposal && <ProposalEditor onClose={() => setProposal(false)} />}
    </>
  );
}
export function ClubDetail() {
  const { id } = useParams();
  const books = useCloud<ClubBook>('club_books');
  const readings = useCloud<Reading>('club_readings');
  const { run, error, busy } = useTask();
  const [tab, setTab] = useState('quotes');
  const b = books.data?.find((x) => x.id === id);
  const personal = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const own = personal.find((x) => x.clubBookId === id);
  if (books.isLoading) return <Loading />;
  if (!b)
    return (
      <CloudGate>
        <ErrorNote text={books.error?.message} />
        <Empty title="Книга не найдена" />
      </CloudGate>
    );
  return (
    <CloudGate>
      <Link className="back" to="/club">
        ← Библиотека клуба
      </Link>
      <section className="book-detail">
        <Cover title={b.title} cover={b.cover} />
        <div>
          <span className="badge">{clubStatuses[b.status]}</span>
          <h1>{b.title}</h1>
          <h3>{b.authors}</h3>
          <p className="muted">
            {b.genre} · {b.year || 'Год не указан'} · {b.default_pages} стр.
          </p>
          <p className="prewrap">{b.description}</p>
          {own ? (
            <Link className="primary" to="/books">
              Уже на моей полке
            </Link>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await getDB().club_catalog_cache.put(b);
                  const book = {
                    id: uid(),
                    clubBookId: b.id,
                    title: b.title,
                    authors: b.authors,
                    description: b.description,
                    genre: b.genre,
                    year: b.year,
                    isbn: b.isbn,
                    cover: b.cover,
                    totalPages: b.default_pages,
                    status: 'planned' as const,
                    notes: '',
                    publishProgress: false,
                    publishReview: false,
                    createdAt: now(),
                    updatedAt: now(),
                  };
                  await saveBook(book, 0, {
                    bookId: book.id,
                    rating: null,
                    text: '',
                    spoilers: false,
                    updatedAt: now(),
                  });
                }, 'Книга добавлена в личную библиотеку')
              }
            >
              <Plus size={17} /> В мои книги
            </button>
          )}
          <ErrorNote text={error} />
        </div>
      </section>
      <div className="tabs">
        {[
          ['quotes', 'Цитаты'],
          ['reviews', 'Отзывы'],
          ['progress', 'Кто читает'],
          ['history', 'История клуба'],
        ].map(([k, v]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>
      {tab === 'history' ? (
        <div className="stack">
          {readings.data
            ?.filter((r) => r.book_id === id)
            .map((r) => (
              <div className="panel" key={r.id}>
                {r.starts_on} — {r.ends_on || 'без даты окончания'} ·{' '}
                {{ active: 'Читаем', finished: 'Завершено', cancelled: 'Отменено' }[r.status]}
              </div>
            ))}
        </div>
      ) : (
        <PublicContent type={tab as 'quotes' | 'reviews' | 'progress'} bookId={id} />
      )}
    </CloudGate>
  );
}
