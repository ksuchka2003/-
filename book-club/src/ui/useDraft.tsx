import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { getDB } from '../db';

// Drafts stay on this device, in the account's own database, outside the sync/export settings.
export function useDraft<T extends object>(name: string, initial: T | null) {
  const db = useRef(getDB()).current;
  const key = '_draft:' + name;
  const [value, update] = useState<T | null>(null);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState('');
  const seed = useRef<T | null>(null);
  const saved = useRef('');
  const stopped = useRef(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!initial) return;
    let active = true;
    seed.current = initial;
    saved.current = JSON.stringify(initial);
    void db.settings
      .get(key)
      .then((record) => {
        if (!active) return;
        const draft = record?.value as T | undefined;
        const usable =
          draft &&
          typeof draft === 'object' &&
          Object.keys(initial).every((field) => Object.hasOwn(draft, field));
        update(usable ? draft : initial);
        setRestored(!!usable);
      })
      .catch(() => {
        if (active) {
          update(initial);
          setError('Не удалось прочитать черновик');
        }
      });
    return () => {
      active = false;
    };
  }, [key, initial, db]);
  useEffect(() => {
    if (!value || stopped.current) return;
    writes.current = writes.current
      .then(async () => {
        if (stopped.current) return;
        if (JSON.stringify(value) === saved.current) await db.settings.delete(key);
        else await db.settings.put({ key, value });
        setError('');
      })
      .catch(() => setError('Черновик не удалось сохранить. Не закрывайте форму до сохранения.'));
  }, [value, key, db]);
  const clear = async () => {
    stopped.current = true;
    await writes.current;
    await db.settings.delete(key);
  };
  return {
    value,
    restored,
    error,
    setValue(next: SetStateAction<T>) {
      update((old) =>
        old ? (typeof next === 'function' ? (next as (v: T) => T)(old) : next) : old,
      );
    },
    clear,
    async discard() {
      stopped.current = true;
      await writes.current;
      await db.settings.delete(key);
      update(seed.current);
      setRestored(false);
      setError('');
      stopped.current = false;
    },
  };
}
export function DraftNote({
  draft,
}: {
  draft: { restored: boolean; error: string; discard: () => Promise<void> };
}) {
  return (
    <>
      {draft.restored && (
        <p className="draft-note">
          Черновик восстановлен{' '}
          <button
            type="button"
            onClick={() => {
              if (confirm('Сбросить несохранённые изменения?')) void draft.discard();
            }}
          >
            Сбросить
          </button>
        </p>
      )}
      {draft.error && <p role="alert">{draft.error}</p>}
    </>
  );
}
