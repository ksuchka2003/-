import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Settings2 } from 'lucide-react';
import {
  type ClubBook,
  type Proposal,
  type Reading,
  type Metadata,
  uid,
  clubStatuses,
} from '../domain';
import { action } from '../cloud';
import { CloudGate, Field, Modal, useCloud, useSession, useTask, ErrorNote, Empty } from './shared';
import { MetadataFields, BookLookup } from './Books';
import type { BookPoll } from './Polls';
function AdminBook({ book, onClose }: { book?: ClubBook; onClose: () => void }) {
  const [id] = useState(book?.id || uid());
  const [v, setV] = useState<Metadata>(
    book
      ? { ...book, totalPages: book.default_pages }
      : {
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
  const [status, setStatus] = useState(book?.status || 'planned');
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  return (
    <Modal title={book ? 'Книга клуба' : 'Добавить в клуб'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              await action('admin.book', { ...v, id, status });
              await query.invalidateQueries({ queryKey: ['cloud'] });
            })
          )
            onClose();
        }}
      >
        <BookLookup onSelect={setV} />
        <MetadataFields value={v} onChange={setV} />
        <Field label="Клубный статус">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {Object.entries(clubStatuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <ErrorNote text={error} />
        <footer>
          <button disabled={busy} className="primary">
            Сохранить
          </button>
          {book && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (
                  confirm(
                    'Удалить книгу клуба, публичные отзывы, цитаты, лайки и историю? Для сохранения истории выберите статус «Архив».',
                  )
                )
                  if (
                    await run(async () => {
                      await action('admin.delete_book', { id });
                      await query.invalidateQueries({ queryKey: ['cloud'] });
                    }, 'Книга удалена')
                  )
                    onClose();
              }}
            >
              Удалить из клуба
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
function ReviewProposal({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const polls = useCloud<BookPoll>('visible_book_polls');
  const poll = polls.data?.find((p) => p.id === proposal.id);
  const [v, setV] = useState(proposal.metadata);
  const [reason, setReason] = useState('');
  const { run, busy, error } = useTask();
  const q = useQueryClient();
  const send = async (approve: boolean) => {
    if (
      await run(
        async () => {
          await action('admin.proposal', { id: proposal.id, approve, metadata: v, reason });
          await q.invalidateQueries({ queryKey: ['cloud'] });
        },
        approve ? 'Книга одобрена' : 'Заявка отклонена',
      )
    )
      onClose();
  };
  return (
    <Modal title="Рассмотрение заявки" onClose={onClose}>
      {poll && (
        <p className="hint">
          Голосование: хотят читать {poll.yes_votes}, позже {poll.later_votes}, против{' '}
          {poll.no_votes}.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(true);
        }}
      >
        <MetadataFields value={v} onChange={setV} />
        <Field label="Причина отклонения">
          <textarea maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote text={error} />
        <footer>
          <button className="primary" disabled={busy}>
            Одобрить
          </button>
          <button
            className="danger"
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => void send(false)}
          >
            Отклонить
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function ReadingEditor({ reading, onClose }: { reading?: Reading; onClose: () => void }) {
  const books = useCloud<ClubBook>('club_books');
  const [v, setV] = useState<Reading>(
    reading || {
      id: uid(),
      book_id: '',
      starts_on: new Date().toISOString().slice(0, 10),
      ends_on: null,
      position: 0,
      status: 'active',
    },
  );
  const { run, busy, error } = useTask();
  const q = useQueryClient();
  return (
    <Modal title="Главная книга клуба" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              await action('admin.reading', v);
              await q.invalidateQueries({ queryKey: ['cloud'] });
            })
          )
            onClose();
        }}
      >
        <Field label="Книга">
          <select
            required
            disabled={!!reading}
            value={v.book_id}
            onChange={(e) => setV({ ...v, book_id: e.target.value })}
          >
            <option value="">Выбрать</option>
            {books.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Начало">
          <input
            type="date"
            required
            value={v.starts_on}
            onChange={(e) => setV({ ...v, starts_on: e.target.value })}
          />
        </Field>
        <Field label="Плановое окончание">
          <input
            type="date"
            min={v.starts_on}
            value={v.ends_on || ''}
            onChange={(e) => setV({ ...v, ends_on: e.target.value || null })}
          />
        </Field>
        <Field label="Порядок (меньше — выше)">
          <input
            type="number"
            required
            min="0"
            value={v.position}
            onChange={(e) => setV({ ...v, position: Number(e.target.value) })}
          />
        </Field>
        <Field label="Состояние чтения">
          <select
            value={v.status}
            onChange={(e) => setV({ ...v, status: e.target.value as Reading['status'] })}
          >
            <option value="active">Активная главная книга</option>
            <option value="finished">Чтение завершено</option>
            <option value="cancelled">Отменено</option>
          </select>
        </Field>
        <ErrorNote text={error} />
        <button disabled={busy} className="primary">
          Сохранить
        </button>
      </form>
    </Modal>
  );
}
export function Admin() {
  const { identity } = useSession();
  const books = useCloud<ClubBook>('club_books');
  const proposals = useCloud<Proposal>('book_proposals');
  const readings = useCloud<Reading>('club_readings');
  const members = useCloud<{
    id: string;
    name: string | null;
    username: string | null;
    role: string;
    active: boolean;
  }>('visible_club_members');
  const invites = useCloud<{
    id: string;
    expires_at: string;
    uses: number;
    max_uses: number;
    revoked: boolean;
  }>('visible_member_invites');
  const jobs = useCloud<{ id: string; status: string; kind: string; last_error: string }>(
    'notification_jobs',
  );
  const [tab, setTab] = useState('books');
  const [book, setBook] = useState<ClubBook | true | null>(null);
  const [reading, setReading] = useState<Reading | true | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [inviteUses, setInviteUses] = useState(1);
  const [inviteLink, setInviteLink] = useState('');
  const [bot, setBot] = useState<{ username: string; hasMainApp: boolean } | null>(null);
  const { run, busy, error } = useTask();
  const q = useQueryClient();
  if (identity?.role !== 'admin')
    return (
      <CloudGate>
        <Empty title="Раздел администратора" />
      </CloudGate>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">УПРАВЛЕНИЕ КЛУБОМ</p>
          <h1>Панель администратора</h1>
        </div>
        <Settings2 size={25} />
      </div>
      <div className="tabs">
        {[
          ['books', 'Каталог'],
          ['readings', 'Главные книги'],
          ['proposals', 'Заявки'],
          ['members', 'Доступ'],
          ['notifications', 'Уведомления'],
        ].map(([k, v]) => (
          <button className={tab === k ? 'active' : ''} onClick={() => setTab(k)} key={k}>
            {v}
          </button>
        ))}
      </div>
      <ErrorNote
        text={
          error ||
          books.error?.message ||
          proposals.error?.message ||
          members.error?.message ||
          jobs.error?.message
        }
      />
      {tab === 'books' && (
        <>
          <button className="primary" onClick={() => setBook(true)}>
            <Plus size={17} /> Добавить книгу
          </button>
          <div className="stack">
            {books.data?.map((b) => (
              <div className="proposal-row" key={b.id}>
                <div>
                  <h3>{b.title}</h3>
                  <small>
                    {b.authors} · {clubStatuses[b.status]}
                  </small>
                </div>
                <button onClick={() => setBook(b)}>Изменить</button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'readings' && (
        <>
          <p className="muted">
            Можно выбрать несколько книг. Завершённые чтения сохраняются в истории.
          </p>
          <button className="primary" onClick={() => setReading(true)}>
            Назначить главную книгу
          </button>
          <div className="stack">
            {[...(readings.data || [])]
              .sort((a, b) => a.position - b.position)
              .map((r) => (
                <div className="proposal-row" key={r.id}>
                  <div>
                    <h3>{books.data?.find((b) => b.id === r.book_id)?.title}</h3>
                    <p>
                      № {r.position} · {r.starts_on} → {r.ends_on || 'без даты'} ·{' '}
                      {
                        { active: 'Активна', finished: 'Завершена', cancelled: 'Отменена' }[
                          r.status
                        ]
                      }
                    </p>
                  </div>
                  <button onClick={() => setReading(r)}>Изменить</button>
                </div>
              ))}
          </div>
        </>
      )}
      {tab === 'proposals' && (
        <div className="stack">
          {proposals.data
            ?.filter((p) => p.status === 'pending')
            .map((p) => (
              <div className="proposal-row" key={p.id}>
                <div>
                  <h3>{p.metadata.title}</h3>
                  <p>{p.metadata.authors}</p>
                </div>
                <button onClick={() => setProposal(p)}>Рассмотреть</button>
              </div>
            ))}
        </div>
      )}
      {tab === 'members' && (
        <>
          <section className="panel invitation-panel">
            <h2>Пригласить участника</h2>
            <p className="muted">
              Человек откроет ссылку в Telegram и войдёт в клуб. ID вводить не нужно.
            </p>
            <Field label="Для кого приглашение">
              <select value={inviteUses} onChange={(e) => setInviteUses(Number(e.target.value))}>
                <option value={1}>Для одного человека</option>
                <option value={19}>Для группы — до 19 новых участников</option>
              </select>
            </Field>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const info = await action('admin.telegram', {});
                  setBot(info);
                  const invitation = await action('admin.invitation', { max_uses: inviteUses });
                  setInviteLink(`https://t.me/${info.username}?start=join_${invitation.token}`);
                  await q.invalidateQueries({ queryKey: ['cloud'] });
                }, 'Приглашение создано')
              }
            >
              Создать ссылку на 7 дней
            </button>
            {inviteLink && (
              <div className="invitation-result">
                <input
                  aria-label="Ссылка приглашения"
                  readOnly
                  value={inviteLink}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={() =>
                    void run(() => navigator.clipboard.writeText(inviteLink), 'Ссылка скопирована')
                  }
                >
                  Скопировать
                </button>
              </div>
            )}
            <div className="stack">
              {invites.data
                ?.filter(
                  (i) => !i.revoked && Date.parse(i.expires_at) > Date.now() && i.uses < i.max_uses,
                )
                .map((i) => (
                  <div className="proposal-row" key={i.id}>
                    <small>
                      Использовано {i.uses} из {i.max_uses} · до{' '}
                      {new Date(i.expires_at).toLocaleDateString('ru-RU')}
                    </small>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await action('admin.revoke_invite', { id: i.id });
                          await q.invalidateQueries({ queryKey: ['cloud'] });
                        }, 'Приглашение отозвано')
                      }
                    >
                      Отозвать
                    </button>
                  </div>
                ))}
            </div>
          </section>
          <section className="panel invitation-panel">
            <h2>Клуб в Telegram-группе</h2>
            <p className="muted">
              Добавьте бота в группу. Команда /club покажет кнопку входа в приложение.
            </p>
            {bot ? (
              <a
                className="button"
                href={`https://t.me/${bot.username}?startgroup=club`}
                target="_blank"
                rel="noreferrer"
              >
                Добавить бота в группу
              </a>
            ) : (
              <button
                disabled={busy}
                onClick={() => void run(async () => setBot(await action('admin.telegram', {})), '')}
              >
                Получить ссылку для группы
              </button>
            )}
          </section>
          <div className="stack">
            {members.data?.map((m) => (
              <div className="proposal-row" key={m.id}>
                <div>
                  <h3>{m.name || (m.active ? 'Новый участник' : 'Удалённый участник')}</h3>
                  <small>
                    {m.username ? `@${m.username} · ` : ''}
                    {m.role === 'admin' ? 'Администратор' : m.active ? 'Участник' : 'Доступ закрыт'}
                  </small>
                </div>
                {m.role !== 'admin' && (
                  <button
                    className={m.active ? 'danger' : ''}
                    disabled={busy}
                    onClick={() => {
                      if (
                        !m.active ||
                        confirm(
                          'Удалить участника из клуба? Доступ и публичный профиль будут закрыты. Его личная библиотека сохранится.',
                        )
                      )
                        void run(
                          async () => {
                            await action('admin.member', { id: m.id, active: !m.active });
                            await q.invalidateQueries({ queryKey: ['cloud'] });
                          },
                          m.active ? 'Участник удалён из клуба' : 'Участник восстановлен',
                        );
                    }}
                  >
                    {m.active ? 'Удалить из клуба' : 'Восстановить'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'notifications' && (
        <>
          <p>
            Последние задания. Доставка может задерживаться при остановке проекта или недоступности
            Telegram.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await action('admin.retry_notifications', {});
                await q.invalidateQueries({ queryKey: ['cloud'] });
              }, 'Ошибочные задания возвращены в очередь')
            }
          >
            Повторить неудачные отправки
          </button>
          {jobs.data?.map((j) => (
            <div className="proposal-row" key={j.id}>
              <span>
                {(
                  {
                    new: 'Новая встреча',
                    changed: 'Изменение',
                    cancelled: 'Отмена',
                    '24h': 'За 24 часа',
                    '1h': 'За час',
                  } as Record<string, string>
                )[j.kind] || 'Уведомление'}{' '}
                ·{' '}
                {(
                  {
                    pending: 'В очереди',
                    processing: 'Отправляется',
                    sent: 'Отправлено',
                    failed: 'Ошибка',
                    skipped: 'Пропущено',
                  } as Record<string, string>
                )[j.status] || 'Ожидает'}
              </span>
              <small>{j.last_error}</small>
            </div>
          ))}
        </>
      )}
      {book && <AdminBook book={book === true ? undefined : book} onClose={() => setBook(null)} />}
      {reading && (
        <ReadingEditor
          reading={reading === true ? undefined : reading}
          onClose={() => setReading(null)}
        />
      )}
      {proposal && <ReviewProposal proposal={proposal} onClose={() => setProposal(null)} />}
    </>
  );
}
