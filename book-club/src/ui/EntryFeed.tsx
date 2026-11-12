import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Profile } from '../domain';
import type { ClubEntry, Reaction } from '../readerDomain';
import { useCloud, ErrorNote, Loading, dateLabel } from './shared';
import { ReactionButtons, DiscussionButton, SourceDisclosure } from './SocialActions';
export function EntryFeed({
  kind,
  memberId,
  bookId,
  limit,
  sort = 'newest',
}: {
  kind: 'note' | 'thought';
  memberId?: string;
  bookId?: string;
  limit?: number;
  sort?: 'newest' | 'likes';
}) {
  const source = useCloud<ClubEntry>('club_entries'),
    profiles = useCloud<Profile>('member_profiles'),
    reactions = useCloud<Reaction>('content_reactions');
  const [size, setSize] = useState(20);
  const likes = (id: string) =>
    (reactions.data || []).filter(
      (r) => r.target_kind === kind && r.target_id === id && r.value === 1,
    ).length;
  const items = (source.data || [])
    .filter(
      (e) =>
        e.kind === kind &&
        (!memberId || e.member_id === memberId) &&
        (!bookId || e.book_id === bookId),
    )
    .sort(
      (a, b) =>
        (sort === 'likes' ? likes(b.id) - likes(a.id) : 0) ||
        b.created_at.localeCompare(a.created_at),
    );
  if (source.isLoading) return <Loading label="Загружаем записи…" />;
  if (source.error) return <ErrorNote text={source.error.message} />;
  if (!items.length)
    return (
      <p className="quiet-empty">
        {kind === 'note' ? 'Пока нет опубликованных заметок.' : 'Пока нет опубликованных мыслей.'}
      </p>
    );
  return (
    <>
      <div className="quote-grid">
        {items.slice(0, limit || size).map((e) => (
          <article className="quote-card entry-card" key={e.id}>
            <PaperFragment className="quote-paper" ruled />
            <Link className="author" to={`/members/${e.member_id}`}>
              {profiles.data?.find((p) => p.member_id === e.member_id)?.name || 'Участник клуба'}
            </Link>
            <span className="badge">{kind === 'note' ? 'Заметка' : 'Мысль'}</span>
            <p className="prewrap entry-text">{e.text}</p>
            <SourceDisclosure
              title={e.title}
              bookId={e.book_id}
              page={e.page}
              chapter={e.chapter}
            />
            <small className="muted">{dateLabel(e.created_at)}</small>
            <div className="actions">
              <ReactionButtons kind={kind} id={e.id} />
              <DiscussionButton kind={kind} id={e.id} preview={e.text} />
            </div>
            <PaletteMotif className="quote-corner-motif" />
          </article>
        ))}
      </div>
      {!limit && items.length > size && (
        <button className="load-more" onClick={() => setSize((v) => v + 20)}>
          Показать ещё
        </button>
      )}
    </>
  );
}
import { PaperFragment } from './EditorialArt';
import { PaletteMotif } from './PaletteMotif';
