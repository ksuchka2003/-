import { useState } from 'react';
import type { Participant } from '../calendar';
import { Link } from 'react-router-dom';
import { type Profile, type PublicProgress, percent, personalStatuses } from '../domain';
import { Avatar, PublicContent } from './Social';
import { useCloud, Modal, ErrorNote, Loading, Cover } from './shared';
import { ReadingAwards } from './ReadingAwards';
export function BookReaders({ bookId, title }: { bookId: string; title: string }) {
  const progress = useCloud<PublicProgress>('visible_progress');
  const people = useCloud<Profile>('member_profiles');
  const members = useCloud<Participant>('meeting_participants');
  const [selected, setSelected] = useState<Profile | null>(null);
  const [tab, setTab] = useState<'quotes' | 'reviews'>('quotes');
  const profiles = members.data?.length
    ? members.data.map(
        (m) =>
          people.data?.find((p) => p.member_id === m.member_id) || {
            member_id: m.member_id,
            name: m.name,
            username: null,
            avatar_url: null,
            bio: '',
            genres: '',
            joined_at: '',
          },
      )
    : people.data || [];
  const readers = [...profiles].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return (
    <section className="book-readers" aria-label={`Прогресс участников: ${title}`}>
      <h3>Как читаем</h3>
      <ErrorNote
        text={progress.error?.message || people.error?.message || members.error?.message}
      />
      {progress.isLoading || people.isLoading || members.isLoading ? (
        <Loading />
      ) : (
        !progress.error &&
        !people.error &&
        (!readers.length ? (
          <p className="muted">Пока нет участников.</p>
        ) : (
          readers.map((person) => {
            const p = progress.data?.find(
              (p) => p.book_id === bookId && p.member_id === person.member_id,
            );
            const known = Number.isFinite(p?.pages) && !!p?.total_pages;
            return (
              <button
                key={person.member_id}
                className="reader-row"
                onClick={() => {
                  setSelected(person);
                  setTab('quotes');
                }}
                aria-label={`Чтение ${person.name}: ${title}`}
              >
                <Avatar profile={person} />
                {p?.cover && <Cover small title={title} cover={p.cover} />}
                <span className="reader-body">
                  <b>{person.name}</b>
                  <ReadingAwards memberId={person.member_id} bookId={bookId} />
                  <small>{p ? personalStatuses[p.status] : 'Нет отметки о чтении'}</small>
                  {p && <small>{p.chapter ? `Глава: ${p.chapter}` : 'Глава не указана'}</small>}
                  {known && p ? (
                    <>
                      <span className="progress">
                        <i style={{ width: percent(p.pages!, p.total_pages!) + '%' }} />
                      </span>
                      <small>
                        {p.pages} / {p.total_pages} стр. · {percent(p.pages!, p.total_pages!)}%
                      </small>
                    </>
                  ) : (
                    <small>Страницы не указаны</small>
                  )}
                </span>
              </button>
            );
          })
        ))
      )}
      {selected && (
        <Modal title={`${selected.name} · ${title}`} onClose={() => setSelected(null)}>
          <Link
            className="author"
            to={`/members/${selected.member_id}`}
            onClick={() => setSelected(null)}
          >
            Профиль участника →
          </Link>
          <div className="tabs">
            <button className={tab === 'quotes' ? 'active' : ''} onClick={() => setTab('quotes')}>
              Цитаты
            </button>
            <button className={tab === 'reviews' ? 'active' : ''} onClick={() => setTab('reviews')}>
              Мысли по прочитанному
            </button>
          </div>
          <PublicContent
            type={tab}
            memberId={selected.member_id}
            bookId={bookId}
            sort={tab === 'quotes' ? 'likes' : 'newest'}
          />
        </Modal>
      )}
    </section>
  );
}
