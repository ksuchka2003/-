import { Star } from 'lucide-react';
import { useId } from 'react';
const label = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / 2);
export function RatingStars({
  value,
  onChange,
  label: caption = 'Моя оценка',
}: {
  value: number | null;
  onChange?: (value: number | null) => void;
  label?: string;
}) {
  const id = useId(),
    number = value === null ? 0 : Number(value);
  const stars = (
    <span className="rating-stars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span className="rating-star" key={i}>
          <Star />
          <span style={{ width: `${Math.max(0, Math.min(1, number / 2 - i)) * 100}%` }}>
            <Star fill="currentColor" />
          </span>
        </span>
      ))}
    </span>
  );
  if (!onChange)
    return (
      <span className="rating-display" aria-label={`${caption}: ${label(number)} из 5`}>
        {stars}
        <small>{label(number)} / 5</small>
      </span>
    );
  return (
    <div className="rating-input">
      <span id={id} className="rating-caption">
        {caption}
      </span>
      <div
        className="rating-control"
        role="slider"
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={number / 2}
        aria-valuetext={value === null ? 'Без оценки' : `${label(number)} из 5`}
        tabIndex={0}
        onKeyDown={(e) => {
          let next: number | null | undefined;
          if (['ArrowRight', 'ArrowUp'].includes(e.key)) next = Math.min(10, number + 1);
          if (['ArrowLeft', 'ArrowDown'].includes(e.key)) next = number > 1 ? number - 1 : null;
          if (e.key === 'Home') next = 1;
          if (e.key === 'End') next = 10;
          if (e.key === 'Delete' || e.key === 'Backspace') next = null;
          if (next !== undefined) {
            e.preventDefault();
            onChange(next);
          }
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-label={`Поставить ${i + 1} из 5`}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const half = e.detail > 0 && e.clientX - rect.left < rect.width / 2;
              onChange(i * 2 + (half ? 1 : 2));
            }}
          >
            <span className="rating-star" aria-hidden="true">
              <Star />
              <span style={{ width: `${Math.max(0, Math.min(1, number / 2 - i)) * 100}%` }}>
                <Star fill="currentColor" />
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="rating-value">
        <small>{value === null ? 'Без оценки' : `${label(number)} / 5`}</small>
        {value !== null && (
          <button type="button" className="text-button" onClick={() => onChange(null)}>
            Убрать оценку
          </button>
        )}
      </div>
    </div>
  );
}
