import { Bookmark, BookOpen, CheckCheck, Pause, Library } from 'lucide-react';
import { personalStatuses, type Book } from '../domain';
const icons = { planned: Bookmark, reading: BookOpen, finished: CheckCheck, paused: Pause };
export function ReadingStatus({
  value,
  onChange,
  filter = false,
}: {
  value: string;
  onChange: (value: Book['status'] | 'all' | 'unfinished') => void;
  filter?: boolean;
}) {
  const entries = filter
    ? { all: 'Все', ...personalStatuses, unfinished: 'Не прочитано' }
    : personalStatuses;
  return (
    <div
      className="reading-status"
      role="group"
      aria-label={filter ? 'Фильтр статуса' : 'Личный статус'}
    >
      {Object.entries(entries).map(([key, label]) => {
        const Icon = icons[key as Book['status']] || Library;
        return (
          <button
            type="button"
            key={key}
            className={value === key ? 'selected' : ''}
            aria-pressed={value === key}
            onClick={() => onChange(key as Book['status'])}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
