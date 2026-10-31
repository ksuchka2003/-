import { useQueryClient } from '@tanstack/react-query';
import type { Metadata } from '../domain';
import { action } from '../cloud';
import { Cover, useCloud, useSession, useTask, ErrorNote } from './shared';
export type BookPoll = {
  id: string;
  metadata: Metadata;
  closed_at: string | null;
  participants: number;
  yes_votes: number;
  later_votes: number;
  no_votes: number;
  my_choice: string | null;
};
export function BookPolls() {
  const polls = useCloud<BookPoll>('visible_book_polls');
  const { identity } = useSession();
  const { busy, error, run } = useTask();
  const query = useQueryClient();
  const active = (polls.data || []).filter((p) => !p.closed_at);
  if (!active.length) return <ErrorNote text={polls.error?.message} />;
  return (
    <section className="polls-section" aria-label="Голосования за книги">
      <h2>Выбираем следующую книгу</h2>
      <ErrorNote text={error || polls.error?.message} />
      {active.map((p) => (
        <article className="poll-card" key={p.id}>
          <div className="poll-heading">
            <Cover small title={p.metadata.title} cover={p.metadata.cover} />
            <div>
              <h3>{p.metadata.title}</h3>
              <p className="muted">{p.metadata.authors}</p>
            </div>
          </div>
          <div className="poll-choices">
            {(
              [
                ['yes', 'Хочу читать', p.yes_votes],
                ['later', 'Позже', p.later_votes],
                ['no', 'Не хочу', p.no_votes],
              ] as const
            ).map(([choice, label, count]) => (
              <button
                key={choice}
                className={p.my_choice === choice ? 'selected' : ''}
                aria-pressed={p.my_choice === choice}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await action('poll.vote', {
                      id: p.id,
                      choice: p.my_choice === choice ? null : choice,
                    });
                    await query.invalidateQueries({ queryKey: ['cloud'] });
                  }, 'Голос учтён')
                }
              >
                <span>{label}</span>
                <b>{count}</b>
              </button>
            ))}
          </div>
          <div className="poll-footer">
            <small>
              Проголосовали {Number(p.yes_votes) + Number(p.later_votes) + Number(p.no_votes)} из{' '}
              {p.participants}
            </small>
            {identity?.role === 'admin' && (
              <button
                disabled={busy}
                onClick={() => {
                  if (confirm('Завершить голосование? Результаты сохранятся.'))
                    void run(async () => {
                      await action('admin.close_poll', { id: p.id });
                      await query.invalidateQueries({ queryKey: ['cloud'] });
                    }, 'Голосование завершено');
                }}
              >
                Завершить
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
