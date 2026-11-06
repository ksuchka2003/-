type Meeting = {
  version: number;
  starts_at: string;
  cancelled: boolean;
  title: string;
  place: string;
  venue_url?: string;
  description: string;
};
export function shouldNotify(
  job: { kind: string; meeting_version: number },
  meeting: Meeting,
  active: boolean,
  _attendance: unknown = null,
  now = Date.now(),
) {
  if (!active || meeting.version !== job.meeting_version) return false;
  if (meeting.cancelled) return job.kind === 'cancelled';
  return job.kind !== 'cancelled' && Date.parse(meeting.starts_at) > now;
}
export function meetingNotificationText(kind: string, meeting: Meeting, now = Date.now()) {
  const mskDay = (date: number) => new Date(date + 3 * 3600000).toISOString().slice(0, 10);
  const tomorrow = mskDay(Date.parse(meeting.starts_at)) === mskDay(now + 86400000);
  const prefix: Record<string, string> = {
    new: 'Новая встреча книжного клуба',
    changed: 'Встреча книжного клуба изменилась',
    cancelled: 'Встреча книжного клуба отменена',
    '24h': tomorrow
      ? 'Напоминание: до завтра нужно дочитать книгу, мои золотые, потому что завтра у нас книжный клуб.'
      : 'Напоминание: нужно дочитать книгу, мои золотые, потому что скоро у нас книжный клуб.',
    '1h': 'Скоро встречаемся в книжном клубе',
  };
  const date = new Date(meeting.starts_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const heading =
    kind === '24h'
      ? `${prefix[kind]}\n\n${meeting.title}`
      : `${prefix[kind] || 'Встреча книжного клуба'}: ${meeting.title}`;
  return `${heading}\nКогда: ${date} (МСК)\nМесто: ${meeting.place || 'Уточняем в чате'}${meeting.venue_url ? '\n' + meeting.venue_url : ''}${meeting.description ? '\n\n' + meeting.description : ''}`.slice(
    0,
    4000,
  );
}
export function selectedBookText(book: { title: string; authors: string }) {
  return `Выбранная книга: ${book.title}${book.authors ? ' — ' + book.authors : ''}`.slice(0, 4000);
}
