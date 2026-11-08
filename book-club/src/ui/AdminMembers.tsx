import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus, ChevronRight } from 'lucide-react';
import { action } from '../cloud';
import { Field, Modal, useCloud, useTask, ErrorNote, Empty, Loading } from './shared';

export type ManagedMember = {
  id: string;
  name: string | null;
  username: string | null;
  role: string;
  active: boolean;
};
type Invite = { id: string; expires_at: string; uses: number; max_uses: number; revoked: boolean };

function Invitation({ onClose }: { onClose: () => void }) {
  const [uses, setUses] = useState(1);
  const [link, setLink] = useState('');
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  return (
    <Modal title="Пригласить участника" onClose={onClose}>
      {link ? (
        <>
          <p className="form-context">Отправьте ссылку в Telegram. Она действует 7 дней.</p>
          <Field label="Ссылка приглашения">
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </Field>
          <button
            className="primary"
            onClick={() =>
              void run(() => navigator.clipboard.writeText(link), 'Ссылка скопирована')
            }
          >
            Скопировать ссылку
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const info = await action('admin.telegram', {});
              const invitation = await action('admin.invitation', { max_uses: uses });
              setLink(`https://t.me/${info.username}?start=join_${invitation.token}`);
              await query.invalidateQueries({ queryKey: ['cloud'] });
            }, 'Приглашение создано');
          }}
        >
          <p className="form-context">Новый участник войдёт по ссылке. Telegram ID не нужен.</p>
          <Field label="Кому доступна ссылка">
            <select value={uses} onChange={(e) => setUses(Number(e.target.value))}>
              <option value={1}>Одному человеку</option>
              <option value={19}>До 19 новых участников</option>
            </select>
          </Field>
          <footer>
            <button className="primary" disabled={busy}>
              Создать приглашение
            </button>
          </footer>
        </form>
      )}
      <ErrorNote text={error} />
    </Modal>
  );
}

function MemberAccess({ member, onClose }: { member: ManagedMember; onClose: () => void }) {
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  return (
    <Modal title="Доступ участника" onClose={onClose}>
      <div className="member-access-summary">
        <h3>{member.name || 'Участник клуба'}</h3>
        {member.username && <p className="muted">@{member.username}</p>}
        <span className="badge">{member.active ? 'В клубе' : 'Доступ закрыт'}</span>
      </div>
      {member.role === 'admin' ? (
        <p className="section-hint">Права администратора задаются в серверных настройках клуба.</p>
      ) : (
        <>
          <p className="form-context">
            {member.active
              ? 'Закрытие доступа скроет профиль и публикации. Личная библиотека участника сохранится.'
              : 'Восстановите доступ, чтобы участник снова мог войти в клуб.'}
          </p>
          <button
            className={member.active ? 'danger' : 'primary'}
            disabled={busy}
            onClick={async () => {
              if (
                member.active &&
                !confirm(
                  `Закрыть доступ для ${member.name || 'участника'}? Личная библиотека сохранится.`,
                )
              )
                return;
              if (
                await run(
                  async () => {
                    await action('admin.member', { id: member.id, active: !member.active });
                    await query.invalidateQueries({ queryKey: ['cloud'] });
                  },
                  member.active ? 'Доступ закрыт' : 'Участник восстановлен',
                )
              )
                onClose();
            }}
          >
            {member.active ? 'Закрыть доступ' : 'Восстановить доступ'}
          </button>
        </>
      )}
      <ErrorNote text={error} />
    </Modal>
  );
}

export function AdminMembers() {
  const members = useCloud<ManagedMember>('visible_club_members');
  const invites = useCloud<Invite>('visible_member_invites');
  const [search, setSearch] = useState('');
  const [removed, setRemoved] = useState(false);
  const [invite, setInvite] = useState(false);
  const [selected, setSelected] = useState<ManagedMember | null>(null);
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const activeInvites = (invites.data || []).filter(
    (i) => !i.revoked && Date.parse(i.expires_at) > Date.now() && i.uses < i.max_uses,
  );
  const listed = (members.data || [])
    .filter(
      (m) =>
        m.active !== removed &&
        `${m.name || ''} ${m.username || ''}`
          .toLocaleLowerCase('ru')
          .includes(search.trim().replace(/^@/, '').toLocaleLowerCase('ru')),
    )
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  return (
    <>
      <div className="section-actions">
        <button className="primary" onClick={() => setInvite(true)}>
          <UserPlus size={18} />
          Пригласить участника
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Доступ участников">
        <button aria-pressed={!removed} onClick={() => setRemoved(false)}>
          В клубе
        </button>
        <button aria-pressed={removed} onClick={() => setRemoved(true)}>
          Доступ закрыт
        </button>
      </div>
      <label className="search admin-search">
        <Search size={18} />
        <input
          aria-label="Поиск участников в управлении"
          placeholder="Имя или username"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <ErrorNote text={error || members.error?.message || invites.error?.message} />
      {members.isLoading ? (
        <Loading label="Загружаем участников…" />
      ) : (
        !members.error &&
        (!listed.length ? (
          <Empty
            title={
              search ? 'Никого не нашли' : removed ? 'Закрытых доступов нет' : 'Участников пока нет'
            }
          />
        ) : (
          <div className="stack admin-list">
            {listed.map((m) => (
              <button
                className="management-row"
                key={m.id}
                aria-label={`Участник: ${m.name || m.username || 'Без имени'}`}
                onClick={() => setSelected(m)}
              >
                <span className="member-initial" aria-hidden="true">
                  {(m.name || m.username || '?').slice(0, 1).toLocaleUpperCase('ru')}
                </span>
                <span>
                  <b>{m.name || m.username || 'Участник клуба'}</b>
                  <small>
                    {m.role === 'admin'
                      ? 'Администратор'
                      : m.username
                        ? `@${m.username}`
                        : 'Участник'}
                  </small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        ))
      )}
      {activeInvites.length > 0 && (
        <details className="book-extra admin-history">
          <summary>Действующие приглашения · {activeInvites.length}</summary>
          <div className="stack admin-list">
            {activeInvites.map((i) => (
              <div className="management-row invite-row" key={i.id}>
                <span>
                  <b>
                    Использовано {i.uses} из {i.max_uses}
                  </b>
                  <small>До {new Date(i.expires_at).toLocaleDateString('ru-RU')}</small>
                </span>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (!confirm('Отозвать приглашение? По этой ссылке больше нельзя будет войти.'))
                      return;
                    void run(async () => {
                      await action('admin.revoke_invite', { id: i.id });
                      await query.invalidateQueries({ queryKey: ['cloud'] });
                    }, 'Приглашение отозвано');
                  }}
                >
                  Отозвать
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
      {invite && <Invitation onClose={() => setInvite(false)} />}
      {selected && <MemberAccess member={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
