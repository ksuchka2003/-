import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { getDB } from '../db';
import { ChevronDown } from 'lucide-react';

// Drafts stay on this device, in the account's own database, outside the sync/export settings.
export function useDraft<T extends object>(name: string, initial: T | null) {
  const db = useRef(getDB()).current;
  const key = '_draft:' + name;
  const [value, update] = useState<T | null>(initial);
  const [restored, setRestored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const seed = useRef<T | null>(null);
  const saved = useRef('');
  const stopped = useRef(false);
  const edited = useRef(false);
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
        if (!edited.current) update(usable ? draft : initial);
        setRestored(!!usable && !edited.current);
        setLoaded(true);
      })
      .catch(() => {
        if (active) {
          update(initial);
          setError('Не удалось прочитать черновик');
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [key, initial, db]);
  useEffect(() => {
    if (!value || !loaded || stopped.current) return;
    writes.current = writes.current
      .then(async () => {
        if (stopped.current) return;
        if (JSON.stringify(value) === saved.current) await db.settings.delete(key);
        else await db.settings.put({ key, value });
        setError('');
      })
      .catch(() => setError('Черновик не удалось сохранить. Не закрывайте форму до сохранения.'));
  }, [value, key, db, loaded]);
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
      edited.current = true;
      update((old) =>
        old ? (typeof next === 'function' ? (next as (v: T) => T)(old) : next) : old,
      );
    },
    clear,
    async keep() {
      await writes.current;
      if (value) await db.settings.put({ key, value });
    },
    async reset(next: T) {
      await clear();
      seed.current = next;
      saved.current = JSON.stringify(next);
      update(next);
      setRestored(false);
      edited.current = false;
      stopped.current = false;
    },
    async discard() {
      stopped.current = true;
      await writes.current;
      await db.settings.delete(key);
      update(seed.current);
      setRestored(false);
      setError('');
      stopped.current = false;
      edited.current = false;
    },
  };
}
export function DraftNote({
  draft,
  onLeave,
}: {
  draft: {
    restored: boolean;
    error: string;
    discard: () => Promise<void>;
    keep: () => Promise<void>;
  };
  onLeave?: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <>
      <details className="draft-tools">
        <summary>
          <span>{draft.restored ? 'Черновик восстановлен' : 'Черновик'}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <p>Только у меня, на этом устройстве. В клуб попадёт после сохранения формы.</p>
        <div className="actions">
          <button
            type="button"
            onClick={async (e) => {
              const close = e.currentTarget
                .closest('[role=dialog]')
                ?.querySelector<HTMLButtonElement>('.modal-back');
              try {
                await draft.keep();
                setError('');
                if (onLeave) onLeave();
                else close?.click();
              } catch {
                setError('Не удалось сохранить черновик. Попробуйте ещё раз.');
              }
            }}
          >
            Оставить черновик
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Очистить черновик? Несохранённые изменения будут сброшены.'))
                void draft.discard().catch(() => setError('Не удалось очистить черновик'));
            }}
          >
            Очистить черновик
          </button>
        </div>
      </details>
      {(draft.error || error) && <p role="alert">{draft.error || error}</p>}
    </>
  );
}

export function useDraftForm<T extends object>(name: string, initial: T) {
  const [seed] = useState(initial);
  const draft = useDraft(name, seed);
  return [draft.value || seed, draft.setValue, draft] as const;
}
