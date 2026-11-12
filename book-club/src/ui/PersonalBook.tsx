import { useState } from 'react';
import { PaperFragment, PaperTape, MarginDoodle } from './EditorialArt';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '../db';
import { percent, personalStatuses, type Book } from '../domain';
import type { Entry, ClubEntry } from '../readerDomain';
import { deleteEntry } from '../entries';
import { bookCover } from '../covers';
import { RatingStars } from './RatingStars';
import { EntryEditor } from './EntryEditor';
import { BookReviewEditor } from './BookReview';
import { QuoteEditor } from './Quotes';
import { ShelfPicker } from './Shelves';
import { ReactionButtons, DiscussionButton, SourceDisclosure } from './SocialActions';
import { Modal, Loading, Cover, Empty, useTask, ErrorNote, dateLabel, useCloud } from './shared';
export function PersonalBook({
  book,
  onClose,
  onEdit,
  onProgress,
}: {
  book: Book;
  onClose: () => void;
  onEdit: () => void;
  onProgress: () => void;
  onQuote?: () => void;
  onThought?: () => void;
}) {
  const [section, setSection] = useState<'note' | 'thought' | 'quote' | 'review'>('note');
  const [editor, setEditor] = useState<
    Entry | 'new' | 'legacy' | 'quote' | 'review' | 'shelves' | null
  >(null);
  const { run, busy, error } = useTask();
  const published = useCloud<ClubEntry>('club_entries');
  const data = useLiveQuery(
    async () => ({
      progress: await getDB().reading_progress.get(book.id),
      review: await getDB().personal_reviews.get(book.id),
      entries: (await getDB().entries.where('bookId').equals(book.id).toArray())
        .filter((e) => !e.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      quotes: (await getDB().quotes.where('bookId').equals(book.id).toArray())
        .filter((q) => !q.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }),
    [book.id],
  );
  if (editor === 'quote') return <QuoteEditor book={book} onClose={() => setEditor(null)} />;
  if (editor === 'review') return <BookReviewEditor book={book} onClose={() => setEditor(null)} />;
  if (editor === 'shelves') return <ShelfPicker book={book} onClose={() => setEditor(null)} />;
  if (editor)
    return (
      <EntryEditor
        book={book}
        kind={section === 'thought' ? 'thought' : 'note'}
        entry={typeof editor === 'object' ? editor : undefined}
        legacyText={editor === 'legacy' ? book.notes : undefined}
        onClose={() => setEditor(null)}
      />
    );
  const entries = data?.entries.filter((e) => e.kind === section) || [];
  return (
    <Modal title="Моя книга" onClose={onClose}>
      <div className="personal-book-summary">
        <PaperFragment className="personal-book-paper" />
        <PaperTape className="personal-book-tape" />
        <Cover title={book.title} cover={bookCover(book)} />
        <div>
          <span className="badge">{personalStatuses[book.status]}</span>
          <h2>{book.title}</h2>
          <p>{book.authors}</p>
          {book.clubBookId && (
            <Link className="badge" to={'/club/' + book.clubBookId}>
              Клубная книга →
            </Link>
          )}
        </div>
      </div>
      <div className="actions">
        <button onClick={onEdit}>Издание и обложка</button>
        <button onClick={() => setEditor('shelves')}>На полки</button>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="personal-progress">
            {book.totalPages > 0 && (
              <>
                <div className="progress">
                  <i style={{ width: percent(data.progress?.pages || 0, book.totalPages) + '%' }} />
                </div>
                <p>
                  {data.progress?.pages || 0} из {book.totalPages} стр. ·{' '}
                  {percent(data.progress?.pages || 0, book.totalPages)}%
                </p>
              </>
            )}
            {data.progress?.chapter && <small>{data.progress.chapter}</small>}
            <button className="primary" onClick={onProgress}>
              Обновить прогресс
            </button>
          </div>
          <div className="book-section-nav" role="group" aria-label="Мои записи о книге">
            {(
              [
                [
                  'note',
                  'Заметки',
                  data.entries.filter((e) => e.kind === 'note').length + Number(!!book.notes),
                ],
                ['thought', 'Мысли', data.entries.filter((e) => e.kind === 'thought').length],
                ['quote', 'Цитаты', data.quotes.length],
                ['review', 'Отзыв', null],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                className={section === key ? 'active' : ''}
                aria-pressed={section === key}
                onClick={() => setSection(key)}
              >
                {label}
                {count !== null && <small>{count}</small>}
              </button>
            ))}
          </div>
          <ErrorNote text={error} />
          {section === 'note' || section === 'thought' ? (
            <>
              <button className="primary section-add" onClick={() => setEditor('new')}>
                {section === 'note' ? 'Добавить заметку' : 'Добавить мысль'}
              </button>
              {section === 'note' && book.notes && (
                <article className="quote-card">
                  <PaperFragment className="quote-paper" ruled />
                  <span className="badge">Личная заметка из прежней версии</span>
                  <p className="prewrap">{book.notes}</p>
                  <button onClick={() => setEditor('legacy')}>Открыть как отдельную заметку</button>
                </article>
              )}
              {!entries.length && !(section === 'note' && book.notes) && (
                <Empty
                  title={section === 'note' ? 'Здесь будут ваши заметки' : 'Здесь будут ваши мысли'}
                  illustration={section === 'note' ? 'coffee' : 'headphones'}
                />
              )}
              <div className="stack">
                {entries.map((e) => (
                  <article className="quote-card" key={e.id}>
                    <PaperFragment className="quote-paper" ruled={e.kind === 'note'} />
                    <p className="prewrap">{e.text}</p>
                    <SourceDisclosure
                      title={book.title}
                      personalId={book.id}
                      page={e.page}
                      chapter={e.chapter}
                    />
                    <small className="muted">
                      {dateLabel(e.createdAt)} ·{' '}
                      {e.published
                        ? published.data?.some((p) => p.id === e.id)
                          ? 'В клубе'
                          : 'Ожидает публикации'
                        : 'Только для меня'}
                    </small>
                    <div className="actions">
                      <button onClick={() => setEditor(e)}>Изменить</button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              'Удалить запись? Её публикация и комментарии также будут удалены после синхронизации.',
                            )
                          )
                            void run(() => deleteEntry(e.id), 'Запись удалена');
                        }}
                      >
                        Удалить
                      </button>
                      {published.data?.some((p) => p.id === e.id) && (
                        <>
                          <ReactionButtons kind={e.kind} id={e.id} />
                          <DiscussionButton kind={e.kind} id={e.id} preview={e.text} />
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : section === 'quote' ? (
            <>
              <button className="primary section-add" onClick={() => setEditor('quote')}>
                Добавить цитату
              </button>
              {!data.quotes.length && (
                <Empty title="Здесь будут ваши цитаты" illustration="reader" />
              )}
              <div className="stack">
                {data.quotes.map((q) => (
                  <article className="quote-card" key={q.id}>
                    <PaperFragment className="quote-paper" />
                    <blockquote>{q.text}</blockquote>
                    {q.comment && <p className="prewrap">{q.comment}</p>}
                    <SourceDisclosure
                      title={book.title}
                      personalId={book.id}
                      page={q.page}
                      chapter={q.chapter}
                      savedFrom={q.sourceAuthor}
                    />
                    <small>{dateLabel(q.createdAt)}</small>
                    <Link to={'/quotes?quote=' + q.id}>Открыть цитату →</Link>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <button className="primary section-add" onClick={() => setEditor('review')}>
                {data.review?.text || data.review?.rating
                  ? 'Изменить отзыв и оценку'
                  : 'Написать отзыв'}
              </button>
              {data.review?.rating && <RatingStars value={data.review.rating} />}
              {data.review?.text ? (
                <p className="prewrap">{data.review.text}</p>
              ) : (
                <Empty title="Отзыв — по желанию" />
              )}
            </>
          )}
        </>
      )}
      <MarginDoodle className="book-dossier-doodle" />
    </Modal>
  );
}
export function PersonalThought({ book, onClose }: { book: Book; onClose: () => void }) {
  return <EntryEditor book={book} kind="thought" onClose={onClose} />;
}
