import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '../db';
import { bookSearchKey } from '../quoteBooks';
import { catalogMetadata } from '../bookMatches';
import type { Book, ClubBook, Metadata } from '../domain';
import { Cover, Field } from './shared';
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
  const books = useLiveQuery(() => getDB().personal_books.toArray()) || [],
    [q, setQ] = useState('');
  const words = bookSearchKey(q).split(' ').filter(Boolean);
  const ownMatches = books.filter(
    (b) =>
      words.length > 0 && words.every((w) => bookSearchKey(b.title + ' ' + b.authors).includes(w)),
  );
  const matches = catalog
    .filter((b) => words.every((word) => bookSearchKey(b.title + ' ' + b.authors).includes(word)))
    .sort(
      (a, b) =>
        Number(b.status === 'reading') - Number(a.status === 'reading') ||
        a.title.localeCompare(b.title, 'ru'),
    );
  return (
    <section className="book-finder catalog-picker">
      <Field label="Найти в книгах клуба">
        <input
          autoComplete="off"
          maxLength={200}
          placeholder="Название или автор"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Field>
      <button className="finder-manual" type="button" onClick={() => onManual(q.trim())}>
        Добавить вручную
      </button>
      {!!ownMatches.length && (
        <section aria-label="Уже у меня">
          <h3>Уже у меня</h3>
          <div className="lookup-results">
            {ownMatches.map((b) => (
              <button type="button" key={b.id} onClick={() => onExisting(b)}>
                <Cover small title={b.title} cover={b.cover} />
                <span>
                  <b>{b.title}</b>
                  <small>{b.authors}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section aria-label="В клубе">
        <div className="lookup-results">
          {matches.map((b) => {
            const own = books.find((p) => p.clubBookId === b.id);
            return (
              <button
                type="button"
                key={b.id}
                onClick={() => (own ? onExisting(own) : onSelect(catalogMetadata(b), b.id))}
              >
                <Cover small title={b.title} cover={b.cover} />
                <span>
                  <b>{b.title}</b>
                  <small>{b.authors}</small>
                  {own && (
                    <small>{own.deletedAt ? 'В корзине — восстановить' : 'Уже у меня'}</small>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      {!matches.length && (
        <p className="quiet-empty">Такой книги в клубе нет. Можно добавить вручную.</p>
      )}
    </section>
  );
}
