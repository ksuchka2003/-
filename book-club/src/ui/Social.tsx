import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Heart, BookmarkPlus, Users } from 'lucide-react';
import {
  type Profile,
  type PublicQuote,
  type PublicReview,
  type PublicProgress,
  personalStatuses,
  percent,
} from '../domain';
import { action } from '../cloud';
import { copyPublicQuote } from '../local';
import {
  useCloud,
  CloudGate,
  Empty,
  Loading,
  ErrorNote,
  useTask,
  useSession,
  dateLabel,
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
}: {
  type: 'quotes' | 'reviews' | 'progress';
  memberId?: string;
  bookId?: string;
  currentOnly?: boolean;
}) {
  const quotes = useCloud<PublicQuote>('public_quotes');
  const reviews = useCloud<PublicReview>('visible_reviews');
  const progress = useCloud<PublicProgress>('visible_progress');
  const profiles = useCloud<Profile>('member_profiles');
  const likes = useCloud<{ quote_id: string; member_id: string }>('quote_likes');
  const { identity } = useSession();
  const { run, error, busy } = useTask();
  const query = useQueryClient();
  const source = type === 'quotes' ? quotes : type === 'reviews' ? reviews : progress;
  const list = (source.data || [])
    .filter(
      (x) =>
        (!memberId || x.member_id === memberId) &&
        (!bookId || x.book_id === bookId) &&
        (!currentOnly || ('status' in x && x.status === 'reading')),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const author = (id: string) =>
    profiles.data?.find((x) => x.member_id === id)?.name || 'Участник клуба';
  if (source.isLoading) return <Loading />;
  return (
    <>
      <ErrorNote text={source.error?.message || error} />
      {!list.length ? (
        <Empty title="Пока нет публикаций">
          Здесь появляются только данные, которыми участники решили поделиться.
        </Empty>
      ) : (
        <div className="quote-grid">
          {list.map((item) => (
            <article key={item.id} className="quote-card">
              <Link className="author" to={`/members/${item.member_id}`}>
                {author(item.member_id)}
              </Link>
              <Link className="quote-source" to={`/club/${item.book_id}`}>
                {item.title}
              </Link>
              {type === 'quotes'
                ? (() => {
                    const q = item as PublicQuote;
                    const liked = likes.data?.some(
                      (l) => l.quote_id === q.id && l.member_id === identity?.id,
                    );
                    return (
                      <>
                        <blockquote>{q.text}</blockquote>
                        <p className="muted">
                          {q.page !== null ? `Страница ${q.page}` : ''} {q.chapter}
                        </p>
                        {q.comment && <p>{q.comment}</p>}
                        <div className="actions">
                          <button
                            className={liked ? 'liked' : ''}
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await action('like', { quote_id: q.id, liked: !liked });
                                await query.invalidateQueries({ queryKey: ['cloud'] });
                              }, '')
                            }
                          >
                            <Heart size={17} fill={liked ? 'currentColor' : 'none'} />{' '}
                            {likes.data?.filter((l) => l.quote_id === q.id).length || 0}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => copyPublicQuote(q, author(q.member_id)),
                                'Независимая копия сохранена',
                              )
                            }
                          >
                            <BookmarkPlus size={17} /> Себе
                          </button>
                        </div>
                      </>
                    );
                  })()
                : type === 'reviews'
                  ? (() => {
                      const r = item as PublicReview;
                      return (
                        <>
                          {r.rating !== null && <span className="rating">{r.rating}/10</span>}
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
    </>
  );
}
export function Members() {
  const profiles = useCloud<Profile>('member_profiles');
  const [q, setQ] = useState('');
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ЛЮДИ И ИСТОРИИ</p>
          <h1>Наш круг</h1>
        </div>
        <Users size={25} />
      </div>
      <CloudGate>
        <input
          className="full"
          aria-label="Найти участника"
          placeholder="Имя или username"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ErrorNote text={profiles.error?.message} />
        {profiles.isLoading ? (
          <Loading />
        ) : (
          <div className="member-grid">
            {profiles.data
              ?.filter((p) =>
                `${p.name} ${p.username || ''}`.toLowerCase().includes(q.toLowerCase()),
              )
              .map((p) => (
                <Link to={`/members/${p.member_id}`} className="member-card" key={p.member_id}>
                  <Avatar profile={p} />
                  <h3>{p.name}</h3>
                  <small>{p.username ? `@${p.username}` : 'Участник клуба'}</small>
                  <p>{p.bio || 'У каждой книги есть свой читатель.'}</p>
                  <span className="badge">{p.genres || 'Открыт новым историям'}</span>
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
  const quotes = useCloud<PublicQuote>('public_quotes');
  const reviews = useCloud<PublicReview>('visible_reviews');
  const progress = useCloud<PublicProgress>('visible_progress');
  const [tab, setTab] = useState('progress');
  const p = profiles.data?.find((x) => x.member_id === id);
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
      <Link className="back" to="/members">
        ← Участники
      </Link>
      <div className="profile-header">
        <Avatar profile={p} />
        <div>
          <h1>{p.name}</h1>
          {p.username && <p>@{p.username}</p>}
          <p>{p.bio}</p>
          <p className="muted">{p.genres}</p>
          <small>В клубе с {new Date(p.joined_at).toLocaleDateString('ru-RU')}</small>
        </div>
      </div>
      <div className="stats">
        <div>
          <b>
            {progress.data?.filter((x) => x.member_id === id && x.status === 'finished').length ||
              0}
          </b>
          <span>публично прочитано</span>
        </div>
        <div>
          <b>{reviews.data?.filter((x) => x.member_id === id).length || 0}</b>
          <span>отзывов</span>
        </div>
        <div>
          <b>{quotes.data?.filter((x) => x.member_id === id).length || 0}</b>
          <span>цитат</span>
        </div>
      </div>
      <div className="tabs">
        {[
          ['progress', 'Книги'],
          ['current', 'Сейчас читает'],
          ['reviews', 'Отзывы'],
          ['quotes', 'Цитаты'],
        ].map(([k, v]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>
      <PublicContent
        type={tab === 'current' ? 'progress' : (tab as 'quotes' | 'reviews' | 'progress')}
        memberId={id}
        currentOnly={tab === 'current'}
      />
    </CloudGate>
  );
}
