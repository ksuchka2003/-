import {
  createContext,
  useContext,
  useState,
  useId,
  useEffect,
  useRef,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, LoaderCircle, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { type Identity, rows } from '../cloud';
import { message } from '../domain';
export const Session = createContext<{
  identity: Identity | null;
  error: string;
  notify: (s: string) => void;
  retryLogin?: () => void;
}>({ identity: null, error: '', notify: () => {} });
export const useSession = () => useContext(Session);
export function confirmClose(changed: boolean, onClose: () => void) {
  if (!changed || confirm('Изменения не сохранены. Закрыть без сохранения?')) onClose();
}
export function useCloud<T>(table: string, enabled = true) {
  const { identity } = useSession();
  return useQuery({
    queryKey: ['cloud', identity?.id, table],
    queryFn: () => rows<T>(table, identity?.id),
    enabled: !!identity && enabled,
    networkMode: 'always',
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
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const section = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    section.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (
        [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1) !==
        section.current
      )
        return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      }
      if (e.key !== 'Tab') return;
      const nodes = [
        ...(section.current?.querySelectorAll<HTMLElement>(
          'button,a[href],input,select,textarea,summary',
        ) || []),
      ].filter((n) => !n.hasAttribute('disabled') && n.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === section.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={section}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <button type="button" className="icon modal-back" aria-label="Назад" onClick={onClose}>
            <ArrowLeft size={21} />
          </button>
          <h2>{title}</h2>
          {actions}
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
export function SearchField({
  label,
  value,
  onChange,
  placeholder = 'Название или автор',
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`search search-field ${className}`}>
      <Search size={18} aria-hidden="true" />
      <input
        ref={input}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="Очистить поиск"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
}
export function BackLink({ fallback }: { fallback: string }) {
  const navigate = useNavigate();
  return (
    <button
      className="detail-back"
      type="button"
      aria-label="Назад"
      onClick={() => {
        if (Number(window.history.state?.idx) > 0) navigate(-1);
        else navigate(fallback, { replace: true });
      }}
    >
      <ArrowLeft size={21} />
    </button>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <BookOpen size={32} aria-hidden="true" />
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
  return identity ? <>{children}</> : <Empty title="Войдите через Telegram" />;
}
export function Loading({ label = 'Загружаем библиотеку…' }: { label?: string } = {}) {
  return (
    <div role="status" className="skeleton">
      <LoaderCircle className="spin" /> {label}
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
          key={cover}
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

export function useClock() {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return clock;
}
