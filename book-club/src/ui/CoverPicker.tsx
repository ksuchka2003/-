import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Search } from 'lucide-react';
import { prepareCover } from '../covers';
import { message, type Metadata } from '../domain';
import { searchBooks } from '../bookSearch';
import { Cover, ErrorNote, Field } from './shared';
function InternetCover({
  title,
  authors,
  onSelect,
}: {
  title: string;
  authors: string;
  onSelect: (url: string) => void;
}) {
  const [q, setQ] = useState(title),
    [url, setUrl] = useState(''),
    [items, setItems] = useState<Metadata[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [searched, setSearched] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const search = async () => {
    const own = ++generation.current;
    setBusy(true);
    setError('');
    setSearched(false);
    try {
      const results = await searchBooks(q);
      if (own === generation.current) {
        setItems(
          results.filter(
            (item, i, all) => item.cover && all.findIndex((b) => b.cover === item.cover) === i,
          ),
        );
        setSearched(true);
      }
    } catch (e) {
      if (own === generation.current) setError(message(e));
    } finally {
      if (own === generation.current) setBusy(false);
    }
  };
  return (
    <div className="internet-cover">
      <Field label="Поиск обложки">
        <input
          maxLength={200}
          value={q}
          placeholder={authors || 'Название или автор'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
        />
      </Field>
      <button type="button" disabled={busy || q.trim().length < 2} onClick={() => void search()}>
        <Search size={16} />
        {busy ? 'Ищем…' : 'Найти обложки'}
      </button>
      <div className="cover-options">
        {items.map((b) => (
          <button
            type="button"
            key={b.cover}
            aria-label={`Выбрать: ${b.title}, ${b.authors}`}
            onClick={() => onSelect(b.cover)}
          >
            <Cover title={b.title} cover={b.cover} />
            <small>{b.authors}</small>
          </button>
        ))}
      </div>
      {searched && !items.length && (
        <p className="muted">
          Обложки не найдены. Попробуйте другое название или вставьте ссылку на картинку.
        </p>
      )}
      <Field label="Ссылка на картинку">
        <input
          type="url"
          value={url}
          placeholder="https://…"
          maxLength={2048}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <button
        type="button"
        disabled={!url.trim()}
        onClick={() => {
          try {
            const parsed = new URL(url.trim());
            if (parsed.protocol !== 'https:') throw new Error();
            onSelect(parsed.href);
            setError('');
          } catch {
            setError('Нужна полная HTTPS-ссылка на картинку.');
          }
        }}
      >
        Использовать ссылку
      </button>
      <ErrorNote text={error} />
    </div>
  );
}
export function CoverPicker({
  title,
  authors,
  cover,
  hasCustom,
  shared,
  onChange,
  onUrl,
  onReset,
  onBusy,
}: {
  title: string;
  authors: string;
  cover: string;
  hasCustom: boolean;
  shared: boolean;
  onChange: (data: string) => void;
  onUrl: (url: string) => void;
  onReset: () => void;
  onBusy: (value: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    status = useRef(onBusy);
  status.current = onBusy;
  const [busy, setBusy] = useState(false),
    [internet, setInternet] = useState(false),
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
        <button
          type="button"
          disabled={busy}
          aria-expanded={internet}
          onClick={() => setInternet(!internet)}
        >
          <Search size={17} />
          Из интернета
        </button>
        {internet && (
          <InternetCover
            title={title}
            authors={authors}
            onSelect={(url) => {
              onUrl(url);
              setInternet(false);
            }}
          />
        )}
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
