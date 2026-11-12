import { PaperSelect } from './PaperSelect';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { action } from '../cloud';
import type { ClubBook, Reading } from '../domain';
import { personalStatuses } from '../domain';
import { choiceLabels } from '../readerDomain';
import { Field, useCloud, useSession, Loading, ErrorNote, Empty } from './shared';
type Bar = { label: string; pages: number; updates: number };
type Reader = {
  member_id: string;
  name: string;
  choice: keyof typeof choiceLabels | null;
  status: keyof typeof personalStatuses | null;
  pages: number | null;
  total_pages: number | null;
  percent: number | null;
  completed_at: string | null;
};
type Post = {
  id: string;
  kind: string;
  author: string;
  text: string;
  likes: number;
  dislikes: number;
  comments: number;
};
type Report = {
  book: ClubBook;
  reading: Reading | null;
  cycles: Reading[];
  generated_at: string;
  timezone: string;
  readers: Reader[];
  finishers: { member_id: string; name: string; completed_at: string }[];
  activity: { pages_logged: number; updates: number; corrections: number; baselines: number };
  periods: Bar[];
  weekdays: Bar[];
  timeline: { date: string; pages: number; updates: number }[];
  member_activity: {
    name: string;
    member_id: string;
    date: string;
    period: string;
    pages: number;
    updates: number;
  }[];
  top_liked: Post[];
  top_disliked: Post[];
};
const reportDate = (value: string) =>
  new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
const kinds: Record<string, string> = {
  quote: 'Цитата',
  note: 'Заметка',
  thought: 'Мысль',
  review: 'Отзыв',
};
const escapeHTML = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]!,
  );
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function reportHTML(r: Report) {
  const table = (head: string[], rows: unknown[][]) =>
    '<table><thead><tr>' +
    head.map((h) => '<th>' + escapeHTML(h) + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows
      .map((row) => '<tr>' + row.map((v) => '<td>' + escapeHTML(v) + '</td>').join('') + '</tr>')
      .join('') +
    '</tbody></table>';
  return (
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Отчёт: ' +
    escapeHTML(r.book.title) +
    '</title><style>body{font:16px/1.6 system-ui;max-width:960px;margin:auto;padding:24px;color:#303b32}table{width:100%;border-collapse:collapse;margin-bottom:24px}td,th{padding:10px;border:1px solid #ddd;text-align:left}blockquote{white-space:pre-wrap;margin:16px 0;padding:16px;background:#f2f2ed}small{color:#666}@media print{body{padding:0}tr{break-inside:avoid}}</style><h1>' +
    escapeHTML(r.book.title) +
    '</h1><p>' +
    escapeHTML(r.book.authors) +
    '</p><p>Обновления прогресса · МСК · ' +
    escapeHTML(reportDate(r.generated_at)) +
    '</p><p>Учтено страниц: ' +
    r.activity.pages_logged +
    '. Положительных обновлений: ' +
    r.activity.updates +
    '.</p><h2>Участники</h2>' +
    table(
      ['Участник', 'Участие', 'Прогресс', 'Закончил'],
      r.readers.map((p) => [
        p.name,
        p.choice ? choiceLabels[p.choice] : 'Нет решения',
        p.pages === null ? '—' : p.pages + ' / ' + (p.total_pages || '?'),
        p.completed_at ? reportDate(p.completed_at) : '—',
      ]),
    ) +
    '<h2>Порядок завершения</h2>' +
    table(
      ['Место', 'Участник', 'Дата'],
      r.finishers.map((p, i) => [i + 1, p.name, reportDate(p.completed_at)]),
    ) +
    '<h2>Время обновления</h2>' +
    table(
      ['Период', 'Страниц', 'Обновлений'],
      r.periods.map((p) => [p.label, p.pages, p.updates]),
    ) +
    '<h2>Дни недели</h2>' +
    table(
      ['День', 'Страниц', 'Обновлений'],
      r.weekdays.map((p) => [p.label, p.pages, p.updates]),
    ) +
    '<h2>Журнал участников</h2>' +
    table(
      ['Участник', 'Дата', 'Время', 'Страниц', 'Обновлений'],
      (r.member_activity || []).map((p) => [p.name, p.date, p.period, p.pages, p.updates]),
    ) +
    [
      ['Самые залайканные', r.top_liked],
      ['Самые задизлайканные', r.top_disliked],
    ]
      .map(
        ([label, values]) =>
          '<h2>' +
          label +
          '</h2>' +
          (values as Post[])
            .map(
              (p) =>
                '<blockquote><b>' +
                escapeHTML(kinds[p.kind]) +
                ' · ' +
                escapeHTML(p.author) +
                '</b><p>' +
                escapeHTML(p.text) +
                '</p><small>👍 ' +
                p.likes +
                ' · 👎 ' +
                p.dislikes +
                ' · комментариев ' +
                p.comments +
                '</small></blockquote>',
            )
            .join(''),
      )
      .join('') +
    '<p>Это время изменения прогресса, а не измерение времени чтения. Импорт, исправления и смена издания не считаются прочитанными страницами. Ранние данные могли не сохраняться. Личные записи в отчёт не входят.</p></html>'
  );
}
function Bars({ values }: { values: Bar[] }) {
  const max = Math.max(1, ...values.map((p) => Number(p.pages)));
  return (
    <div className="report-bars">
      {values.map((p) => (
        <div key={p.label}>
          <span>{p.label}</span>
          <div className="progress">
            <i style={{ width: (Number(p.pages) / max) * 100 + '%' }} />
          </div>
          <b>{p.pages} стр.</b>
        </div>
      ))}
    </div>
  );
}
export function AdminReadingReport() {
  const { identity } = useSession(),
    books = useCloud<ClubBook>('club_books'),
    readings = useCloud<Reading>('club_readings');
  const [bookId, setBookId] = useState(''),
    [cycle, setCycle] = useState(''),
    [search, setSearch] = useState('');
  const report = useQuery<Report>({
    queryKey: ['reading-report', identity?.id, bookId, cycle],
    enabled: !!bookId && identity?.role === 'admin',
    queryFn: () =>
      action(
        'admin.reading_report',
        {
          book_id: bookId,
          reading_id: cycle === 'all' ? null : cycle || null,
          all_cycles: cycle === 'all',
        },
        identity!.id,
      ),
  });
  const r = report.data;
  return (
    <div className="reading-report">
      <Field label="Найти книгу для отчёта">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Название или автор"
        />
      </Field>
      <PaperSelect
        label="Книга"
        value={bookId}
        onChange={(value) => {
          setBookId(value);
          setCycle('');
        }}
        options={[
          { value: '', label: 'Выберите книгу' },
          ...(books.data || [])
            .filter(
              (b) =>
                b.id === bookId ||
                (b.title + ' ' + b.authors)
                  .toLocaleLowerCase('ru')
                  .includes(search.toLocaleLowerCase('ru')),
            )
            .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
            .map((b) => ({ value: b.id, label: b.title })),
        ]}
      />
      {bookId && (
        <PaperSelect
          label="Период клубного чтения"
          value={cycle}
          onChange={setCycle}
          options={[
            { value: '', label: 'Текущее или последнее чтение' },
            ...(readings.data || [])
              .filter((p) => p.book_id === bookId)
              .map((p) => ({
                value: p.id,
                label: `${p.starts_on} — ${p.ends_on || 'без даты'} · ${p.status === 'active' ? 'читаем' : p.status === 'finished' ? 'завершено' : 'отменено'}`,
              })),
            { value: 'all', label: 'Все чтения этой книги' },
          ]}
        />
      )}
      <ErrorNote text={report.error?.message || books.error?.message} />
      {report.isFetching ? (
        <Loading label="Собираем отчёт…" />
      ) : r ? (
        <>
          <div className="section-title">
            <h2>{r.book.title}</h2>
            <button onClick={() => void report.refetch()}>Обновить</button>
          </div>
          <p className="section-hint">
            Время обновления прогресса, МСК. Это не таймер чтения. История начинается с подключения
            этой функции.
          </p>
          <div className="stats">
            <div>
              <b>{r.activity.pages_logged}</b>
              <span>страниц отмечено</span>
            </div>
            <div>
              <b>{r.activity.updates}</b>
              <span>обновлений прогресса</span>
            </div>
            <div>
              <b>{r.finishers.length}</b>
              <span>отметок о завершении</span>
            </div>
          </div>
          <details className="book-extra" open>
            <summary>Кто как прочитал</summary>
            <div className="report-readers">
              {r.readers.map((p) => (
                <article key={p.member_id}>
                  <b>{p.name}</b>
                  <small>
                    {p.choice ? choiceLabels[p.choice] : 'Нет решения'}
                    {p.status && p.choice === 'reading' ? ' · ' + personalStatuses[p.status] : ''}
                  </small>
                  {p.pages !== null && (
                    <small>
                      {p.pages} / {p.total_pages || '?'} стр.{' '}
                      {p.percent !== null ? '· ' + p.percent + '%' : ''}
                    </small>
                  )}
                  {p.completed_at && <small>Закончил(а) {reportDate(p.completed_at)}</small>}
                </article>
              ))}
            </div>
          </details>
          {!!r.finishers.length && (
            <section className="panel">
              <h3>Порядок завершения</h3>
              <ol>
                {r.finishers.map((p) => (
                  <li key={p.member_id + p.completed_at}>
                    {p.name} · {reportDate(p.completed_at)}
                  </li>
                ))}
              </ol>
              <small className="muted">
                Прочитавшие до клуба не участвуют. Последний определяется, когда все участники
                чтения закончили.
              </small>
            </section>
          )}
          <details className="book-extra">
            <summary>Днём или вечером</summary>
            <Bars values={r.periods} />
          </details>
          <details className="book-extra">
            <summary>В какие дни недели</summary>
            <Bars values={r.weekdays} />
          </details>
          <details className="book-extra">
            <summary>Журнал обновлений участников</summary>
            {(r.member_activity || []).length ? (
              <div className="report-readers">
                {r.member_activity.map((p, i) => (
                  <article key={i}>
                    <b>{p.name}</b>
                    <small>
                      {p.date} · {p.period}
                    </small>
                    <span>
                      {p.pages} стр. · обновлений: {p.updates}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="quiet-empty">Пока нет обновлений.</p>
            )}
          </details>
          {[
            ['Самые залайканные записи', r.top_liked],
            ['Самые задизлайканные записи', r.top_disliked],
          ].map(([label, values]) => (
            <details className="book-extra" key={label as string}>
              <summary>{label as string}</summary>
              {!(values as Post[]).length && <p className="quiet-empty">Таких реакций пока нет.</p>}
              {(values as Post[]).map((p) => (
                <article className="quote-card" key={p.kind + p.id}>
                  <b>
                    {kinds[p.kind]} · {p.author}
                  </b>
                  <p className="prewrap">{p.text}</p>
                  <small>
                    👍 {p.likes} · 👎 {p.dislikes} · комментариев {p.comments}
                  </small>
                </article>
              ))}
            </details>
          ))}
          <div className="actions">
            <button
              onClick={() =>
                download(reportHTML(r), 'book-club-report.html', 'text/html;charset=utf-8')
              }
            >
              Скачать отчёт
            </button>
            <button
              onClick={() =>
                download(JSON.stringify(r, null, 2), 'book-club-report.json', 'application/json')
              }
            >
              Данные JSON
            </button>
          </div>
          <small className="muted">
            Обновлено {reportDate(r.generated_at)}. Исправлений: {r.activity.corrections}; исходных
            отметок: {r.activity.baselines}.
          </small>
        </>
      ) : (
        !report.error && <Empty title="Выберите книгу для отчёта" />
      )}
    </div>
  );
}
