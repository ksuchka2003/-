import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '../db';
import type { ClubBook, Reading } from '../domain';
import { choiceLabels, type Participation, type ReadingChoice } from '../readerDomain';
import { chooseClubReading } from '../readerLocal';
import { useCloud, useSession, useTask, ErrorNote, Modal } from './shared';
export function useReadingDecision(bookId?: string | null) {
  const { identity } = useSession();
  const readings = useCloud<Reading>('club_readings');
  const books = useCloud<ClubBook>('club_books');
  const decisions = useCloud<Participation>('visible_reading_participation');
  const pending = useLiveQuery(() => getDB().sync_queue.toArray()) || [];
  const book = books.data?.find((b) => b.id === bookId);
  const reading =
    book && !['finished', 'archived'].includes(book.status)
      ? readings.data?.find((r) => r.book_id === bookId && r.status === 'active')
      : undefined;
  const confirmed = decisions.data?.find(
    (p) => p.reading_id === reading?.id && p.member_id === identity?.id,
  );
  const operation = pending.find(
    (p) => p.kind === 'participation' && p.entityId === reading?.id && p.scope === identity?.id,
  );
  const choice = (operation?.payload?.choice as ReadingChoice | undefined) || confirmed?.choice;
  const loading = !!(identity && bookId && (!books.data || !readings.data || !decisions.data));
  return {
    reading,
    confirmed,
    choice,
    loading,
    pending: !!operation,
    canPublish:
      !loading && (!reading || (choice !== 'declined' && confirmed?.choice !== 'declined')),
    error: operation?.error || decisions.error?.message || '',
  };
}
export function PublicationPermission({ bookId }: { bookId?: string | null }) {
  const decision = useReadingDecision(bookId);
  return decision.canPublish ? null : (
    <p className="notice">
      {decision.loading
        ? 'Проверяем статус клубного чтения. Приватные записи можно сохранять сейчас.'
        : 'Вы выбрали «Не буду читать». Во время текущего чтения клуба для публикации нужно сначала изменить решение. Приватные записи доступны.'}
    </p>
  );
}
export function ClubReadingDecision({ book }: { book: ClubBook }) {
  const decision = useReadingDecision(book.id);
  const own = useLiveQuery(
    () => getDB().personal_books.where('clubBookId').equals(book.id).first(),
    [book.id],
  );
  const [open, setOpen] = useState(false);
  const { run, busy, error } = useTask();
  const navigate = useNavigate();
  if (!decision.reading) return null;
  const choose = async (choice: ReadingChoice) => {
    if (
      choice === 'reading' &&
      own?.status === 'finished' &&
      !confirm(
        'Начать читать заново? Прогресс начнётся с нуля. Цитаты, заметки и мысли сохранятся.',
      )
    )
      return;
    let id: string | null = null;
    if (
      await run(
        async () => {
          id = (await chooseClubReading(book, decision.reading!.id, choice))?.id || null;
        },
        choice === 'declined' ? 'Решение сохранено на устройстве' : 'Книга в личной библиотеке',
      )
    ) {
      setOpen(false);
      if (id) navigate(`/books?book=${id}&action=edit&setup=1`);
    }
  };
  const options = (
    <div className="reading-decision-options">
      <button className="primary" disabled={busy} onClick={() => void choose('reading')}>
        Буду читать
      </button>
      <button disabled={busy} onClick={() => void choose('already_read')}>
        Уже читал
      </button>
      <button disabled={busy} onClick={() => void choose('declined')}>
        Не буду читать
      </button>
      <ErrorNote text={error} />
    </div>
  );
  return (
    <div className="reading-decision">
      {decision.choice ? (
        <>
          <div className="decision-summary">
            <button
              className="badge reading-choice"
              type="button"
              aria-label="Изменить решение"
              onClick={() => setOpen(true)}
            >
              {decision.choice === 'reading' && own?.status === 'finished'
                ? 'Прочитано'
                : decision.choice === 'reading' && own?.status === 'abandoned'
                  ? 'Бросил'
                  : choiceLabels[decision.choice]}
              <ChevronDown size={15} aria-hidden="true" />
            </button>
          </div>
          {decision.pending && <small role="status">Статус ожидает синхронизации</small>}
          {decision.choice === 'declined' && (
            <p className="section-hint">Можно следить за клубом и присоединиться позже.</p>
          )}
        </>
      ) : (
        options
      )}
      <ErrorNote text={decision.error} />
      {open && (
        <Modal title="Моё участие в чтении" onClose={() => setOpen(false)}>
          <p className="form-context">{book.title}</p>
          {options}
        </Modal>
      )}
    </div>
  );
}
