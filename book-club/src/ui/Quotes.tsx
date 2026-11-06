import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { action } from '../cloud';
import { quoteBookKey } from '../collection';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Plus,
  Camera,
  Heart,
  Star,
  Copy,
  Trash2,
  RotateCcw,
  Pencil,
  Quote as QuoteIcon,
} from 'lucide-react';
import { getDB } from '../db';
import { now, uid, type Quote, type Book, type PublicQuote } from '../domain';
import { saveBook, saveQuote, trashQuote, restoreQuote, eraseQuote } from '../local';
import {
  Modal,
  Field,
  Empty,
  useTask,
  useSession,
  ErrorNote,
  dateLabel,
  CloudGate,
  useCloud,
} from './shared';
import { PublicContent } from './Social';
import { PhotoQuote } from './PhotoQuote';
function QuoteEditor({
  quote,
  onClose,
  startWithCamera = false,
}: {
  quote?: Quote;
  onClose: () => void;
  startWithCamera?: boolean;
}) {
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
  const [recognizing, setRecognizing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBookId] = useState(uid);
  return (
    <Modal title={quote ? 'Редактировать цитату' : 'Новая цитата'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (recognizing) return;
          if (
            await run(async () => {
              const db = getDB();
              await db.transaction(
                'rw',
                [
                  db.personal_books,
                  db.reading_progress,
                  db.personal_reviews,
                  db.quotes,
                  db.sync_queue,
                  db.settings,
                ],
                async () => {
                  let bookId = v.bookId;
                  if (!bookId) {
                    const fresh: Book = {
                      id: newBookId,
                      clubBookId: null,
                      title: newTitle.trim(),
                      authors: '',
                      description: '',
                      genre: '',
                      year: null,
                      isbn: '',
                      cover: '',
                      totalPages: 0,
                      status: 'planned',
                      notes: '',
                      publishProgress: false,
                      publishReview: false,
                      createdAt: now(),
                      updatedAt: now(),
                    };
                    await saveBook(fresh, 0, {
                      bookId: fresh.id,
                      rating: null,
                      text: '',
                      spoilers: false,
                      updatedAt: now(),
                    });
                    bookId = fresh.id;
                  }
                  await saveQuote({ ...v, bookId, updatedAt: now() }, true);
                },
              );
            }, 'Цитата сохранена')
          )
            onClose();
        }}
      >
        <Field label="Книга">
          <select value={v.bookId} onChange={(e) => setV({ ...v, bookId: e.target.value })}>
            <option value="">Указать другую книгу</option>
            {books.map((b) => (
              <option value={b.id} key={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        {!v.bookId && (
          <Field label="Название книги">
            <input
              required
              maxLength={300}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </Field>
        )}
        <PhotoQuote
          startWithCamera={startWithCamera}
          onBusy={setRecognizing}
          onText={(text) =>
            setV((old) => ({ ...old, text: old.text ? old.text + '\n\n' + text : text }))
          }
        />
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
        {identity && (
          <label className="check">
            <input
              type="checkbox"
              checked={v.published}
              onChange={(e) => setV({ ...v, published: e.target.checked })}
            />{' '}
            Поделиться цитатой с клубом
          </label>
        )}
        <ErrorNote text={error} />
        <button className="primary" disabled={busy || recognizing}>
          Сохранить цитату
        </button>
      </form>
    </Modal>
  );
}
function QuotePublication({
  quote,
  disabled,
  onChange,
}: {
  quote: Quote;
  disabled: boolean;
  onChange: (value: boolean) => Promise<boolean>;
}) {
  const [checked, setChecked] = useState(quote.published);
  useEffect(() => setChecked(quote.published), [quote.published]);
  return (
    <label className="check quote-publish">
      <input
        type="checkbox"
        aria-label="Опубликовать в клубе"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          const value = e.target.checked;
          setChecked(value);
          void onChange(value).then((ok) => {
            if (!ok) setChecked(quote.published);
          });
        }}
      />
      Опубликовать в клубе
    </label>
  );
}
export function Quotes() {
  const { identity } = useSession();
  const query = useQueryClient();
  const quotes = useLiveQuery(() => getDB().quotes.toArray()) || [];
  const books = useLiveQuery(() => getDB().personal_books.toArray()) || [];
  const pending = useLiveQuery(() => getDB().sync_queue.toArray()) || [];
  const shared = useCloud<PublicQuote>('club_quotes');
  const likes = useCloud<{ quote_id: string; member_id: string }>('quote_likes');
  const [q, setQ] = useState('');
  const [book, setBook] = useState('all');
  const [tab, setTab] = useState('mine');
  const [favorite, setFavorite] = useState(false);
  const [sort, setSort] = useState<'newest' | 'likes'>('newest');
  const [edit, setEdit] = useState<Quote | true | 'photo' | null>(null);
  const { run, error, busy } = useTask();
  const publicTab = tab === 'club' || tab === 'liked';
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of likes.data || []) map.set(l.quote_id, (map.get(l.quote_id) || 0) + 1);
    return map;
  }, [likes.data]);
  const likedCount = (id: string) => counts.get(id) || 0;
  const publicIds = useMemo(() => new Set((shared.data || []).map((q) => q.id)), [shared.data]);
  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const likeTarget = (x: Quote) =>
    publicIds.has(x.id) ? x.id : x.sourceId && publicIds.has(x.sourceId) ? x.sourceId : null;
  const items = quotes
    .filter(
      (x) =>
        (tab === 'trash' ? !!x.deletedAt : !x.deletedAt) &&
        (tab === 'trash' || (tab === 'saved' ? !!x.sourceId : !x.sourceId)) &&
        (!favorite || tab === 'trash' || x.favorite) &&
        (book === 'all' || x.bookId === book) &&
        `${bookMap.get(x.bookId)?.title || ''} ${bookMap.get(x.bookId)?.authors || ''} ${x.text} ${x.comment} ${x.chapter}`
          .toLowerCase()
          .includes(q.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        (sort === 'likes'
          ? likedCount(likeTarget(b) || b.id) - likedCount(likeTarget(a) || a.id)
          : 0) || b.createdAt.localeCompare(a.createdAt),
    );
  const options = publicTab
    ? [
        ...new Map(
          (shared.data || []).map((x) => [
            quoteBookKey(x),
            { id: quoteBookKey(x), title: x.title },
          ]),
        ).values(),
      ]
    : books.map((b) => ({ id: b.id, title: b.title }));
  return (
    <>
      <div className="page-heading">
        <h1>Цитаты</h1>
        <div className="quote-create-actions">
          <button onClick={() => setEdit('photo')} aria-label="Добавить цитату с фото">
            <Camera size={18} />С фото
          </button>
          <button className="primary" onClick={() => setEdit(true)}>
            <Plus size={18} />
            Добавить
          </button>
        </div>
      </div>
      <div className="tabs">
        {[
          ['mine', 'Мои'],
          ['saved', 'Сохранённые'],
          ...(identity
            ? [
                ['liked', 'Понравились'],
                ['club', 'В клубе'],
              ]
            : []),
          ['trash', 'Корзина'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => {
              setTab(key);
              setBook('all');
              setFavorite(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {(quotes.length > 0 || publicTab) && (
        <div className="toolbar quotes-toolbar">
          <input
            aria-label="Поиск цитат"
            placeholder="Книга или слова из цитаты"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Фильтр по книге"
            value={book}
            onChange={(e) => setBook(e.target.value)}
          >
            <option value="all">Все книги</option>
            {[...options]
              .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
          </select>
          <select
            aria-label="Сортировка цитат"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'newest' | 'likes')}
          >
            <option value="newest">Сначала новые</option>
            <option value="likes">Больше лайков</option>
          </select>
          {!publicTab && tab !== 'trash' && (
            <button
              className={favorite ? 'selected' : ''}
              aria-pressed={favorite}
              onClick={() => setFavorite(!favorite)}
            >
              <Star size={16} />
              Избранное
            </button>
          )}
        </div>
      )}
      {tab === 'trash' && items.length > 0 && (
        <div className="notice">
          В корзине цитаты хранятся 30 дней.
          <button
            onClick={() => {
              if (confirm('Очистить видимые цитаты без возможности восстановления?'))
                void run(async () => {
                  for (const x of items) await eraseQuote(x.id);
                }, 'Корзина очищена');
            }}
          >
            Очистить видимые цитаты
          </button>
        </div>
      )}
      <ErrorNote text={error || (!publicTab && identity ? likes.error?.message : '')} />
      {publicTab ? (
        <CloudGate>
          <PublicContent
            type="quotes"
            search={q}
            quoteBook={book}
            sort={sort}
            likedOnly={tab === 'liked'}
          />
        </CloudGate>
      ) : !items.length ? (
        <Empty
          title={
            tab === 'trash'
              ? 'Корзина пуста'
              : q || book !== 'all' || favorite
                ? 'Цитаты не найдены'
                : tab === 'saved'
                  ? 'Сохранённых цитат пока нет'
                  : 'Пока нет цитат'
          }
        />
      ) : (
        <div className="quote-grid">
          {items.map((x) => {
            const target = likeTarget(x);
            const liked =
              target &&
              likes.data?.some((l) => l.quote_id === target && l.member_id === identity?.id);
            const queued = pending.find((p) => p.kind === 'quote' && p.entityId === x.id);
            return (
              <article className="quote-card" key={x.id}>
                <QuoteIcon className="quote-mark" size={28} />
                <blockquote>{x.text}</blockquote>
                <p className="quote-source">
                  {bookMap.get(x.bookId)?.title}
                  {x.page !== null ? ` · стр. ${x.page}` : ''}
                  {x.chapter ? ` · ${x.chapter}` : ''}
                </p>
                {x.comment && <p className="prewrap muted">{x.comment}</p>}
                {x.sourceAuthor && <small>Сохранено от {x.sourceAuthor}</small>}
                <small className="muted">
                  {x.sourceId ? 'Сохранено' : 'Создано'} {dateLabel(x.createdAt)}
                  {queued
                    ? x.published
                      ? ' · Ожидает публикации'
                      : ' · Скрытие ожидает синхронизации'
                    : x.published
                      ? ' · Опубликовано в клубе'
                      : ''}
                </small>
                {!x.deletedAt && identity && (
                  <QuotePublication
                    quote={x}
                    disabled={busy}
                    onChange={(value) =>
                      run(
                        () => saveQuote({ ...x, published: value, updatedAt: now() }, true),
                        'Цитата сохранена',
                      )
                    }
                  />
                )}
                <div className="actions">
                  {x.deletedAt ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => restoreQuote(x.id),
                            'Цитата восстановлена в приватном режиме',
                          )
                        }
                      >
                        <RotateCcw size={16} />
                        Восстановить
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        aria-label="Удалить цитату навсегда"
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
                      {identity && target ? (
                        <button
                          aria-label="Нравится цитата"
                          className={liked ? 'liked' : ''}
                          disabled={busy || !!likes.error}
                          onClick={() =>
                            void run(async () => {
                              await action('like', { quote_id: target, liked: !liked });
                              await query.invalidateQueries({ queryKey: ['cloud'] });
                            }, '')
                          }
                        >
                          <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
                          {likes.isLoading ? '…' : likes.error ? '?' : likedCount(target)}
                        </button>
                      ) : (
                        !x.sourceId && (
                          <span className="like-count">
                            <Heart size={16} />
                            {identity && (shared.isLoading || likes.isLoading) ? '…' : 0}
                          </span>
                        )
                      )}
                      <button
                        aria-label="В избранное"
                        className={x.favorite ? 'selected' : ''}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => saveQuote({ ...x, favorite: !x.favorite, updatedAt: now() }),
                            '',
                          )
                        }
                      >
                        <Star size={17} fill={x.favorite ? 'currentColor' : 'none'} />
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
                        disabled={busy}
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
            );
          })}
        </div>
      )}
      {edit && (
        <QuoteEditor
          quote={typeof edit === 'object' ? edit : undefined}
          startWithCamera={edit === 'photo'}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
