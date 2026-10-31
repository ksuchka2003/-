import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload, ShieldCheck, RefreshCw, Settings2 } from 'lucide-react';
import { getDB, LibraryDB } from '../db';
import {
  type Profile as ProfileData,
  type Privacy,
  type Proposal,
  defaultPrivacy,
  privacySchema,
} from '../domain';
import { queue } from '../local';
import { action, rows } from '../cloud';
import { accountSync } from '../accountSync';
import type { LibrarySyncState, LibraryConflict, LibraryRecord } from '../privateTypes';
import { downloadBackup, importBackup, parseBackup, exportBackup } from '../backup';
import { useCloud, useSession, Field, useTask, ErrorNote, Modal, dateLabel } from './shared';
import { ProposalEditor } from './Club';
const labels: Record<keyof Privacy, string> = {
  show_finished: 'Прочитанные книги',
  show_current: 'Текущие книги',
  show_progress: 'Прогресс',
  show_ratings: 'Оценки',
  show_reviews: 'Отзывы',
  show_quotes: 'Цитаты',
};
function EditProfile({ profile, onClose }: { profile: ProfileData; onClose: () => void }) {
  const [p, setP] = useState(profile);
  const { run, busy, error } = useTask();
  const q = useQueryClient();
  return (
    <Modal title="Редактировать профиль" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(async () => {
              await action('profile', p);
              await q.invalidateQueries({ queryKey: ['cloud'] });
            })
          )
            onClose();
        }}
      >
        <Field label="Имя">
          <input
            required
            maxLength={200}
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
          />
        </Field>
        <Field label="О себе">
          <textarea
            maxLength={2000}
            value={p.bio}
            onChange={(e) => setP({ ...p, bio: e.target.value })}
          />
        </Field>
        <Field label="Любимые жанры">
          <input
            maxLength={500}
            value={p.genres}
            onChange={(e) => setP({ ...p, genres: e.target.value })}
          />
        </Field>
        <ErrorNote text={error} />
        <button disabled={busy} className="primary">
          Сохранить
        </button>
      </form>
    </Modal>
  );
}
function conflictLabel(c: LibraryConflict) {
  return String(
    c.local?.title ||
      c.cloud.payload?.title ||
      c.local?.text ||
      c.cloud.payload?.text ||
      {
        book: 'Книга',
        progress: 'Прогресс чтения',
        review: 'Отзыв',
        quote: 'Цитата',
        setting: 'Настройка',
      }[c.kind],
  ).slice(0, 120);
}
export function Profile() {
  const { identity, retryLogin } = useSession();
  const profiles = useCloud<ProfileData>('member_profiles');
  const privacy = useCloud<Privacy & { member_id: string }>('member_privacy_settings');
  const proposals = useCloud<Proposal>('book_proposals');
  const pending = useLiveQuery(() => getDB().sync_queue.toArray()) || [];
  const conflicts = useLiveQuery(() => getDB().private_conflicts.toArray()) || [];
  const status = useLiveQuery(() => getDB().settings.get('_librarySync'))?.value as
    LibrarySyncState | undefined;
  const [edit, setEdit] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [file, setFile] = useState<{ raw: string; count: number } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [localCount, setLocalCount] = useState(0);
  const { run, busy, error } = useTask();
  const p = profiles.data?.find((x) => x.member_id === identity?.id);
  const pendingPrivacy = pending.find(
    (x) => x.kind === 'privacy' && x.scope === identity?.id,
  )?.payload;
  const confirmed = privacy.data?.[0];
  const desired = { ...defaultPrivacy, ...confirmed, ...pendingPrivacy };
  useEffect(() => {
    if (confirmed && !pendingPrivacy)
      void getDB().settings.put({ key: 'privacy', value: privacySchema.parse(confirmed) });
  }, [confirmed, pendingPrivacy]);
  useEffect(() => {
    let active = true;
    if (identity) {
      const source = new LibraryDB('bookclub-local');
      (async () => {
        try {
          if (!(await getDB().settings.get('_migratedLocal'))) {
            const count = await source.personal_books.count();
            if (active) setLocalCount(count);
          }
        } finally {
          source.close();
        }
      })().catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [identity?.id]);
  async function sync() {
    await accountSync().sync();
    const state = (await getDB().settings.get('_librarySync'))?.value as LibrarySyncState;
    if (state?.phase === 'error') throw new Error(state.error);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Мой профиль</h1>
        </div>
        <ShieldCheck size={26} />
      </div>
      <ErrorNote text={error || profiles.error?.message || privacy.error?.message} />
      <div className="settings-grid">
        <section className="panel">
          <h2>{p?.name || 'Личная библиотека'}</h2>
          {identity ? (
            <>
              <p className="muted">
                {identity.role === 'admin' ? 'Администратор' : 'Участник'} · Вход через Telegram
              </p>
              {identity.telegramId && (
                <p>
                  Telegram ID: <code>{identity.telegramId}</code>
                </p>
              )}
              {p?.bio && <p>{p.bio}</p>}
              {p?.genres && <p className="muted">{p.genres}</p>}
              {p && <button onClick={() => setEdit(true)}>Редактировать профиль</button>}
              {identity.role === 'admin' ? (
                <Link className="primary admin-entry" to="/admin">
                  <Settings2 size={17} /> Управление клубом
                </Link>
              ) : (
                <details>
                  <summary>Как стать администратором</summary>
                  <p>
                    Владелец проекта Supabase должен добавить в Edge Functions → Secrets секрет{' '}
                    <code>INITIAL_ADMIN_TELEGRAM_ID</code> со значением вашего Telegram ID
                    {identity.telegramId ? ` (${identity.telegramId})` : ''}. После этого повторите
                    вход.
                  </p>
                </details>
              )}
              <button className="text-button" onClick={retryLogin}>
                Обновить вход и права
              </button>
            </>
          ) : (
            <>
              <p>Вы не вошли в клуб. Данные сохраняются только на этом устройстве.</p>
              {retryLogin && (
                <button className="primary" onClick={retryLogin}>
                  Войти через Telegram
                </button>
              )}
            </>
          )}
        </section>
        {identity && (
          <section className="panel">
            <h2>Синхронизация</h2>
            <p>
              {status?.phase === 'error'
                ? 'Не удалось синхронизировать библиотеку'
                : status?.phase === 'offline'
                  ? 'Изменения сохранятся после подключения'
                  : status?.phase === 'syncing'
                    ? 'Синхронизация…'
                    : status?.lastSynced
                      ? `Обновлено ${dateLabel(status.lastSynced)}`
                      : 'Подключаем библиотеку…'}
            </p>
            <p className="muted">
              Личная библиотека доступна на ваших устройствах. Её видите только вы.
            </p>
            <button
              disabled={busy || status?.phase === 'syncing'}
              onClick={() => void run(sync, '')}
            >
              <RefreshCw size={16} /> Синхронизировать
            </button>
          </section>
        )}
        {localCount > 0 && (
          <section className="panel">
            <h2>Книги с этого устройства</h2>
            <p>
              В прежней локальной библиотеке: {localCount}. Перенести их в ваш Telegram-аккаунт?
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const source = new LibraryDB('bookclub-local');
                  try {
                    await importBackup(JSON.stringify(await exportBackup(source)), 'merge');
                    await getDB().settings.put({ key: '_migratedLocal', value: true });
                    setLocalCount(0);
                    await sync();
                  } finally {
                    source.close();
                  }
                }, 'Книги перенесены')
              }
            >
              Перенести в мой аккаунт
            </button>
          </section>
        )}
        <section className="panel">
          <h2>Резервная копия</h2>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void run(downloadBackup, 'Файл экспорта подготовлен')}
            >
              <Download size={17} /> Экспорт JSON
            </button>
            <label className="button">
              <Upload size={17} /> Импорт JSON
              <input
                className="file-input"
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  e.target.value = '';
                  if (selected)
                    void run(async () => {
                      if (selected.size > 20 * 1024 * 1024)
                        throw new Error('Максимальный размер 20 МБ');
                      const raw = await selected.text();
                      setFile({ raw, count: parseBackup(raw).books.length });
                    }, '');
                }}
              />
            </label>
          </div>
        </section>
        {identity && (
          <section className="panel">
            <h2>Что видно в клубе</h2>
            {Object.entries(labels).map(([k, label]) => (
              <label className="toggle" key={k}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  disabled={busy || privacy.isLoading || !!privacy.error}
                  checked={Boolean(desired[k as keyof Privacy])}
                  onChange={(e) =>
                    void run(async () => {
                      await getDB().transaction(
                        'rw',
                        [getDB().settings, getDB().sync_queue],
                        async () => {
                          const previous = await getDB().sync_queue.get(`privacy:${identity.id}`);
                          await queue('privacy', identity.id, {
                            ...previous?.payload,
                            [k]: e.target.checked,
                          });
                        },
                      );
                    }, '')
                  }
                />
              </label>
            ))}
            {pendingPrivacy && <p className="notice">Изменения ещё не подтверждены сервером.</p>}
          </section>
        )}
      </div>
      {identity && conflicts.length > 0 && (
        <section className="panel conflict-panel">
          <h2>Изменения с двух устройств</h2>
          <p>Для этих записей сохранены обе версии. Выберите, какую оставить.</p>
          {conflicts.map((c) => (
            <article className="conflict-row" key={c.key}>
              <h3>{conflictLabel(c)}</h3>
              {c.related && <p>Выбор применится к книге и её связанным записям.</p>}
              <div className="conflict-options">
                <div>
                  <b>На этом устройстве</b>
                  <p>
                    {c.local
                      ? String(
                          c.local.notes ||
                            c.local.text ||
                            c.local.pages ||
                            c.local.title ||
                            'Изменённая запись',
                        ).slice(0, 200)
                      : 'Запись удалена'}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        c.related &&
                        !confirm(
                          'Использовать версию книги и всех связанных записей с этого устройства?',
                        )
                      )
                        return;
                      void run(() => accountSync().resolve(c.key, 'local'), 'Версия выбрана');
                    }}
                  >
                    Оставить эту версию
                  </button>
                </div>
                <div>
                  <b>С другого устройства</b>
                  <p>
                    {c.cloud.payload
                      ? String(
                          c.cloud.payload.notes ||
                            c.cloud.payload.text ||
                            c.cloud.payload.pages ||
                            c.cloud.payload.title ||
                            'Изменённая запись',
                        ).slice(0, 200)
                      : 'Запись удалена'}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        c.related &&
                        !confirm(
                          'Использовать версию книги и всех связанных записей с другого устройства?',
                        )
                      )
                        return;
                      if (
                        !c.related &&
                        c.kind === 'book' &&
                        !c.cloud.payload &&
                        !confirm('Удалить книгу и её локальные записи, как на другом устройстве?')
                      )
                        return;
                      void run(() => accountSync().resolve(c.key, 'cloud'), 'Версия выбрана');
                    }}
                  >
                    Использовать эту версию
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
      {identity && (
        <>
          {(proposals.data || []).some((x) => x.member_id === identity?.id) && (
            <>
              <div className="section-title">
                <h2>Мои предложения</h2>
              </div>
              {proposals.data
                ?.filter((x) => x.member_id === identity?.id)
                .map((x) => (
                  <article className="proposal-row" key={x.id}>
                    <div>
                      <h3>{x.metadata.title}</h3>
                      <span className="badge">
                        {
                          {
                            draft: 'Черновик',
                            pending: 'На рассмотрении',
                            approved: 'Одобрено',
                            rejected: 'Отклонено',
                          }[x.status]
                        }
                      </span>
                      {x.reason && <p>{x.reason}</p>}
                    </div>
                    {['draft', 'rejected'].includes(x.status) && (
                      <button onClick={() => setProposal(x)}>Редактировать</button>
                    )}
                  </article>
                ))}
            </>
          )}
        </>
      )}
      {p && edit && <EditProfile profile={p} onClose={() => setEdit(false)} />}
      {proposal && <ProposalEditor existing={proposal} onClose={() => setProposal(null)} />}
      {file && (
        <Modal title="Импорт резервной копии" onClose={() => setFile(null)}>
          <p>В файле {file.count} книг.</p>
          <Field label="Режим импорта">
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="merge">Объединить</option>
              <option value="replace">Полностью заменить личные данные</option>
            </select>
          </Field>
          {mode === 'replace' && (
            <p className="error">
              Текущая библиотека будет заменена на всех ваших устройствах после синхронизации.
              Сначала сделайте экспорт.
            </p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              if (
                mode === 'replace' &&
                !confirm(
                  'Полностью заменить текущие книги, заметки, отзывы и цитаты? Изменения синхронизируются на все устройства.',
                )
              )
                return;
              if (
                await run(async () => {
                  const cloudRecords =
                    identity && mode === 'replace'
                      ? await rows<LibraryRecord>('private_library_records', identity.id)
                      : undefined;
                  await importBackup(file.raw, mode, cloudRecords);
                }, 'Данные импортированы')
              )
                setFile(null);
            }}
          >
            Импортировать
          </button>
          <ErrorNote text={error} />
        </Modal>
      )}
    </>
  );
}
