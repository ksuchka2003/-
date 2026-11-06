import { useId, useMemo, useState } from 'react';
import type { Book, ClubBook } from '../domain';
import { bookSearchKey } from '../quoteBooks';
import { bookCover } from '../covers';
import { Cover, Field } from './shared';
type Choice = {
  key: string;
  title: string;
  authors: string;
  cover: string;
  personal?: Book;
  club?: ClubBook;
};
export function QuoteBookPicker({
  value,
  onChange,
  onSelect,
  books,
  catalog,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (value: Choice) => void;
  books: Book[];
  catalog: ClubBook[];
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const choices = useMemo(() => {
    const q = bookSearchKey(value);
    if (!q) return [];
    const local: Choice[] = books
      .filter((b) => bookSearchKey(`${b.title} ${b.authors}`).includes(q))
      .map((b) => ({
        key: 'p:' + b.id,
        title: b.title,
        authors: b.authors,
        cover: bookCover(b),
        personal: b,
      }));
    const shared: Choice[] = catalog
      .filter(
        (b) =>
          !books.some((p) => p.clubBookId === b.id) &&
          bookSearchKey(`${b.title} ${b.authors}`).includes(q),
      )
      .map((b) => ({
        key: 'c:' + b.id,
        title: b.title,
        authors: b.authors,
        cover: b.cover,
        club: b,
      }));
    return [...local, ...shared].slice(0, 12);
  }, [value, books, catalog]);
  const choose = (choice: Choice) => {
    onSelect(choice);
    setOpen(false);
  };
  return (
    <div
      className="quote-book-picker"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Field label="Название книги">
        <input
          required
          maxLength={300}
          role="combobox"
          autoComplete="off"
          aria-expanded={open && !!choices.length}
          aria-controls={id}
          aria-autocomplete="list"
          aria-activedescendant={open && choices[active] ? `${id}-${active}` : undefined}
          value={value}
          placeholder="Начните вводить название"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && choices.length) {
              e.preventDefault();
              setOpen(true);
              setActive(
                (i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length,
              );
            }
            if (e.key === 'Enter' && open && choices[active]) {
              e.preventDefault();
              choose(choices[active]);
            }
            if (e.key === 'Escape' && open) {
              e.stopPropagation();
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
      </Field>
      {open && !!choices.length && (
        <div
          className="book-suggestions"
          id={id}
          role="listbox"
          aria-label="Книги из моей библиотеки и клуба"
        >
          {choices.map((c, i) => (
            <button
              type="button"
              key={c.key}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
            >
              <Cover small title={c.title} cover={c.cover} />
              <span>
                <b>{c.title}</b>
                <small>{c.authors}</small>
                <small>{c.personal ? 'Мои книги' : 'Книги клуба'}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
