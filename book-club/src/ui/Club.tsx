import { EntryFeed } from './EntryFeed';
import { currentClubBooks, nextClubMeeting } from '../clubSelectors';
import { useState } from 'react';
import { useSectionSwipe } from './useSectionSwipe';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
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
  useClock,
  SearchField,
} from './shared';
import { PublicContent } from './Social';
import { BookPolls } from './Polls';
import { MeetingCard } from './Meetings';
import { BookReaders } from './Readers';
import { clubBookFinished, clubCounts } from '../collection';
import { bookCover } from '../covers';
import { BookMemory, BookThoughtEditor } from './BookMemory';
import { ClubReadingDecision } from './ReadingParticipation';
import {
  BotanicalSprig,
  HeadingCollage,
  PaperFragment,
  PaperTape,
  BookmarkTab,
} from './EditorialArt';
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
            const own = personal.find((p) => p.clubBookId === b.id && !p.deletedAt);
            const pages = progress.find((p) => p.bookId === own?.id)?.pages || 0;
            return (
              <article className="current-book" key={b.id}>
                <Link
                  className="featured-book"
                  key={b.id}
                  aria-label={`Открыть книгу «${b.title}»`}
                  to={`/club/${b.id}`}
                >
                  <div className="featured-cover">
                    <PaperFragment />
                    <PaperTape className="featured-tape" />
                    <BookmarkTab />
                    <BotanicalSprig />
                    <Cover title={b.title} cover={bookCover(own, b.cover)} />
                  </div>
                  <div className="featured-copy">
                    <span className="eyebrow featured-label">Книга клуба</span>
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
                    <ArrowUpRight className="book-open-icon" size={20} aria-hidden="true" />
                  </div>
                </Link>
                <ClubReadingDecision book={b} />
                {own && (
                  <Link
                    className="button current-book-progress"
                    to={`/books?book=${own.id}&action=progress`}
                  >
                    Обновить мой прогресс
                  </Link>
                )}
                <details className="book-extra home-readers">
                  <summary>Прогресс участников</summary>
                  <BookReaders bookId={b.id} title={b.title} />
                </details>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
export function Home() {
  const clock = useClock();
  const meetings = useCloud<Meeting>('meetings');
  const upcoming = nextClubMeeting(meetings.data || [], clock);
  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <p className="eyebrow">Между страницами и разговорами</p>
          <h1>Книжный клуб</h1>
          <p className="home-subtitle">У каждого своя страница.</p>
        </div>
        <HeadingCollage scene="reader" />
      </div>
      <CloudGate>
        <div className="section-title editorial-section">
          <h2>Читаем сейчас</h2>
          <Link to="/club">
            Все книги <ArrowUpRight size={15} />
          </Link>
        </div>
        <MainBooks />
        <div className="section-title editorial-section">
          <h2>Следующая встреча</h2>
          <Link to="/meetings">
            Все встречи <ArrowUpRight size={15} />
          </Link>
        </div>
        <ErrorNote text={meetings.error?.message} />
        {meetings.isLoading ? (
          <Loading />
        ) : upcoming ? (
          <MeetingCard compact meeting={upcoming} />
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
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '',
    tab = params.get('tab') === 'all' ? 'all' : 'reading',
    filter = ['finished', 'unfinished'].includes(params.get('filter') || '')
      ? params.get('filter')!
      : 'all';
  const changeParam = (name: string, value: string) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  const setQ = (value: string) => changeParam('q', value),
    setTab = (value: string) => changeParam('tab', value),
    setFilter = (value: string) => changeParam('filter', value);
  const [opened, setOpened] = useState<string | null>(null);
  const [proposal, setProposal] = useState(false);
  const all = books.data || [];
  const history = readings.data || [];
  const current = currentClubBooks(all, history);
  const visible = all
    .filter(
      (b) =>
        (filter === 'all' ||
          (filter === 'finished' ? clubBookFinished(b, history) : !clubBookFinished(b, history))) &&
        `${b.title} ${b.authors} ${b.genre}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return (
    <>
      <div className="page-heading collage-page-heading">
        <div>
          <p className="eyebrow">Общая коллекция</p>
          <h1>Клуб</h1>
        </div>
        <HeadingCollage scene="carrying" />
      </div>
      <CloudGate>
        <div className="tabs club-library-tabs" aria-label="Разделы библиотеки">
          <button className={tab === 'reading' ? 'active' : ''} onClick={() => setTab('reading')}>
            Читаем{current.length ? ` · ${current.length}` : ''}
          </button>
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
            Все книги{all.length ? ` · ${all.length}` : ''}
          </button>
        </div>
        <ErrorNote text={books.error?.message || readings.error?.message} />
        {books.isLoading || readings.isLoading ? (
          <Loading />
        ) : books.error || readings.error ? null : tab === 'reading' ? (
          !current.length ? (
            <Empty title="Сейчас нет книг в чтении" />
          ) : (
            <div className="stack">
              {current.map(({ book: b }) => (
                <article className="reading-accordion" key={b.id}>
                  <button
                    className="reading-summary"
                    aria-expanded={opened === b.id}
                    aria-label={`Открыть прогресс: ${b.title}`}
                    onClick={() => setOpened(opened === b.id ? null : b.id)}
                  >
                    <Cover title={b.title} cover={b.cover} small />
                    <span>
                      <h2>{b.title}</h2>
                      <small>{b.authors}</small>
                    </span>
                    <span aria-hidden="true">{opened === b.id ? '−' : '+'}</span>
                  </button>
                  {opened === b.id && (
                    <>
                      <BookReaders bookId={b.id} title={b.title} />
                      <Link className="button reading-more" to={`/club/${b.id}`}>
                        О книге, цитаты и мысли →
                      </Link>
                    </>
                  )}
                </article>
              ))}
            </div>
          )
        ) : (
          <>
            {!!all.length && (
              <>
                <div className="toolbar club-search">
                  <SearchField label="Поиск книг клуба" value={q} onChange={setQ} />
                </div>
                <div
                  className="tabs collection-tabs"
                  role="tablist"
                  aria-label="Книги клуба по статусу"
                >
                  {(['finished', 'unfinished', 'all'] as const).map((key) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={filter === key}
                      className={filter === key ? 'active' : ''}
                      onClick={() => setFilter(key)}
                    >
                      {{ finished: 'Прочитано', unfinished: 'Не прочитано', all: 'Все' }[key]}
                      <span className="tab-count">
                        {clubCounts(all, history)[key === 'all' ? 'total' : key]}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {identity && (
              <details className="book-extra proposals-section">
                <summary>Предложения и голосования</summary>
                <button className="primary" onClick={() => setProposal(true)}>
                  <Plus size={18} />
                  Предложить книгу
                </button>
                <BookPolls />
              </details>
            )}
            {!visible.length ? (
              <Empty title={q || all.length ? 'Книги не найдены' : 'В коллекции пока нет книг'} />
            ) : (
              <div className="book-list club-catalog">
                {visible.map((b) => (
                  <Link className="book-card" key={b.id} to={`/club/${b.id}`}>
                    <PaperTape className="catalog-tape" />
                    <BotanicalSprig className="catalog-sprig" />
                    <Cover title={b.title} cover={b.cover} />
                    {current.some((x) => x.book.id === b.id) && <BookmarkTab />}
                    <div>
                      <span className="badge">
                        {clubBookFinished(b, history)
                          ? 'Прочитано клубом'
                          : current.some((x) => x.book.id === b.id)
                            ? 'Читаем'
                            : 'Не прочитано'}
                      </span>
                      <h3>{b.title}</h3>
                      <p>{b.authors}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </CloudGate>
      {proposal && <ProposalEditor onClose={() => setProposal(false)} />}
    </>
  );
}
export function ClubDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const books = useCloud<ClubBook>('club_books');
  const readings = useCloud<Reading>('club_readings');
  const { run, error, busy } = useTask();
  const [tab, setTab] = useState('overview');
  const swipe = useSectionSwipe(
    ['overview', 'quotes', 'reviews', 'thought', 'note', 'progress'],
    tab,
    setTab,
  );
  const [thought, setThought] = useState(false);
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
      <section className="book-detail book-detail-compact">
        <PaperFragment className="book-detail-paper" />
        <PaperTape className="book-detail-tape" />
        <Cover title={b.title} cover={bookCover(own, b.cover)} />
        <div className="book-detail-heading">
          <span className="badge">{clubStatuses[b.status]}</span>
          <h1>{b.title}</h1>
          <h3>{b.authors}</h3>
          <p className="muted">
            {[b.genre, b.year, b.default_pages ? `${b.default_pages} стр.` : '']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="book-detail-actions">
          <ClubReadingDecision book={b} />
          {own && !own.deletedAt && (
            <Link className="primary" to={`/books?book=${own.id}&action=progress`}>
              Обновить мой прогресс
            </Link>
          )}
          {own ? (
            <Link
              className={own.deletedAt ? 'primary' : 'button'}
              to={own.deletedAt ? '/books?view=trash' : `/books?book=${own.id}`}
            >
              {own.deletedAt ? 'Книга в корзине — восстановить' : 'Уже на моей полке'}
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
                  navigate(`/books?book=${book.id}&action=edit&setup=1`);
                }, 'Книга добавлена в личную библиотеку')
              }
            >
              <Plus size={17} /> В мои книги
            </button>
          )}
          {!own?.deletedAt && (
            <button className="button" onClick={() => setThought(true)}>
              Оставить впечатление
            </button>
          )}
          <ErrorNote text={error} />
        </div>
        {b.description && (
          <details className="book-extra book-description">
            <summary>Описание книги</summary>
            <p className="prewrap">{b.description}</p>
          </details>
        )}
      </section>
      <div className="book-swipe-content" {...swipe}>
        <div className="book-section-nav">
          {[
            ['overview', 'О книге'],
            ['quotes', 'Цитаты'],
            ['reviews', 'Отзывы'],
            ['thought', 'Мысли'],
            ['note', 'Заметки'],
            ['progress', 'Читатели'],
          ].map(([k, v]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {v}
            </button>
          ))}
        </div>
        {tab === 'overview' ? (
          <>
            <BookMemory bookId={b.id} onTab={setTab} />
            {(readings.data || []).some((r) => r.book_id === id) && (
              <details className="book-extra">
                <summary>История чтения клубом</summary>
                {readings.data
                  ?.filter((r) => r.book_id === id)
                  .map((r) => (
                    <p key={r.id}>
                      {r.starts_on} — {r.ends_on || 'без даты окончания'} ·{' '}
                      {{ active: 'Читаем', finished: 'Завершено', cancelled: 'Отменено' }[r.status]}
                    </p>
                  ))}
              </details>
            )}
          </>
        ) : tab === 'thought' || tab === 'note' ? (
          <EntryFeed key={tab} kind={tab} bookId={id} />
        ) : tab === 'progress' ? (
          <BookReaders bookId={id!} title={b.title} />
        ) : (
          <PublicContent
            type={tab as 'quotes' | 'reviews' | 'progress'}
            bookId={id}
            sort={tab === 'quotes' ? 'likes' : 'newest'}
          />
        )}
      </div>
      {thought && <BookThoughtEditor book={b} onClose={() => setThought(false)} />}
    </CloudGate>
  );
}
