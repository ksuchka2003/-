import {
  createContext,
  useContext,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, BookOpen, LoaderCircle } from 'lucide-react';
import { type Identity, rows } from '../cloud';
import { message } from '../domain';
export const Session = createContext<{
  identity: Identity | null;
  error: string;
  notify: (s: string) => void;
}>({ identity: null, error: '', notify: () => {} });
export const useSession = () => useContext(Session);
export function useCloud<T>(table: string) {
  const { identity } = useSession();
  return useQuery({
    queryKey: ['cloud', identity?.id, table],
    queryFn: () => rows<T>(table),
    enabled: !!identity,
  });
}
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { notify } = useSession();
  const run = async (fn: () => Promise<unknown>, success = 'Сохранено') => {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (success) notify(success);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Закрыть" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ 'aria-labelledby'?: string }>, {
            'aria-labelledby': id,
          })
        : children}
    </label>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <BookOpen size={32} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function ErrorNote({ text }: { text?: string }) {
  return text ? (
    <p className="error" role="alert">
      {text}
    </p>
  ) : null;
}
export function CloudGate({ children }: { children: ReactNode }) {
  const { identity, error } = useSession();
  return identity ? (
    <>{children}</>
  ) : (
    <Empty title="Клуб по приглашению">
      {error ||
        'Подключите Supabase по README и откройте приложение в Telegram. Личная библиотека уже работает на этом устройстве.'}
    </Empty>
  );
}
export function Loading() {
  return (
    <div role="status" className="skeleton">
      <LoaderCircle className="spin" /> Загружаем библиотеку…
    </div>
  );
}
export function Cover({
  cover,
  title,
  small = false,
}: {
  cover: string;
  title: string;
  small?: boolean;
}) {
  return (
    <div className={`cover ${small ? 'small' : ''}`}>
      {cover ? (
        <img
          src={cover}
          alt={`Обложка: ${title}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
      <span>{title.slice(0, 80)}</span>
      <i>МЕЖДУ СТРОК</i>
    </div>
  );
}
export const dateLabel = (v: string) =>
  new Date(v).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
export function submit(handler: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    handler();
  };
}
