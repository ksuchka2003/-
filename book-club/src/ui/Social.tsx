import { Field } from './shared';
import { EntryFeed } from './EntryFeed';
import { Achievements } from './Achievements';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookmarkPlus, ChevronRight } from 'lucide-react';
import { HeadingCollage, PaperFragment, PaperTape, PaperFrame } from './EditorialArt';
import { PaperSelect } from './PaperSelect';
import {
  type Profile,
  type PublicQuote,
  type PublicReview,
  type PublicProgress,
  personalStatuses,
  percent,
} from '../domain';
import { quoteBookKey } from '../collection';
import { copyPublicQuote } from '../local';
import { RatingStars } from './RatingStars';
import { ReadingAwards } from './ReadingAwards';
import { ReactionButtons, DiscussionButton, SourceDisclosure } from './SocialActions';
import {
  useCloud,
  CloudGate,
  Empty,
  Loading,
  ErrorNote,
  useTask,
  useSession,
  Cover,
  dateLabel,
  SearchField,
} from './shared';
export function Avatar({ profile }: { profile: Profile }) {
  return (
    <div className="avatar">
      {profile.avatar_url && (
        <img
          src={profile.avatar_url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      <span>{profile.name[0]}</span>
    </div>
  );
}
export function PublicContent({
  type,
  memberId,
  bookId,
  currentOnly = false,
  sort = 'newest',
  limit,
  search = '',
  quoteBook = 'all',
  likedOnly = false,
}: {
  type: 'quotes' | 'reviews' | 'progress';
  memberId?: string;
  bookId?: string;
  currentOnly?: boolean;
  sort?: 'newest' | 'likes';
  limit?: number;
  search?: string;
  quoteBook?: string;
  likedOnly?: boolean;
}) {
  const quotes = useCloud<PublicQuote>('club_quotes');
  const reviews = useCloud<PublicReview>('club_reviews');
  const progress = useCloud<PublicProgress>('visible_progress');
  const profiles = useCloud<Profile>('member_profiles');
  const likes = useCloud<{ quote_id: string; member_id: string }>('quote_likes');
  const { identity } = useSession();
  const { run, error, busy } = useTask();
  const source = type === 'quotes' ? quotes : type === 'reviews' ? reviews : progress;
  const [pageSize, setPageSize] = useState(24);
  useEffect(() => setPageSize(24), [type, memberId, bookId, search, quoteBook, likedOnly, sort]);
  const likeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of likes.data || []) counts.set(l.quote_id, (counts.get(l.quote_id) || 0) + 1);
    return counts;
  }, [likes.data]);
  const myLikes = useMemo(
    () =>
      new Set(
        (likes.data || []).filter((l) => l.member_id === identity?.id).map((l) => l.quote_id),
      ),
    [likes.data, identity?.id],
  );

  const list = (source.data || [])
    .filter(
      (x) =>
        (!memberId || x.member_id === memberId) &&
        (!bookId || x.book_id === bookId) &&
        (!currentOnly || ('status' in x && x.status === 'reading')) &&
        (!search ||
          `${x.title} ${'text' in x ? x.text : ''} ${'comment' in x ? x.comment : ''}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())) &&
        (quoteBook === 'all' || quoteBookKey(x) === quoteBook) &&
        (!likedOnly || (x.member_id !== identity?.id && myLikes.has(x.id))),
    )
    .sort(
      (a, b) =>
        (sort === 'likes' ? (likeCounts.get(b.id) || 0) - (likeCounts.get(a.id) || 0) : 0) ||
        b.updated_at.localeCompare(a.updated_at) ||
        a.id.localeCompare(b.id),
    );
  const author = (id: string) =>
    profiles.data?.find((x) => x.member_id === id)?.name || 'Участник клуба';
  if (source.isLoading || (type === 'quotes' && likes.isLoading)) return <Loading />;
  if (type === 'quotes' && likes.error) return <ErrorNote text={likes.error.message} />;
  return (
    <>
      <ErrorNote
        text={source.error?.message || (type === 'quotes' ? likes.error?.message : '') || error}
      />
      {!list.length ? (
        <Empty title="Пока нет публикаций" />
      ) : (
        <div className="quote-grid">
          {list.slice(0, limit ?? pageSize).map((item) => (
            <article key={item.id} className="quote-card">
              <PaperFragment className="quote-paper" />
              <Link className="author" to={`/members/${item.member_id}`}>
                {author(item.member_id)}
              </Link>
              {type !== 'quotes' &&
                (item.book_id ? (
                  <Link className="quote-source" to={`/club/${item.book_id}`}>
                    {item.title}
                  </Link>
                ) : (
                  <p className="quote-source">{item.title}</p>
                ))}
              {type === 'quotes'
                ? (() => {
                    const q = item as PublicQuote;
                    return (
                      <>
                        <blockquote>{q.text}</blockquote>
                        <SourceDisclosure
                          title={q.title}
                          bookId={q.book_id}
                          page={q.page}
                          chapter={q.chapter}
                          attribution={q.source_label}
                          savedFrom={q.source_author}
                        />
                        {q.comment && <p className="prewrap">{q.comment}</p>}
                        <div className="actions">
                          <ReactionButtons kind="quote" id={q.id} />
                          <DiscussionButton kind="quote" id={q.id} preview={q.text} />
                          {q.member_id !== identity?.id && (
                            <button
                              className="save-quote-action"
                              aria-label="Сохранить себе"
                              disabled={busy}
                              title="Копия останется у вас после удаления оригинала"
                              onClick={() =>
                                void run(
                                  () => copyPublicQuote(q, author(q.member_id)),
                                  'Независимая копия сохранена',
                                )
                              }
                            >
                              <BookmarkPlus size={18} />
                            </button>
                          )}
                        </div>
                      </>
                    );
                  })()
                : type === 'reviews'
                  ? (() => {
                      const r = item as PublicReview;
                      return (
                        <>
                          {r.rating !== null && (
                            <RatingStars value={r.rating} label="Оценка участника" />
                          )}
                          <div className="actions">
                            <ReactionButtons kind="review" id={r.id} />
                            <DiscussionButton kind="review" id={r.id} preview={r.text} />
                          </div>
                          {r.spoilers ? (
                            <details>
                              <summary>Показать отзыв со спойлерами</summary>
                              <p className="prewrap">{r.text}</p>
                            </details>
                          ) : (
                            <p className="prewrap">{r.text}</p>
                          )}
                        </>
                      );
                    })()
                  : (() => {
                      const p = item as PublicProgress;
                      return (
                        <>
                          {p.cover && <Cover small cover={p.cover} title={p.title} />}
                          <span className="badge">{personalStatuses[p.status]}</span>
                          {p.pages !== null && p.total_pages !== null ? (
                            <>
                              <div className="progress">
                                <i style={{ width: `${percent(p.pages, p.total_pages)}%` }} />
                              </div>
                              <p>
                                {p.pages} / {p.total_pages} стр. · {percent(p.pages, p.total_pages)}
                                %
                              </p>
                            </>
                          ) : (
                            <p className="hint">Прогресс скрыт участником</p>
                          )}
                        </>
                      );
                    })()}
              <small className="muted">{dateLabel(item.updated_at)}</small>
            </article>
          ))}
        </div>
      )}
      {!limit && list.length > pageSize && (
        <button className="load-more" onClick={() => setPageSize(pageSize + 24)}>
          Показать ещё · {list.length - pageSize}
        </button>
      )}
    </>
  );
}
export function Members() {
  const profiles = useCloud<Profile>('member_profiles');
  const [q, setQ] = useState('');
  const filtered = (profiles.data || []).filter((p) =>
    `${p.name} ${p.username || ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <>
      <div className="page-heading collage-page-heading">
        <div>
          <h1>Участники</h1>
        </div>
        <HeadingCollage scene="discussion" />
      </div>
      <CloudGate>
        {!!profiles.data?.length && (
          <SearchField
            className="full"
            label="Найти участника"
            placeholder="Имя или username"
            value={q}
            onChange={setQ}
          />
        )}
        <ErrorNote text={profiles.error?.message} />
        {profiles.isLoading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty title={q ? 'Никого не найдено' : 'Пока нет участников'} />
        ) : (
          <div className="member-list">
            {filtered.map((p) => (
              <Link to={`/members/${p.member_id}`} className="member-card" key={p.member_id}>
                <Avatar profile={p} />
                <div className="member-summary">
                  <h3>{p.name}</h3>
                  <ReadingAwards memberId={p.member_id} />
                  {p.username && <small>@{p.username}</small>}
                  {p.bio && <p>{p.bio}</p>}
                </div>
                <ChevronRight size={18} />
              </Link>
            ))}
          </div>
        )}
      </CloudGate>
    </>
  );
}
export function MemberDetail() {
  const { id } = useParams();
  const profiles = useCloud<Profile>('member_profiles');
  const quotes = useCloud<PublicQuote>('club_quotes');
  const reviews = useCloud<PublicReview>('club_reviews');
  const progress = useCloud<PublicProgress>('visible_progress');
  const [tab, setTab] = useState('progress');
  const p = profiles.data?.find((x) => x.member_id === id);
  const counts: [string, number][] = [
    [
      'прочитано',
      progress.data?.filter((x) => x.member_id === id && x.status === 'finished').length || 0,
    ],
    ['отзывов', reviews.data?.filter((x) => x.member_id === id).length || 0],
    ['цитат', quotes.data?.filter((x) => x.member_id === id).length || 0],
  ];
  if (profiles.isLoading) return <Loading />;
  if (!p)
    return (
      <CloudGate>
        <ErrorNote text={profiles.error?.message} />
        <Empty title="Участник не найден" />
      </CloudGate>
    );
  return (
    <CloudGate>
      <div className="profile-header">
        <PaperFrame />
        <PaperFragment className="avatar-paper" />
        <PaperTape className="avatar-tape" />
        <Avatar profile={p} />
        <div>
          <h1>{p.name}</h1>
          <ReadingAwards memberId={p.member_id} />
          {p.username && <p>@{p.username}</p>}
          {p.bio && <p>{p.bio}</p>}
          {p.genres && <p className="muted">{p.genres}</p>}
          <small>В клубе с {new Date(p.joined_at).toLocaleDateString('ru-RU')}</small>
        </div>
      </div>
      {counts.some(([, count]) => count > 0) && (
        <div className="stats">
          {counts
            .filter(([, count]) => count > 0)
            .map(([label, count]) => (
              <div key={label}>
                <b>{count}</b>
                <span>{label}</span>
              </div>
            ))}
        </div>
      )}
      <Achievements memberId={id!} />
      <PaperSelect
        label="В профиле"
        value={tab}
        onChange={setTab}
        options={[
          ['progress', 'Книги'],
          ['current', 'Сейчас читает'],
          ['quotes', 'Цитаты'],
          ['note', 'Заметки'],
          ['thought', 'Мысли'],
          ['reviews', 'Отзывы'],
        ].map(([value, label]) => ({ value, label }))}
      />
      {tab === 'note' || tab === 'thought' ? (
        <EntryFeed key={tab} kind={tab} memberId={id} />
      ) : (
        <PublicContent
          type={tab === 'current' ? 'progress' : (tab as 'quotes' | 'reviews' | 'progress')}
          memberId={id}
          currentOnly={tab === 'current'}
        />
      )}
    </CloudGate>
  );
}
