import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, PenLine } from 'lucide-react';
import { getDB } from '../db';
import { searchBooks } from '../bookSearch';
import { bookSearchKey } from '../quoteBooks';
import { bookCover } from '../covers';
import { catalogMetadata, resolveBookChoice, sameBook } from '../bookMatches';
import type { Book, ClubBook, Metadata } from '../domain';
import { Cover, ErrorNote, Field } from './shared';
export function BookFinder({
  catalog,
  onSelect,
  onExisting,
  onManual,
}: {
  catalog: ClubBook[];
  onSelect: (metadata: Metadata, clubId: string | null) => void;
  onExisting: (book: Book) => void;
  onManual: (title: string) => void;
}) {
  const books = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const [q, setQ] = useState(''),
    [retry, setRetry] = useState(0);
  const [results, setResults] = useState<Metadata[]>([]);
  const [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false),
    [error, setError] = useState('');
  const key = bookSearchKey(q);
  const matches = (title: string, authors: string) =>
    key.split(' ').every((word) => bookSearchKey(title + ' ' + authors).includes(word));
  const own = books
    .filter((b) => (key ? matches(b.title, b.authors) : !b.deletedAt))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, key ? 8 : 3);
  const club = catalog
    .filter(
      (b) =>
        !books.some((p) => p.clubBookId === b.id || sameBook(p, b)) &&
        (!key || matches(b.title, b.authors)),
    )
    .sort(
      (a, b) =>
        Number(b.status === 'reading') - Number(a.status === 'reading') ||
        a.title.localeCompare(b.title, 'ru'),
    )
    .slice(0, key ? 8 : 4);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    setError('');
    setSearched(false);
    setBusy(false);
    if (key.length < 2) return;
    const timer = setTimeout(() => {
      setBusy(true);
      searchBooks(q, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setResults(data);
            setSearched(true);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted && e.name !== 'AbortError')
            setError(
              'Поиск в интернете временно недоступен. Можно выбрать книгу клуба или добавить вручную.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 650);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, retry]);
  return (
    <section className="book-finder">
      <div className="finder-search">
        <Field label="Найти книгу">
          <input
            autoComplete="off"
            value={q}
            maxLength={200}
            placeholder="Название или автор"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setRetry((n) => n + 1);
              }
            }}
          />
        </Field>
        <button
          type="button"
          aria-label="Запустить поиск"
          disabled={busy || key.length < 2}
          onClick={() => setRetry((n) => n + 1)}
        >
          <Search size={20} />
        </button>
      </div>
      <button type="button" className="finder-manual" onClick={() => onManual(q.trim())}>
        <PenLine size={17} /> Добавить вручную
      </button>
      {own.length > 0 && (
        <section aria-label="Уже у меня">
          <h3>Уже у меня</h3>
          <div className="lookup-results">
            {own.map((b) => (
              <button type="button" key={b.id} onClick={() => onExisting(b)}>
                <Cover title={b.title} cover={bookCover(b)} small />
                <span>
                  <b>{b.title}</b>
                  <small>{b.authors}</small>
                  <small>{b.deletedAt ? 'В корзине — восстановить' : 'Открыть книгу'}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {club.length > 0 && (
        <section aria-label="В клубе">
          <h3>В клубе</h3>
          <div className="lookup-results">
            {club.map((b) => (
              <button type="button" key={b.id} onClick={() => onSelect(catalogMetadata(b), b.id)}>
                <Cover title={b.title} cover={b.cover} small />
                <span>
                  <b>{b.title}</b>
                  <small>{b.authors}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <ErrorNote text={error} />
      {busy && (
        <p role="status" className="muted">
          Ищем в интернете…
        </p>
      )}
      {results.length > 0 && (
        <section aria-label="В интернете">
          <h3>В интернете</h3>
          <div className="lookup-results">
            {results.map((b, i) => {
              const match = resolveBookChoice(b, books, catalog);
              return (
                <button
                  type="button"
                  key={b.isbn + ':' + i}
                  onClick={() =>
                    match.own ? onExisting(match.own) : onSelect(b, match.club?.id || null)
                  }
                >
                  <Cover title={b.title} cover={b.cover} small />
                  <span>
                    <b>{b.title}</b>
                    <small>{b.authors}</small>
                    <small>
                      {[
                        b.year,
                        b.totalPages ? b.totalPages + ' стр.' : '',
                        match.own ? 'Уже у вас' : match.club ? 'Есть в клубе' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {searched && !results.length && !own.length && !club.length && (
        <p className="muted">
          Ничего не нашли. Попробуйте другое название или добавьте книгу вручную.
        </p>
      )}
    </section>
  );
}
