import { ContentSection } from './ContentSection';
import type { Participation } from '../readerDomain';
import type { Reading } from '../domain';
import { useState } from 'react';
import type { Participant } from '../calendar';
import { Link } from 'react-router-dom';
import { type Profile, type PublicProgress, percent, personalStatuses } from '../domain';
import { Avatar } from './Social';
import { useCloud, Modal, ErrorNote, Loading, Cover } from './shared';
import { ReadingAwards } from './ReadingAwards';
export function BookReaders({ bookId, title }: { bookId: string; title: string }) {
  const progress = useCloud<PublicProgress>('visible_progress');
  const people = useCloud<Profile>('member_profiles');
  const members = useCloud<Participant>('meeting_participants');
  const [selected, setSelected] = useState<Profile | null>(null);
  const decisions = useCloud<Participation>('visible_reading_participation'),
    readings = useCloud<Reading>('club_readings');
  const cycle = readings.data
    ?.filter((r) => r.book_id === bookId)
    .sort(
      (a, b) =>
        Number(b.status === 'active') - Number(a.status === 'active') ||
        b.starts_on.localeCompare(a.starts_on),
    )[0];
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
            const decision = decisions.data?.find(
              (d) => d.reading_id === cycle?.id && d.member_id === person.member_id,
            );
            const known = Number.isFinite(p?.pages) && !!p?.total_pages;
            return (
              <button
                key={person.member_id}
                className="reader-row"
                onClick={() => {
                  setSelected(person);
                }}
                aria-label={`Чтение ${person.name}: ${title}`}
              >
                <Avatar profile={person} />
                {p?.cover && <Cover small title={title} cover={p.cover} />}
                <span className="reader-body">
                  <b>{person.name}</b>
                  <ReadingAwards memberId={person.member_id} bookId={bookId} />
                  <small>
                    {decision?.choice === 'declined'
                      ? 'Не будет читать'
                      : decision?.choice === 'already_read'
                        ? 'Уже читал до клуба'
                        : p
                          ? personalStatuses[p.status]
                          : 'Ещё не выбрал участие'}
                  </small>
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
                  ) : p ? (
                    <small>Страницы не указаны</small>
                  ) : null}
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
          <ContentSection bookId={bookId} memberId={selected.member_id} />
        </Modal>
      )}
    </section>
  );
}
