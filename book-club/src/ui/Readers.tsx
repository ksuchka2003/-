import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type Profile, type PublicProgress, percent, personalStatuses } from '../domain';
import { Avatar, PublicContent } from './Social';
import { useCloud, Modal, ErrorNote, Loading } from './shared';
export function BookReaders({ bookId, title }: { bookId: string; title: string }) {
  const progress = useCloud<PublicProgress>('visible_progress');
  const people = useCloud<Profile>('member_profiles');
  const [selected, setSelected] = useState<Profile | null>(null);
  const [tab, setTab] = useState<'quotes' | 'reviews'>('quotes');
  const readers = (progress.data || [])
    .filter((p) => p.book_id === bookId)
    .sort((a, b) =>
      (people.data?.find((p) => p.member_id === a.member_id)?.name || '').localeCompare(
        people.data?.find((p) => p.member_id === b.member_id)?.name || '',
        'ru',
      ),
    );
  return (
    <section className="book-readers" aria-label={`Прогресс участников: ${title}`}>
      <h3>Читают участники</h3>
      <ErrorNote text={progress.error?.message || people.error?.message} />
      {progress.isLoading || people.isLoading ? (
        <Loading />
      ) : (
        !progress.error &&
        !people.error &&
        (!readers.length ? (
          <p className="muted">Пока никто не добавил книгу на свою полку.</p>
        ) : (
          readers.map((p) => {
            const person = people.data?.find((x) => x.member_id === p.member_id);
            return (
              <button
                key={p.id}
                className="reader-row"
                disabled={!person}
                onClick={() => {
                  setSelected(person || null);
                  setTab('quotes');
                }}
                aria-label={`Чтение ${person?.name || 'участника'}: ${title}`}
              >
                {person && <Avatar profile={person} />}
                <span className="reader-body">
                  <b>{person?.name || 'Участник'}</b>
                  <small>{personalStatuses[p.status]}</small>
                  {p.total_pages && p.pages !== null ? (
                    <>
                      <span className="progress">
                        <i style={{ width: percent(p.pages, p.total_pages) + '%' }} />
                      </span>
                      <small>
                        {p.pages} / {p.total_pages} стр. · {percent(p.pages, p.total_pages)}%
                      </small>
                    </>
                  ) : (
                    <small>Объём издания не указан</small>
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
              Комментарии и отзывы
            </button>
          </div>
          <PublicContent type={tab} memberId={selected.member_id} bookId={bookId} />
        </Modal>
      )}
    </section>
  );
}
