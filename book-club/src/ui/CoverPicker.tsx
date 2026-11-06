import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { prepareCover } from '../covers';
import { message } from '../domain';
import { Cover, ErrorNote } from './shared';
export function CoverPicker({
  title,
  cover,
  hasCustom,
  shared,
  onChange,
  onReset,
  onBusy,
}: {
  title: string;
  cover: string;
  hasCustom: boolean;
  shared: boolean;
  onChange: (data: string) => void;
  onReset: () => void;
  onBusy: (value: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    status = useRef(onBusy);
  status.current = onBusy;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(
    () => () => {
      generation.current++;
      status.current(false);
    },
    [],
  );
  return (
    <section className="cover-picker" aria-label="Моя обложка">
      <Cover title={title || 'Книга'} cover={cover} small />
      <div>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          <ImagePlus size={17} />
          {busy ? 'Готовим обложку…' : 'Изменить обложку'}
        </button>
        <input
          ref={input}
          className="file-input"
          aria-label="Выбрать обложку"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const current = ++generation.current;
            setBusy(true);
            status.current(true);
            setError('');
            try {
              const data = await prepareCover(file);
              if (current === generation.current) onChange(data);
            } catch (e) {
              if (current === generation.current) setError(message(e));
            } finally {
              if (current === generation.current) {
                setBusy(false);
                status.current(false);
              }
            }
          }}
        />
        {hasCustom && (
          <button className="text-button" type="button" disabled={busy} onClick={onReset}>
            Вернуть обложку книги
          </button>
        )}
        {shared && (
          <small className="muted">Эта обложка видна рядом с вашим прогрессом в клубе.</small>
        )}
        <ErrorNote text={error} />
      </div>
    </section>
  );
}
