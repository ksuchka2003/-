import { it, expect } from 'vitest';
import { cleanOcrText, validatePhoto } from '../src/ocr';
import {
  shouldNotify,
  meetingNotificationText,
  selectedBookText,
} from '../supabase/functions/_shared/meeting-notifications';
it('проверяет размер и формат фотографии, убирает переносы строк внутри слова', () => {
  expect(() => validatePhoto(new File(['a'], 'photo.heic', { type: 'image/heic' }))).toThrow('JPG');
  expect(() => validatePhoto(new File([], 'empty.jpg', { type: 'image/jpeg' }))).toThrow('пуста');
  expect(() =>
    validatePhoto(
      new File([new Uint8Array(16 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' }),
    ),
  ).toThrow('15 МБ');
  expect(cleanOcrText('  Тихая биб-\nлиотека\n\n\nждёт читателей. ')).toBe(
    'Тихая библиотека\n\nждёт читателей.',
  );
});
const now = Date.parse('2030-04-10T10:00:00Z');
const m = {
  title: 'Встреча',
  version: 2,
  schedule_version: 2,
  starts_at: '2030-04-11T10:00:00Z',
  cancelled: false,
  place: 'Кафе',
  description: 'Обсудим финал',
  venue_url: 'https://maps.example/place',
};
const job = { kind: '24h', meeting_version: 2 };
it('не отправляет устаревшие и прошедшие встречи; старые ответы о посещении не влияют на уведомления', () => {
  expect(shouldNotify(job, m, true, null, now)).toBe(true);
  expect(shouldNotify(job, m, false, null, now)).toBe(false);
  expect(shouldNotify({ ...job, meeting_version: 1 }, m, true, null, now)).toBe(false);
  expect(shouldNotify(job, { ...m, cancelled: true }, true, null, now)).toBe(false);
  expect(shouldNotify(job, m, true, { response: 'no', schedule_version: 2 }, now)).toBe(true);
  expect(shouldNotify(job, m, true, { response: 'no', schedule_version: 1 }, now)).toBe(true);
  expect(shouldNotify(job, m, true, null, now + 2 * 86400000)).toBe(false);
});
it('сообщение содержит дату, московское время, место, ссылку и описание без секретов', () => {
  const text = meetingNotificationText('24h', m, now);
  expect(text).toContain(
    'Напоминание: до завтра нужно дочитать книгу, мои золотые, потому что завтра у нас книжный клуб.',
  );
  expect(text).toContain('13:00');
  expect(text).toContain('https://maps.example/place');
  expect(text).toContain('Обсудим финал');
  expect(meetingNotificationText('new', m)).not.toContain('Сможете прийти?');
  expect(meetingNotificationText('24h', m, now + 23 * 3600000)).not.toContain('завтра');
  expect(selectedBookText({ title: 'Охота на овец', authors: 'Харуки Мураками' })).toBe(
    'Выбранная книга: Охота на овец — Харуки Мураками',
  );
});
