import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { action } from '../cloud';
import {
  uid,
  type Meeting,
  type MeetingQuestion,
  type MeetingReflection,
  type Profile,
} from '../domain';
import { meetingEnd } from '../collection';
import {
  Modal,
  Field,
  useCloud,
  useSession,
  useTask,
  ErrorNote,
  Loading,
  dateLabel,
} from './shared';
export function MeetingDiscussion({
  meeting,
  initialTab,
  onClose,
}: {
  meeting: Meeting;
  initialTab: 'questions' | 'reflections';
  onClose: () => void;
}) {
  const questions = useCloud<MeetingQuestion>('meeting_questions');
  const reflections = useCloud<MeetingReflection>('meeting_reflections');
  const people = useCloud<Profile>('member_profiles');
  const { identity } = useSession();
  const query = useQueryClient();
  const { run, busy, error } = useTask();
  const [tab, setTab] = useState(initialTab);
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<{ id: string; text: string; version: number }>({
    id: uid(),
    text: '',
    version: 1,
  });
  const mine = reflections.data?.find(
    (r) => r.meeting_id === meeting.id && r.member_id === identity?.id,
  );
  const [reflection, setReflection] = useState<
    Pick<MeetingReflection, 'id' | 'favorite_thought' | 'debate' | 'impression' | 'version'>
  >({ id: uid(), favorite_thought: '', debate: '', impression: '', version: 1 });
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty)
      setReflection(
        mine
          ? { ...mine }
          : { id: uid(), favorite_thought: '', debate: '', impression: '', version: 1 },
      );
  }, [mine?.id, mine?.version, dirty]);
  const canAsk = !meeting.cancelled && meetingEnd(meeting) > Date.now();
  const canReflect = !meeting.cancelled && meetingEnd(meeting) <= Date.now();
  const name = (id: string) =>
    people.data?.find((p) => p.member_id === id)?.name || 'Участник клуба';
  const change = async (actionName: string, data: unknown) =>
    run(async () => {
      await action(actionName, data);
      await query.invalidateQueries({ queryKey: ['cloud'] });
    });
  const items = (questions.data || [])
    .filter((q) => q.meeting_id === meeting.id)
    .sort(
      (a, b) => Number(a.answered) - Number(b.answered) || a.created_at.localeCompare(b.created_at),
    );
  const notes = (reflections.data || [])
    .filter((r) => r.meeting_id === meeting.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const source = tab === 'questions' ? questions : reflections;
  return (
    <Modal title={meeting.title} onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'questions' ? 'active' : ''} onClick={() => setTab('questions')}>
          Вопросы к встрече
        </button>
        <button
          className={tab === 'reflections' ? 'active' : ''}
          onClick={() => setTab('reflections')}
        >
          Итоги встречи
        </button>
      </div>
      <ErrorNote text={error || source.error?.message || people.error?.message} />
      {source.isLoading || people.isLoading ? (
        <Loading />
      ) : source.error || people.error ? null : tab === 'questions' ? (
        <>
          {!items.length && <p className="muted">Вопросов пока нет.</p>}
          <div className="discussion-list">
            {items.map((q) => (
              <article className="discussion-note" key={q.id}>
                <div className="section-title">
                  <b>{name(q.member_id)}</b>
                  {q.answered && <span className="badge">Обсудили</span>}
                </div>
                <p className="prewrap">{q.text}</p>
                <small className="muted">{dateLabel(q.created_at)}</small>
                <div className="actions">
                  {q.member_id === identity?.id && canAsk && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setDraft({ id: q.id, text: q.text, version: q.version });
                        input.current?.focus();
                      }}
                    >
                      Изменить вопрос
                    </button>
                  )}
                  {identity?.role === 'admin' && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void change('meeting.question.answered', {
                          id: q.id,
                          version: q.version,
                          answered: !q.answered,
                        })
                      }
                    >
                      {q.answered ? 'Вернуть к обсуждению' : 'Отметить обсуждённым'}
                    </button>
                  )}
                  {(q.member_id === identity?.id || identity?.role === 'admin') && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (confirm('Удалить этот вопрос?'))
                          void change('meeting.question.delete', { id: q.id });
                      }}
                    >
                      Удалить вопрос
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {canAsk && (
            <form
              className="discussion-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await change('meeting.question', { ...draft, meeting_id: meeting.id }))
                  setDraft({ id: uid(), text: '', version: 1 });
              }}
            >
              <Field label="Что хочется обсудить?">
                <textarea
                  ref={input}
                  required
                  maxLength={2000}
                  rows={3}
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
              </Field>
              <button className="primary" disabled={busy}>
                {items.some((q) => q.id === draft.id) ? 'Сохранить вопрос' : 'Добавить вопрос'}
              </button>
            </form>
          )}
        </>
      ) : (
        <>
          {!notes.length && <p className="muted">Итогов пока нет.</p>}
          <div className="discussion-list">
            {notes.map((r) => (
              <article className="discussion-note" key={r.id}>
                <b>{name(r.member_id)}</b>
                {(
                  [
                    ['favorite_thought', 'Запомнилось'],
                    ['debate', 'Обсуждали и спорили'],
                    ['impression', 'Впечатление'],
                  ] as const
                ).map(
                  ([key, label]) =>
                    r[key] && (
                      <div key={key}>
                        <h3>{label}</h3>
                        <p className="prewrap">{r[key]}</p>
                      </div>
                    ),
                )}
                <small className="muted">{dateLabel(r.updated_at)}</small>
                {(r.member_id === identity?.id || identity?.role === 'admin') && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm('Удалить эти итоги?'))
                        void change('meeting.reflection.delete', { id: r.id });
                    }}
                  >
                    Удалить итоги
                  </button>
                )}
              </article>
            ))}
          </div>
          {canReflect ? (
            <form
              className="discussion-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await change('meeting.reflection', { ...reflection, meeting_id: meeting.id }))
                  setDirty(false);
              }}
            >
              <h3>{mine ? 'Мои итоги' : 'Поделиться впечатлениями'}</h3>
              {(
                [
                  ['favorite_thought', 'Любимые мысли'],
                  ['debate', 'Спорные моменты'],
                  ['impression', 'Впечатление от встречи'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <textarea
                    rows={3}
                    maxLength={5000}
                    value={reflection[key]}
                    onChange={(e) => {
                      setDirty(true);
                      setReflection({ ...reflection, [key]: e.target.value });
                    }}
                  />
                </Field>
              ))}
              <button
                className="primary"
                disabled={
                  busy ||
                  ![reflection.favorite_thought, reflection.debate, reflection.impression].some(
                    (v) => v.trim(),
                  )
                }
              >
                Поделиться итогами
              </button>
              <p className="muted">Итоги видны участникам клуба.</p>
            </form>
          ) : (
            !meeting.cancelled && (
              <p className="muted">Добавить итоги можно после окончания встречи.</p>
            )
          )}
        </>
      )}
    </Modal>
  );
}
