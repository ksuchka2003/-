import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ThumbsUp, ThumbsDown, MessageCircle, Pencil, Trash2, BookOpen } from 'lucide-react';
import { type Profile, uid } from '../domain';
import type { ContentKind, RootContentKind, Reaction, ContentComment } from '../readerDomain';
import { action } from '../cloud';
import { getDB } from '../db';
import {
  useCloud,
  useTask,
  useSession,
  Modal,
  Field,
  ErrorNote,
  Loading,
  dateLabel,
} from './shared';
import { useDraft, DraftNote } from './useDraft';
const nouns: Record<ContentKind, string> = {
  quote: 'цитата',
  note: 'заметка',
  thought: 'мысль',
  review: 'отзыв',
  comment: 'комментарий',
};
export function ReactionButtons({ kind, id }: { kind: ContentKind; id: string }) {
  const source = useCloud<Reaction>('content_reactions');
  const { identity } = useSession();
  const { run, busy, error } = useTask();
  const query = useQueryClient();
  const reactions = (source.data || []).filter((r) => r.target_kind === kind && r.target_id === id);
  const mine = reactions.find((r) => r.member_id === identity?.id)?.value;
  const react = async (value: 1 | -1) =>
    run(async () => {
      await action('content.reaction', {
        target_kind: kind,
        target_id: id,
        value: mine === value ? null : value,
      });
      await Promise.all([
        query.invalidateQueries({ queryKey: ['cloud', identity?.id, 'content_reactions'] }),
        query.invalidateQueries({ queryKey: ['cloud', identity?.id, 'quote_likes'] }),
        query.invalidateQueries({ queryKey: ['cloud', identity?.id, 'club_achievements'] }),
        query.invalidateQueries({ queryKey: ['reading-report'] }),
      ]);
    }, '');
  return (
    <div className="reaction-controls">
      <button
        type="button"
        className={mine === 1 ? 'selected' : ''}
        aria-label={`Нравится ${nouns[kind]}`}
        aria-pressed={mine === 1}
        disabled={!identity || busy || !!source.error}
        onClick={() => void react(1)}
      >
        <ThumbsUp size={17} />
        {source.isLoading
          ? '…'
          : source.error
            ? '—'
            : reactions.filter((r) => r.value === 1).length}
      </button>
      <button
        type="button"
        className={mine === -1 ? 'selected reaction-negative' : ''}
        aria-label={`Не нравится ${nouns[kind]}`}
        aria-pressed={mine === -1}
        disabled={!identity || busy || !!source.error}
        onClick={() => void react(-1)}
      >
        <ThumbsDown size={17} />
        {source.isLoading
          ? '…'
          : source.error
            ? '—'
            : reactions.filter((r) => r.value === -1).length}
      </button>
      <ErrorNote text={error || source.error?.message} />
    </div>
  );
}

export function DiscussionButton({
  kind,
  id,
  preview,
}: {
  kind: RootContentKind;
  id: string;
  preview?: string;
}) {
  const comments = useCloud<ContentComment>('content_comments');
  const [open, setOpen] = useState(false);
  const count =
    comments.data?.filter((c) => c.target_kind === kind && c.target_id === id).length || 0;
  return (
    <>
      <button
        type="button"
        className="discussion-action"
        aria-label="Комментарии"
        title="Комментарии"
        onClick={() => setOpen(true)}
      >
        <MessageCircle size={17} />
        {count > 0 && <span>{count}</span>}
      </button>
      {open && (
        <CommentThread kind={kind} id={id} preview={preview} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
function CommentComposer({
  kind,
  id,
  editing,
  onSaved,
}: {
  kind: RootContentKind;
  id: string;
  editing: ContentComment | null;
  onSaved: () => void;
}) {
  const [initial] = useState({ id: editing?.id || uid(), text: editing?.text || '' });
  const draft = useDraft(
    editing ? 'comment-edit:' + editing.id : 'comment:' + kind + ':' + id,
    initial,
  );
  const { run, busy, error } = useTask();
  const query = useQueryClient(),
    { identity } = useSession();
  if (!draft.value) return <Loading label="Открываем комментарий…" />;
  return (
    <form
      className="comment-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await run(
            async () => {
              await action('content.comment', {
                id: draft.value!.id,
                target_kind: kind,
                target_id: id,
                text: draft.value!.text,
              });
              await query.invalidateQueries({
                queryKey: ['cloud', identity?.id, 'content_comments'],
              });
              await draft.clear();
            },
            editing ? 'Комментарий изменён' : 'Комментарий добавлен',
          )
        )
          onSaved();
      }}
    >
      <DraftNote draft={draft} />
      <Field label={editing ? 'Редактировать комментарий' : 'Ваш комментарий'}>
        <textarea
          rows={3}
          required
          maxLength={5000}
          value={draft.value.text}
          onChange={(e) => draft.setValue((old) => ({ ...old, text: e.target.value }))}
        />
      </Field>
      <ErrorNote text={error} />
      <footer>
        <button className="primary" disabled={busy || !draft.value.text.trim()}>
          {editing ? 'Сохранить комментарий' : 'Отправить комментарий'}
        </button>
        {editing && (
          <button type="button" disabled={busy} onClick={() => void draft.clear().then(onSaved)}>
            Отменить редактирование
          </button>
        )}
      </footer>
    </form>
  );
}
function CommentThread({
  kind,
  id,
  preview,
  onClose,
}: {
  kind: RootContentKind;
  id: string;
  preview?: string;
  onClose: () => void;
}) {
  const comments = useCloud<ContentComment>('content_comments'),
    profiles = useCloud<Profile>('member_profiles');
  const { identity } = useSession(),
    query = useQueryClient();
  const { run, busy, error } = useTask();
  const [editing, setEditing] = useState<ContentComment | null>(null),
    [composer, setComposer] = useState(0),
    [limit, setLimit] = useState(20);
  const rows = (comments.data || [])
    .filter((c) => c.target_kind === kind && c.target_id === id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return (
    <Modal title="Комментарии" onClose={onClose}>
      {preview && (
        <p className="comment-preview">
          {preview.slice(0, 260)}
          {preview.length > 260 ? '…' : ''}
        </p>
      )}
      <ErrorNote text={error || comments.error?.message} />
      {comments.isLoading ? (
        <Loading label="Загружаем обсуждение…" />
      ) : (
        !comments.error && (
          <div className="comment-list">
            {!rows.length && <p className="section-hint">Комментариев пока нет.</p>}
            {rows.slice(0, limit).map((c) => (
              <article className="content-comment" key={c.id}>
                <div className="comment-heading">
                  <Link to={`/members/${c.member_id}`} onClick={onClose}>
                    {profiles.data?.find((p) => p.member_id === c.member_id)?.name ||
                      'Участник клуба'}
                  </Link>
                  <small>{dateLabel(c.created_at)}</small>
                </div>
                <p className="prewrap">{c.text}</p>
                <div className="actions">
                  <ReactionButtons kind="comment" id={c.id} />
                  {c.member_id === identity?.id && (
                    <button
                      type="button"
                      aria-label="Редактировать комментарий"
                      onClick={() => setEditing(c)}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {(c.member_id === identity?.id || identity?.role === 'admin') && (
                    <button
                      type="button"
                      className="danger"
                      aria-label="Удалить комментарий"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm('Удалить комментарий?')) return;
                        void run(async () => {
                          await action('content.comment.delete', { id: c.id });
                          await getDB().settings.delete('_draft:comment-edit:' + c.id);
                          await query.invalidateQueries({
                            queryKey: ['cloud', identity?.id, 'content_comments'],
                          });
                          if (editing?.id === c.id) setEditing(null);
                        }, 'Комментарий удалён');
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )
      )}
      {rows.length > limit && (
        <button className="load-more" onClick={() => setLimit((v) => v + 20)}>
          Показать ещё комментарии
        </button>
      )}
      <CommentComposer
        key={`${editing?.id || 'new'}:${composer}`}
        kind={kind}
        id={id}
        editing={editing}
        onSaved={() => {
          setEditing(null);
          setComposer((v) => v + 1);
        }}
      />
    </Modal>
  );
}

export function SourceDisclosure({
  title,
  bookId,
  personalId,
  page,
  chapter,
  attribution,
  savedFrom,
}: {
  title?: string;
  bookId?: string | null;
  personalId?: string | null;
  page?: number | null;
  chapter?: string;
  attribution?: string;
  savedFrom?: string | null;
}) {
  return (
    <details className="source-disclosure">
      <summary>
        <BookOpen size={15} />
        Источник
      </summary>
      {title ? (
        bookId ? (
          <Link to={`/club/${bookId}`}>{title}</Link>
        ) : personalId ? (
          <Link to={`/books?book=${personalId}`}>{title}</Link>
        ) : (
          <p>{title}</p>
        )
      ) : (
        <p className="muted">Без привязки к книге</p>
      )}
      {page !== null && page !== undefined && <small>Стр. {page}</small>}
      {chapter && <small>{chapter}</small>}
      {attribution && <p>{attribution}</p>}
      {savedFrom && <small>Сохранено от {savedFrom}</small>}
    </details>
  );
}
