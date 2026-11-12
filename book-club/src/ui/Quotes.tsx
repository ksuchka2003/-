import { useEffect, useMemo, useState, type SetStateAction } from 'react';
import { PaperFragment, ReaderIllustration } from './EditorialArt';
import { CreativeInsert } from './CreativeInsert';
import { useSearchParams } from 'react-router-dom';
import { resolveQuoteBook } from '../quoteBooks';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Plus,
  Star,
  Copy,
  Trash2,
  RotateCcw,
  Pencil,
  SlidersHorizontal,
  Quote as QuoteIcon,
} from 'lucide-react';
import { getDB } from '../db';
import { now, uid, type Quote, type Book, type ClubBook, type PublicQuote } from '../domain';
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
  useCloud,
  SearchField,
} from './shared';
import { PublicContent } from './Social';
import { QuoteBookPicker } from './QuoteBookPicker';
import { DraftNote, useDraft } from './useDraft';
import { Loading } from './shared';
import { SourceDisclosure, ReactionButtons, DiscussionButton } from './SocialActions';
import { useReadingDecision, PublicationPermission } from './ReadingParticipation';
export function QuoteEditor({
  quote,
  book,
  onClose,
}: {
  quote?: Quote;
  book?: Book;
  onClose: () => void;
}) {
  const books = (useLiveQuery(() => getDB().personal_books.toArray()) || []).filter(
    (b) => !b.deletedAt,
  );
  const { identity } = useSession();
  const catalog = useCloud<ClubBook>('club_books');
  const [initial] = useState(() => ({
    clubChoice: null as ClubBook | null,
    newTitle: book?.title || '',
    newBookId: uid(),
    quote: quote || {
      id: uid(),
      bookId: book?.id || '',
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
  }));
  const draft = useDraft('quote:' + (quote?.id || (book ? 'new:' + book.id : 'new')), initial);
  const { run, busy, error } = useTask();
  const v = draft.value?.quote;
  const newTitle = draft.value?.newTitle || '';
  const parent = books.find((b) => b.id === v?.bookId);
  const gate = useReadingDecision(parent?.clubBookId || draft.value?.clubChoice?.id);
  useEffect(() => {
    if (v?.bookId && !newTitle) {
      const book = books.find((b) => b.id === v.bookId);
      if (book) draft.setValue((old) => ({ ...old, newTitle: book.title }));
    }
  }, [books, v?.bookId, newTitle]);
  if (!draft.value || !v)
    return (
      <Modal title="Новая цитата" onClose={onClose}>
        <Loading />
      </Modal>
    );
  const { clubChoice, newBookId } = draft.value;
  const setV = (quote: SetStateAction<Quote>) =>
    draft.setValue((old) => ({
      ...old,
      quote: typeof quote === 'function' ? quote(old.quote) : quote,
    }));
  const setNewTitle = (newTitle: string) => draft.setValue((old) => ({ ...old, newTitle }));
  const setClubChoice = (clubChoice: ClubBook | null) =>
    draft.setValue((old) => ({ ...old, clubChoice }));
  return (
    <Modal title={quote ? 'Редактировать цитату' : 'Новая цитата'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
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
                  const bookId =
                    v.bookId || newTitle.trim()
                      ? await resolveQuoteBook({
                          title: newTitle,
                          personalId: v.bookId || '',
                          club: clubChoice,
                          catalog: catalog.data || [],
                          newId: newBookId,
                        })
                      : null;
                  await saveQuote({ ...v, bookId, updatedAt: now() }, true);
                },
              );
            }, 'Цитата сохранена')
          ) {
            await draft.clear();
            onClose();
          }
        }}
      >
        <DraftNote draft={draft} />
        {book ? (
          <p className="quote-book-context">{book.title}</p>
        ) : (
          <QuoteBookPicker
            optional
            value={newTitle}
            books={books}
            catalog={catalog.data || []}
            onChange={(text) => {
              setNewTitle(text);
              setV((old) => ({ ...old, bookId: '' }));
              setClubChoice(null);
            }}
            onSelect={(choice) => {
              setNewTitle(choice.title);
              setV((old) => ({ ...old, bookId: choice.personal?.id || '' }));
              setClubChoice(choice.club || null);
            }}
          />
        )}
        <Field label="Текст цитаты">
          <textarea
            autoFocus={!!book}
            required
            maxLength={20000}
            rows={5}
            value={v.text}
            onChange={(e) => setV({ ...v, text: e.target.value })}
          />
        </Field>
        <details className="book-extra quote-extra">
          <summary>Страница, глава и комментарий</summary>
          <div className="form-grid quote-location">
            <Field label="Страница">
              <input
                type="number"
                min="0"
                value={v.page ?? ''}
                onChange={(e) =>
                  setV({ ...v, page: e.target.value ? Number(e.target.value) : null })
                }
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
              rows={3}
              maxLength={10000}
              value={v.comment}
              onChange={(e) => setV({ ...v, comment: e.target.value })}
            />
          </Field>
          <Field label="Источник вне книги — необязательно">
            <input
              maxLength={300}
              value={v.attribution || ''}
              onChange={(e) => setV({ ...v, attribution: e.target.value })}
              placeholder="Например, автор или откуда фраза"
            />
          </Field>
        </details>
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
              disabled={!gate.canPublish && !v.published}
              onChange={(e) => setV({ ...v, published: e.target.checked })}
            />{' '}
            Поделиться цитатой с клубом
          </label>
        )}
        <PublicationPermission bookId={parent?.clubBookId || clubChoice?.id} />
        <ErrorNote text={error} />
        <footer>
          <button
            className="primary"
            disabled={
              busy ||
              (v.published && !gate.canPublish) ||
              (!!newTitle.trim() && !v.bookId && catalog.isLoading)
            }
          >
            Сохранить цитату
          </button>
        </footer>
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
  const book = useLiveQuery(
    () => (quote.bookId ? getDB().personal_books.get(quote.bookId) : undefined),
    [quote.bookId],
  );
  const gate = useReadingDecision(book?.clubBookId);
  useEffect(() => setChecked(quote.published), [quote.published]);
  return (
    <label className="check quote-publish">
      <input
        type="checkbox"
        aria-label="Опубликовать в клубе"
        checked={checked}
        disabled={disabled || (!checked && !gate.canPublish)}
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
  const quotes = useLiveQuery(() => getDB().quotes.toArray()) || [];
  const books = (useLiveQuery(() => getDB().personal_books.toArray()) || []).filter(
    (b) => !b.deletedAt,
  );
  const pending = useLiveQuery(() => getDB().sync_queue.toArray()) || [];
  const shared = useCloud<PublicQuote>('club_quotes');
  const likes = useCloud<{ quote_id: string; member_id: string }>('quote_likes');
  const [params, setParams] = useSearchParams();
  const sections = [
    ['mine', 'Мои цитаты'],
    ['saved', 'Сохранено себе'],
    ...(identity
      ? [
          ['liked', 'Мои лайки'],
          ['club', 'Цитаты клуба'],
        ]
      : []),
    ['trash', 'Корзина'],
  ];
  const tab = sections.some(([key]) => key === params.get('tab')) ? params.get('tab')! : 'mine';
  const q = params.get('q') || '';
  const sort = params.get('sort') === 'likes' ? 'likes' : 'newest';
  const favorite = ['mine', 'saved'].includes(tab) && params.get('favorite') === '1';
  const update = (values: Record<string, string>) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        for (const [key, value] of Object.entries(values))
          value ? next.set(key, value) : next.delete(key);
        return next;
      },
      { replace: true },
    );
  const [filters, setFilters] = useState(false);
  const [filterSort, setFilterSort] = useState(sort);
  const [filterFavorite, setFilterFavorite] = useState(favorite);
  const [edit, setEdit] = useState<Quote | true | null>(null);
  const selectedId = params.get('quote');
  useEffect(() => {
    const selected = quotes.find((q) => q.id === selectedId && !q.deletedAt);
    if (selected) setEdit(selected);
  }, [selectedId, quotes]);
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
        (!x.bookId || bookMap.has(x.bookId)) &&
        (tab === 'trash' ? !!x.deletedAt : !x.deletedAt) &&
        (tab === 'trash' || (tab === 'saved' ? !!x.sourceId : !x.sourceId)) &&
        (!favorite || tab === 'trash' || x.favorite) &&
        `${bookMap.get(x.bookId || '')?.title || ''} ${bookMap.get(x.bookId || '')?.authors || ''} ${x.text} ${x.comment} ${x.chapter} ${x.attribution || ''}`
          .toLowerCase()
          .includes(q.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        (sort === 'likes'
          ? likedCount(likeTarget(b) || b.id) - likedCount(likeTarget(a) || a.id)
          : 0) || b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <>
      <div className="page-heading paper-page-heading">
        <PaperFragment className="heading-paper" />
        <div>
          <p className="eyebrow">Слова, которые остались</p>
          <h1>Цитаты</h1>
        </div>
        <ReaderIllustration scene="coffee" className="heading-reader" />
        <div className="quote-create-actions">
          <button className="primary" onClick={() => setEdit(true)}>
            <Plus size={18} />
            Добавить
          </button>
        </div>
      </div>
      {(quotes.length > 0 || publicTab || q) && (
        <SearchField
          className="quote-search"
          label="Поиск цитат"
          placeholder="Книга или слова из цитаты"
          value={q}
          onChange={(value) => update({ q: value })}
        />
      )}
      <div className="quote-navigation">
        <Field label="Раздел цитат">
          <select
            value={tab}
            onChange={(e) =>
              update({ tab: e.target.value === 'mine' ? '' : e.target.value, favorite: '' })
            }
          >
            {sections.map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {(quotes.length > 0 || publicTab) && (
          <button
            type="button"
            className={`quote-filter-button ${favorite || sort !== 'newest' ? 'selected' : ''}`}
            aria-label="Фильтры цитат"
            aria-haspopup="dialog"
            onClick={() => {
              setFilterSort(sort);
              setFilterFavorite(favorite);
              setFilters(true);
            }}
          >
            <SlidersHorizontal size={19} />
            <span>Фильтры</span>
          </button>
        )}
      </div>
      {tab === 'saved' && (
        <p className="tab-explanation">
          Личные копии чужих цитат — останутся у вас после удаления оригинала.
        </p>
      )}
      {tab === 'liked' && (
        <p className="tab-explanation">
          Лайк отмечает публикацию автора. Нажмите «Сохранить себе», чтобы оставить личную копию.
        </p>
      )}
      {(favorite || sort !== 'newest') && (
        <div className="active-quote-filters">
          <span>
            {[favorite ? 'Избранное' : '', sort === 'likes' ? 'Больше лайков' : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => update({ favorite: '', sort: '' })}
          >
            Сбросить фильтры
          </button>
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
          <PublicContent type="quotes" search={q} sort={sort} likedOnly={tab === 'liked'} />
        </CloudGate>
      ) : !items.length ? (
        <Empty
          illustration={!q && !favorite && tab !== 'trash' ? 'coffee' : undefined}
          title={
            tab === 'trash'
              ? 'Корзина пуста'
              : q || favorite
                ? 'Цитаты не найдены'
                : tab === 'saved'
                  ? 'Сохранённых цитат пока нет'
                  : 'Пока нет цитат'
          }
        >
          {(q || favorite) && (
            <button onClick={() => update({ q: '', favorite: '', sort: '' })}>
              Сбросить поиск и фильтры
            </button>
          )}
        </Empty>
      ) : (
        <div className="quote-grid">
          {items.map((x) => {
            const target = likeTarget(x);
            const queued = pending.find((p) => p.kind === 'quote' && p.entityId === x.id);
            return (
              <article className="quote-card" key={x.id}>
                <PaperFragment className="quote-paper" />
                <QuoteIcon className="quote-mark" size={28} />
                <blockquote>{x.text}</blockquote>
                <SourceDisclosure
                  title={bookMap.get(x.bookId || '')?.title}
                  bookId={bookMap.get(x.bookId || '')?.clubBookId}
                  personalId={x.bookId}
                  page={x.page}
                  chapter={x.chapter}
                  attribution={x.attribution}
                  savedFrom={x.sourceAuthor}
                />
                {x.comment && <p className="prewrap muted">{x.comment}</p>}
                <small className="muted">
                  {x.sourceId ? 'Сохранено' : 'Создано'} {dateLabel(x.createdAt)}
                  {queued
                    ? x.published
                      ? ' · Ожидает публикации'
                      : ' · Скрытие ожидает синхронизации'
                    : x.published && publicIds.has(x.id)
                      ? ' · Опубликовано в клубе'
                      : x.published
                        ? ' · Публикация ещё не подтверждена'
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
                      {identity && target && (
                        <>
                          <ReactionButtons kind="quote" id={target} />
                          <DiscussionButton kind="quote" id={target} preview={x.text} />
                        </>
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
      {!publicTab && tab !== 'trash' && items.length > 0 && <CreativeInsert motif="butterfly" />}
      {filters && (
        <Modal title="Фильтры цитат" onClose={() => setFilters(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update({
                sort: filterSort === 'likes' ? 'likes' : '',
                favorite: filterFavorite && ['mine', 'saved'].includes(tab) ? '1' : '',
              });
              setFilters(false);
            }}
          >
            <Field label="Сортировка цитат">
              <select
                value={filterSort}
                onChange={(e) => setFilterSort(e.target.value as 'newest' | 'likes')}
              >
                <option value="newest">Сначала новые</option>
                <option value="likes">Больше лайков</option>
              </select>
            </Field>
            {!publicTab && tab !== 'trash' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={filterFavorite}
                  onChange={(e) => setFilterFavorite(e.target.checked)}
                />
                Только избранное
              </label>
            )}
            <footer>
              <button className="primary">Показать цитаты</button>
              <button
                type="button"
                onClick={() => {
                  setFilterSort('newest');
                  setFilterFavorite(false);
                }}
              >
                Сбросить
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {edit && (
        <QuoteEditor
          quote={typeof edit === 'object' ? edit : undefined}
          onClose={() => {
            setEdit(null);
            update({ quote: '' });
          }}
        />
      )}
    </>
  );
}
