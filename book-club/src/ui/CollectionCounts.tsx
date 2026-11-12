export function CollectionCounts({
  counts,
  selected,
  onSelect,
}: {
  counts: { total: number; finished: number; unfinished: number; reading?: number };
  selected: string;
  onSelect: (value: string) => void;
}) {
  const entries: [string, string, number][] = [
    ['all', 'В коллекции', counts.total],
    ['finished', 'Прочитано', counts.finished],
    ...(counts.reading === undefined
      ? []
      : [['reading', 'Читаю', counts.reading] as [string, string, number]]),
  ];
  return (
    <div
      className={`collection-counts ${counts.reading === undefined ? 'club-counts' : ''}`}
      aria-label="Книги в коллекции"
    >
      {entries.map(([key, label, count]) => (
        <button
          key={key}
          className={selected === key ? 'selected' : ''}
          aria-pressed={selected === key}
          onClick={() => onSelect(key)}
        >
          <b>{count}</b>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
