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
export function MainBooks() {
  const books = useCloud<ClubBook>('club_books');
  const readings = useCloud<Reading>('club_readings');
  const personal = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const progress = useLiveQuery(() => getDB().reading_progress.toArray()) || [];
  if (books.isLoading || readings.isLoading) return <Loading />;
  const active = (readings.data || [])
    .filter((r) => r.status === 'active')
    .sort((a, b) => a.position - b.position);
  return (
    <>
      <ErrorNote text={books.error?.message || readings.error?.message} />
      {!active.length ? (
        <Empty title="Выбираем следующую историю">
          Администратор может назначить несколько главных книг клуба.
        </Empty>
      ) : (
        <div className="main-books">
          {active.map((r) => {
            const b = books.data?.find((x) => x.id === r.book_id);
            if (!b) return null;
            const p = personal.find((x) => x.clubBookId === b.id);
            const pages = progress.find((x) => x.bookId === p?.id)?.pages || 0;
            return (
              <Link className="featured-book" key={r.id} to={`/club/${b.id}`}>
                <Cover title={b.title} cover={b.cover} />
                <div>
                  <span className="eyebrow">ЧИТАЕМ ВМЕСТЕ</span>
                  <h2>{b.title}</h2>
                  <p>{b.authors}</p>
                  <small>
                    {r.starts_on}
                    {r.ends_on ? ` → ${r.ends_on}` : ''}
                  </small>
                  {p ? (
                    <>
                      <div className="progress">
                        <i style={{ width: `${percent(pages, p.totalPages)}%` }} />
                      </div>
                      <small>
                        Мой прогресс: {pages} / {p.totalPages} стр.
                      </small>
                    </>
                  ) : (
                    <p className="hint">Добавьте в мои книги, чтобы отмечать прогресс</p>
                  )}
                </div>
                <ArrowUpRight size={20} />
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
export function Home() {
  const { identity } = useSession();
  const profiles = useCloud<{ member_id: string; name: string }>('member_profiles');
  const meetings = useCloud<Meeting>('meetings');
  const books = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const quotes = useLiveQuery(() => getDB().quotes.toArray()) || [];
  const upcoming = meetings.data
    ?.filter((m) => !m.cancelled && Date.parse(m.starts_at) > Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const name = profiles.data?.find((p) => p.member_id === identity?.id)?.name.split(' ')[0];
  return (
    <>
      <div className="home-top">
        <span className="eyebrow">ЗАКРЫТЫЙ КНИЖНЫЙ КЛУБ</span>
        <span className="date-chip">
          {new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
        </span>
      </div>
      <section className="hero">
        <div>
          <p className="hero-kicker">МЕСТО ДЛЯ ХОРОШИХ ИСТОРИЙ</p>
          <h1>
            {name ? `${name}, ` : ''}давайте
            <br />
            читать <i>вместе.</i>
          </h1>
          <p>
            Книги, которые сближают.
            <br />
            Мысли, которыми хочется делиться.
          </p>
          <Link className="cream-button" to="/books">
            <BookOpen size={17} /> Моя книжная полка <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="book-art" aria-hidden="true">
          <div className="art-book one">
            МЕЖДУ
            <br />
            СТРОК<span>читаем вместе</span>
          </div>
          <div className="art-book two">
            ВРЕМЯ
            <br />
            ЧИТАТЬ
          </div>
          <div className="art-book three">
            ЕЩЁ ОДНА
            <br />
            ГЛАВА
          </div>
          <div className="art-circle" />
        </div>
      </section>
      <div className="stats">
        <div>
          <b>
            {books
              .filter((b) => b.status === 'reading')
              .length.toString()
              .padStart(2, '0')}
          </b>
          <span>читаю сейчас</span>
        </div>
        <div>
          <b>
            {books
              .filter((b) => b.status === 'finished')
              .length.toString()
              .padStart(2, '0')}
          </b>
          <span>книг прочитано</span>
        </div>
        <div>
          <b>
            {quotes
              .filter((q) => !q.deletedAt)
              .length.toString()
              .padStart(2, '0')}
          </b>
          <span>сохранённых мыслей</span>
        </div>
      </div>
      <div className="section-title">
        <h2>На общем столе</h2>
        <Link to="/club">
          Весь каталог <ArrowUpRight size={15} />
        </Link>
      </div>
      <CloudGate>
        <MainBooks />
      </CloudGate>
      <div className="section-title">
        <h2>Следующая встреча</h2>
        <Link to="/meetings">
          Все встречи <ArrowUpRight size={15} />
        </Link>
      </div>
      {upcoming ? (
        <Link className="meeting-preview" to="/meetings">
          <CalendarDays size={28} />
          <div>
            <h3>{upcoming.title}</h3>
            <p>
              {dateLabel(upcoming.starts_at)} · {upcoming.place}
            </p>
          </div>
          <ArrowUpRight />
        </Link>
      ) : (
        <div className="soft-panel">
          <CalendarDays size={22} />
          <p>Новая встреча появится здесь, когда клуб выберет дату.</p>
        </div>
      )}
      <section className="thought">
        <span>НА ПОЛЯХ</span>
        <p>
          У каждой книги — своя история.
          <br />У хорошей книги — ещё и наша.
        </p>
        <Link to="/quotes">Собрать свою коллекцию цитат →</Link>
      </section>
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
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [genre, setGenre] = useState('all');
  const [proposal, setProposal] = useState(false);
  const filtered = (books.data || []).filter(
    (b) =>
      (status === 'all' || b.status === status) &&
      (genre === 'all' || b.genre === genre) &&
      `${b.title} ${b.authors}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ОБЩАЯ КНИЖНАЯ ПОЛКА</p>
          <h1>Библиотека клуба</h1>
        </div>
        {identity && (
          <>
            <button className="primary" onClick={() => setProposal(true)}>
              <Plus size={18} /> Предложить
            </button>
          </>
        )}
      </div>
      <CloudGate>
        <div className="toolbar">
          <input
            aria-label="Поиск книг клуба"
            placeholder="Название или автор"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Клубный статус"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Все статусы</option>
            {Object.entries(clubStatuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select aria-label="Жанр" value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="all">Все жанры</option>
            {[...new Set(books.data?.map((b) => b.genre).filter(Boolean))].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
        <ErrorNote text={books.error?.message} />
        {books.isLoading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty title="Каталог ждёт ваши предложения">
            Поделитесь книгой, которую хочется обсудить вместе.
          </Empty>
        ) : (
          <div className="book-grid">
            {filtered.map((b) => (
              <Link className="book-card" key={b.id} to={`/club/${b.id}`}>
                <Cover title={b.title} cover={b.cover} />
                <div>
                  <span className={`badge ${b.status}`}>{clubStatuses[b.status]}</span>
                  <h3>{b.title}</h3>
                  <p>{b.authors}</p>
                  <small>
                    {b.genre} · {b.default_pages} стр.
                  </small>
                </div>
              </Link>
            ))}
          </div>
        )}
        <div className="section-title">
          <h2>Цитаты клуба</h2>
        </div>
        <PublicContent type="quotes" />
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
