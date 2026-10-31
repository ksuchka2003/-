import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Heart, Copy, Trash2, RotateCcw, Pencil, Quote as QuoteIcon } from 'lucide-react';
import { getDB } from '../db';
import { now, uid, type Quote } from '../domain';
import { saveQuote, trashQuote, restoreQuote, eraseQuote } from '../local';
import {
  Modal,
  Field,
  Empty,
  useTask,
  useSession,
  ErrorNote,
  dateLabel,
  CloudGate,
} from './shared';
import { PublicContent } from './Social';
function QuoteEditor({ quote, onClose }: { quote?: Quote; onClose: () => void }) {
  const books = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const { identity } = useSession();
  const [v, setV] = useState<Quote>(
    quote || {
      id: uid(),
      bookId: '',
      text: '',
      page: null,
      chapter: '',
      comment: '',
      favorite: false,
      deletedAt: null,
      sourceId: null,
      sourceAuthor: null,
      published: false,
      createdAt: now(),
      updatedAt: now(),
    },
  );
  const { run, busy, error } = useTask();
  return (
    <Modal title={quote ? 'Редактировать цитату' : 'Новая цитата'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => saveQuote({ ...v, updatedAt: now() }), 'Цитата сохранена')) onClose();
        }}
      >
        <Field label="Книга">
          <select
            required
            value={v.bookId}
            onChange={(e) => setV({ ...v, bookId: e.target.value })}
          >
            <option value="">Выберите книгу</option>
            {books.map((b) => (
              <option value={b.id} key={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        {!books.length && <p className="hint">Сначала добавьте книгу в личную библиотеку.</p>}
        <Field label="Текст цитаты">
          <textarea
            required
            maxLength={20000}
            rows={6}
            value={v.text}
            onChange={(e) => setV({ ...v, text: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Страница">
            <input
              type="number"
              min="0"
              value={v.page ?? ''}
              onChange={(e) => setV({ ...v, page: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
          <Field label="Глава">
            <input
              maxLength={300}
              value={v.chapter}
              onChange={(e) => setV({ ...v, chapter: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Комментарий">
          <textarea
            maxLength={10000}
            value={v.comment}
            onChange={(e) => setV({ ...v, comment: e.target.value })}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={v.favorite}
            onChange={(e) => setV({ ...v, favorite: e.target.checked })}
          />{' '}
          В избранное
        </label>
        {identity && books.find((b) => b.id === v.bookId)?.clubBookId && (
          <label className="check">
            <input
              type="checkbox"
              checked={v.published}
              onChange={(e) => setV({ ...v, published: e.target.checked })}
            />{' '}
            Публиковать в клубе (с учётом настроек профиля)
          </label>
        )}
        <ErrorNote text={error} />
        <button className="primary" disabled={busy || !books.length}>
          Сохранить цитату
        </button>
      </form>
    </Modal>
  );
}
export function Quotes() {
  const { identity } = useSession();
  const quotes = useLiveQuery(() => getDB().quotes.toArray()) || [];
  const books = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const [q, setQ] = useState('');
  const [book, setBook] = useState('all');
  const [tab, setTab] = useState('all');
  const [edit, setEdit] = useState<Quote | true | null>(null);
  const { run, error } = useTask();
  const items = quotes
    .filter(
      (x) =>
        (tab === 'trash' ? !!x.deletedAt : !x.deletedAt) &&
        (tab !== 'favorite' || x.favorite) &&
        (book === 'all' || x.bookId === book) &&
        `${x.text} ${x.comment} ${x.chapter}`.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Цитаты</h1>
        </div>
        <button className="primary" onClick={() => setEdit(true)}>
          <Plus size={18} /> Добавить
        </button>
      </div>
      <div className="tabs">
        {[
          ['all', 'Все цитаты'],
          ['favorite', 'Избранное'],
          ['trash', 'Корзина'],
          ...(identity ? [['club', 'В клубе']] : []),
        ].map(([k, v]) => (
          <button className={tab === k ? 'active' : ''} key={k} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>
      {tab !== 'club' && quotes.length > 0 && (
        <div className="toolbar">
          <input
            aria-label="Поиск цитат"
            placeholder="Найти слова…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Фильтр по книге"
            value={book}
            onChange={(e) => setBook(e.target.value)}
          >
            <option value="all">Все книги</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {tab === 'trash' && items.length > 0 && (
        <div className="notice">
          Цитаты удаляются через 30 дней при запуске приложения.{' '}
          <button
            onClick={() => {
              if (confirm('Очистить корзину без возможности восстановления?'))
                void run(async () => {
                  for (const x of items) await eraseQuote(x.id);
                }, 'Корзина очищена');
            }}
          >
            Очистить видимые цитаты
          </button>
        </div>
      )}
      <ErrorNote text={error} />
      {tab === 'club' ? (
        <CloudGate>
          <PublicContent type="quotes" />
        </CloudGate>
      ) : !items.length ? (
        <Empty title={tab === 'trash' ? 'Корзина пуста' : 'Пока нет цитат'} />
      ) : (
        <div className="quote-grid">
          {items.map((x) => (
            <article className="quote-card" key={x.id}>
              <QuoteIcon className="quote-mark" size={28} />
              <blockquote>{x.text}</blockquote>
              <p className="quote-source">
                {books.find((b) => b.id === x.bookId)?.title}
                {x.page !== null ? ` · стр. ${x.page}` : ''}
                {x.chapter ? ` · ${x.chapter}` : ''}
              </p>
              {x.comment && <p className="muted">{x.comment}</p>}
              {x.sourceAuthor && <small>Сохранено от {x.sourceAuthor}</small>}
              <small className="muted">
                {dateLabel(x.createdAt)}
                {x.published ? ' · Публикация включена' : ''}
              </small>
              <div className="actions">
                {x.deletedAt ? (
                  <>
                    <button
                      onClick={() =>
                        void run(
                          () => restoreQuote(x.id),
                          'Цитата восстановлена в приватном режиме',
                        )
                      }
                    >
                      <RotateCcw size={16} /> Восстановить
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm('Удалить цитату навсегда?'))
                          void run(() => eraseQuote(x.id), 'Цитата удалена');
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      aria-label="В избранное"
                      className={x.favorite ? 'liked' : ''}
                      onClick={() =>
                        void run(
                          () => saveQuote({ ...x, favorite: !x.favorite, updatedAt: now() }),
                          '',
                        )
                      }
                    >
                      <Heart size={18} fill={x.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      aria-label="Копировать цитату"
                      onClick={() =>
                        void run(() => navigator.clipboard.writeText(x.text), 'Текст скопирован')
                      }
                    >
                      <Copy size={17} />
                    </button>
                    <button aria-label="Редактировать цитату" onClick={() => setEdit(x)}>
                      <Pencil size={17} />
                    </button>
                    <button
                      aria-label="В корзину"
                      onClick={() => {
                        if (
                          confirm(
                            'Переместить цитату в корзину? Публичная копия будет удалена после синхронизации.',
                          )
                        )
                          void run(() => trashQuote(x.id), 'Цитата в корзине');
                      }}
                    >
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <QuoteEditor quote={edit === true ? undefined : edit} onClose={() => setEdit(null)} />
      )}
    </>
  );
}
