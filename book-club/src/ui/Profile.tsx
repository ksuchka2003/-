import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload, ShieldCheck, LockKeyhole } from 'lucide-react';
import { getDB } from '../db';
import {
  type Profile as ProfileData,
  type Privacy,
  type Proposal,
  defaultPrivacy,
  privacySchema,
} from '../domain';
import { queue } from '../local';
import { action } from '../cloud';
import { downloadBackup, importBackup, parseBackup } from '../backup';
import { useCloud, useSession, Field, useTask, ErrorNote, CloudGate, Modal } from './shared';
import { ProposalEditor } from './Club';
const labels: Record<keyof Privacy, string> = {
  show_finished: 'Показывать прочитанные книги',
  show_current: 'Показывать текущие книги',
  show_progress: 'Показывать прогресс',
  show_ratings: 'Показывать оценки',
  show_reviews: 'Показывать отзывы',
  show_quotes: 'Показывать цитаты',
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
export function Profile() {
  const { identity } = useSession();
  const profiles = useCloud<ProfileData>('member_profiles');
  const privacy = useCloud<Privacy & { member_id: string }>('member_privacy_settings');
  const proposals = useCloud<Proposal>('book_proposals');
  const local = useLiveQuery(() => getDB().settings.get('privacy'));
  const pending = useLiveQuery(() => getDB().sync_queue.toArray()) || [];
  const [edit, setEdit] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [file, setFile] = useState<{ raw: string; count: number } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const { run, busy, error } = useTask();
  const p = profiles.data?.find((x) => x.member_id === identity?.id);
  const desired = local ? privacySchema.parse(local.value) : privacy.data?.[0] || defaultPrivacy;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ВАШЕ МЕСТО В КЛУБЕ</p>
          <h1>Мой профиль</h1>
        </div>
        <ShieldCheck size={26} />
      </div>
      <ErrorNote text={error || profiles.error?.message || privacy.error?.message} />
      <div className="settings-grid">
        <section className="panel">
          <h2>{p?.name || 'Личная библиотека'}</h2>
          <p className="muted">
            {identity
              ? identity.role === 'admin'
                ? 'Администратор клуба'
                : 'Участник клуба'
              : 'Локальный режим'}
          </p>
          {p && (
            <>
              <p>{p.bio}</p>
              <button onClick={() => setEdit(true)}>Редактировать профиль</button>
            </>
          )}
          <p className="hint">
            <LockKeyhole size={15} /> Заметки и приватные записи остаются на устройстве. Облачного
            резервного копирования личных данных нет.
          </p>
        </section>
        <section className="panel">
          <h2>Резервная копия</h2>
          <p className="muted">
            JSON хранит книги, отзывы, прогресс, заметки, цитаты, избранное, корзину и настройки.
            Сохраните файл в надёжном месте.
          </p>
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
                      const parsed = parseBackup(raw);
                      setFile({ raw, count: parsed.books.length });
                    }, '');
                }}
              />
            </label>
          </div>
        </section>
        <section className="panel">
          <h2>Приватность</h2>
          <CloudGate>
            <p className="muted">
              Эти разрешения действуют на сервере. Для публикации также нужен отдельный выбор в
              книге или цитате.
            </p>
            {Object.entries(labels).map(([k, label]) => (
              <label className="toggle" key={k}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  disabled={busy || privacy.isLoading}
                  checked={desired[k as keyof Privacy]}
                  onChange={(e) =>
                    void run(async () => {
                      const next = { ...desired, [k]: e.target.checked };
                      await getDB().transaction(
                        'rw',
                        [getDB().settings, getDB().sync_queue],
                        async () => {
                          await getDB().settings.put({ key: 'privacy', value: next });
                          await queue('privacy', identity!.id, next);
                        },
                      );
                    }, 'Изменение поставлено в очередь')
                  }
                />
              </label>
            ))}
            {pending.some((x) => x.kind === 'privacy') && (
              <p className="notice">
                Изменения приватности ещё не подтверждены сервером. Ранее опубликованные данные
                могут быть видны до синхронизации.
              </p>
            )}
          </CloudGate>
        </section>
        <section className="panel">
          <h2>Оформление</h2>
          <p className="muted">Тема следует настройкам Telegram; в браузере — системной теме.</p>
          <p>
            Приватный клуб · до 20 участников
            <br />
            Без рекламы и платных подписок
          </p>
        </section>
      </div>
      <CloudGate>
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
      </CloudGate>
      {p && edit && <EditProfile profile={p} onClose={() => setEdit(false)} />}
      {proposal && <ProposalEditor existing={proposal} onClose={() => setProposal(null)} />}
      {file && (
        <Modal title="Импорт резервной копии" onClose={() => setFile(null)}>
          <p>В файле {file.count} книг. Импорт не публикует данные в клуб.</p>
          <Field label="Режим импорта">
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="merge">Объединить, сохранить существующие UUID</option>
              <option value="replace">Полностью заменить личные данные</option>
            </select>
          </Field>
          {mode === 'replace' && (
            <p className="error">
              Все текущие личные данные будут удалены. Сначала сделайте экспорт. Удаление публичных
              копий отправится при синхронизации.
            </p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              if (
                mode === 'replace' &&
                !confirm(
                  'Полностью заменить текущие книги, заметки, отзывы и цитаты данными файла? Это нельзя отменить.',
                )
              )
                return;
              if (await run(() => importBackup(file.raw, mode), 'Данные импортированы'))
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
