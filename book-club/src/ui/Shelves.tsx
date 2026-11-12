import { useState } from 'react';
import { PaperSelect } from './PaperSelect';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Trash2 } from 'lucide-react';
import { getDB } from '../db';
import { type Book, uid } from '../domain';
import { type Shelf, shelfSchema } from '../readerDomain';
import { saveShelf, deleteShelf, setBookShelves, moveBookShelf } from '../readerLocal';
import { Modal, Field, useTask, ErrorNote } from './shared';
export function useShelves() {
  return (
    useLiveQuery(async () => {
      const data = (await getDB().settings.get('shelves'))?.value;
      return Array.isArray(data)
        ? (data.filter((s) => shelfSchema.safeParse(s).success) as Shelf[])
        : [];
    }) || []
  );
}
export function ShelfManager({
  onClose,
  onDeleted,
}: {
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  const shelves = useShelves(),
    [id, setId] = useState<string | null>(null),
    [name, setName] = useState('');
  const { run, busy, error } = useTask();
  return (
    <Modal title="Мои полки" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await run(
              () => saveShelf({ id: id || uid(), name }),
              id ? 'Полка переименована' : 'Полка создана',
            )
          ) {
            setId(null);
            setName('');
          }
        }}
      >
        <Field label={id ? 'Название полки' : 'Новая полка'}>
          <input
            required
            maxLength={80}
            value={name}
            placeholder="Например, Любимое или На лето"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="actions">
          <button className="primary" disabled={busy || !name.trim()}>
            {id ? 'Сохранить название' : 'Создать полку'}
          </button>
          {id && (
            <button
              type="button"
              onClick={() => {
                setId(null);
                setName('');
              }}
            >
              Отмена
            </button>
          )}
        </div>
      </form>
      <ErrorNote text={error} />
      <div className="stack">
        {shelves.map((s) => (
          <div className="management-row" key={s.id}>
            <span>
              <b>{s.name}</b>
            </span>
            <button
              aria-label={`Переименовать полку: ${s.name}`}
              onClick={() => {
                setId(s.id);
                setName(s.name);
              }}
            >
              <Pencil size={17} />
            </button>
            <button
              className="danger"
              aria-label={`Удалить полку: ${s.name}`}
              disabled={busy}
              onClick={() => {
                if (confirm('Удалить полку? Книги и записи останутся в библиотеке.'))
                  void run(async () => {
                    await deleteShelf(s.id);
                    onDeleted?.(s.id);
                    if (id === s.id) {
                      setId(null);
                      setName('');
                    }
                  }, 'Полка удалена');
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
export function ShelfPicker({
  book,
  fromShelf,
  onClose,
}: {
  book: Book;
  fromShelf?: string;
  onClose: () => void;
}) {
  const shelves = useShelves(),
    [selected, setSelected] = useState(book.shelfIds || []),
    [to, setTo] = useState('');
  const { run, busy, error } = useTask();
  return (
    <Modal title="Полки книги" onClose={onClose}>
      <p className="form-context">{book.title}</p>
      {!shelves.length ? (
        <p className="section-hint">
          Создайте полки в «Моих книгах». Одна книга может быть на нескольких полках.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => setBookShelves(book.id, selected), 'Полки сохранены')) onClose();
          }}
        >
          <fieldset className="shelf-choice-list">
            <legend>На каких полках хранить</legend>
            {shelves.map((s) => (
              <label className="check" key={s.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked ? [...old, s.id] : old.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </fieldset>
          <footer>
            <button className="primary" disabled={busy}>
              Сохранить полки
            </button>
          </footer>
        </form>
      )}
      {fromShelf && shelves.some((s) => s.id !== fromShelf) && (
        <details className="book-extra">
          <summary>Переместить с текущей полки</summary>
          <PaperSelect
            label="Куда переместить"
            value={to}
            onChange={setTo}
            options={[
              { value: '', label: 'Выберите полку' },
              ...shelves
                .filter((s) => s.id !== fromShelf)
                .map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <button
            disabled={busy || !to}
            onClick={async () => {
              if (await run(() => moveBookShelf(book.id, fromShelf, to), 'Книга перемещена'))
                onClose();
            }}
          >
            Переместить книгу
          </button>
        </details>
      )}
      <ErrorNote text={error} />
    </Modal>
  );
}
