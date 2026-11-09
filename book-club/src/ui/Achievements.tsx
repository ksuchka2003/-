import { useCloud, ErrorNote } from './shared';
type Achievement = {
  id: string;
  member_id: string;
  title: string;
  description: string;
  icon: string;
};
const icons: Record<string, string> = {
  quote: '📜',
  thought: '💭',
  note: '📝',
  heart: '☕',
  discussion: '🎲',
  book: '📚',
};
export function Achievements({ memberId }: { memberId: string }) {
  const data = useCloud<Achievement>('club_achievements');
  const own = data.data?.filter((a) => a.member_id === memberId) || [];
  return (
    <>
      <ErrorNote text={data.error?.message} />
      {!!own.length && (
        <details className="achievement-collection">
          <summary>Достижения · {own.length}</summary>
          <div className="achievement-grid">
            {own.map((a) => (
              <article key={a.id}>
                <span aria-hidden="true">{icons[a.icon] || '🏅'}</span>
                <div>
                  <b>{a.title}</b>
                  <small>{a.description}</small>
                </div>
              </article>
            ))}
          </div>
          <small className="muted">По публикациям в клубе. Личные записи не учитываются.</small>
        </details>
      )}
    </>
  );
}
