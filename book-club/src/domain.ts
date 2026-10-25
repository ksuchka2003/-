import { z } from 'zod';
export const personalStatuses = {
  planned: 'Хочу прочитать',
  reading: 'Читаю',
  finished: 'Прочитано',
  paused: 'Отложено',
} as const;
export const clubStatuses = {
  planned: 'Запланировано',
  reading: 'Читаем сейчас',
  finished: 'Прочитано клубом',
  archived: 'Архив',
} as const;
const date = z.iso.datetime();
const id = z.uuid();
export const metadataSchema = z.object({
  title: z.string().trim().min(1).max(300),
  authors: z.string().max(500),
  description: z.string().max(10000).default(''),
  genre: z.string().max(150).default(''),
  year: z.number().int().min(0).max(3000).nullable().default(null),
  isbn: z.string().max(30).default(''),
  cover: z
    .string()
    .max(2048)
    .refine((v) => !v || /^https:\/\//.test(v), 'Обложка должна иметь HTTPS-адрес')
    .default(''),
  totalPages: z.number().int().min(0).max(1000000),
});
export const bookSchema = metadataSchema.extend({
  id,
  clubBookId: id.nullable(),
  status: z.enum(['planned', 'reading', 'finished', 'paused']),
  notes: z.string().max(50000),
  publishProgress: z.boolean(),
  publishReview: z.boolean(),
  createdAt: date,
  updatedAt: date,
});
export const progressSchema = z.object({
  bookId: id,
  pages: z.number().int().min(0).max(1000000),
  updatedAt: date,
});
export const reviewSchema = z.object({
  bookId: id,
  rating: z.number().int().min(1).max(10).nullable(),
  text: z.string().max(30000),
  spoilers: z.boolean(),
  updatedAt: date,
});
export const quoteSchema = z.object({
  id,
  bookId: id,
  text: z.string().trim().min(1).max(20000),
  page: z.number().int().min(0).nullable(),
  chapter: z.string().max(300),
  comment: z.string().max(10000),
  favorite: z.boolean(),
  deletedAt: date.nullable(),
  sourceId: id.nullable(),
  sourceAuthor: z.string().max(200).nullable(),
  published: z.boolean(),
  createdAt: date,
  updatedAt: date,
});
export const privacySchema = z.object({
  show_finished: z.boolean(),
  show_current: z.boolean(),
  show_progress: z.boolean(),
  show_ratings: z.boolean(),
  show_reviews: z.boolean(),
  show_quotes: z.boolean(),
});
export const defaultPrivacy = {
  show_finished: false,
  show_current: false,
  show_progress: false,
  show_ratings: false,
  show_reviews: false,
  show_quotes: false,
};
export type Privacy = z.infer<typeof privacySchema>;
export type Book = z.infer<typeof bookSchema>;
export type Metadata = z.infer<typeof metadataSchema>;
export type Progress = z.infer<typeof progressSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type SyncOp = {
  id: string;
  scope: string;
  kind: 'progress' | 'review' | 'quote' | 'privacy';
  entityId: string;
  payload: Record<string, unknown> | null;
  revision: string;
  version: number;
  attempts: number;
  error: string;
  createdAt: string;
};
export type ClubBook = {
  id: string;
  title: string;
  authors: string;
  description: string;
  genre: string;
  year: number | null;
  isbn: string;
  cover: string;
  default_pages: number;
  status: keyof typeof clubStatuses;
};
export type Reading = {
  id: string;
  book_id: string;
  starts_on: string;
  ends_on: string | null;
  position: number;
  status: 'active' | 'finished' | 'cancelled';
};
export type Profile = {
  member_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string;
  genres: string;
  joined_at: string;
};
export type PublicProgress = {
  id: string;
  member_id: string;
  book_id: string;
  title: string;
  status: Book['status'];
  pages: number | null;
  total_pages: number | null;
  updated_at: string;
};
export type PublicReview = {
  id: string;
  member_id: string;
  book_id: string;
  title: string;
  rating: number | null;
  text: string;
  spoilers: boolean;
  updated_at: string;
};
export type PublicQuote = {
  id: string;
  member_id: string;
  book_id: string;
  title: string;
  text: string;
  page: number | null;
  chapter: string;
  comment: string;
  updated_at: string;
};
export type Meeting = {
  id: string;
  title: string;
  starts_at: string;
  place: string;
  description: string;
  cancelled: boolean;
  version: number;
};
export type Proposal = {
  id: string;
  member_id: string;
  metadata: Metadata;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  reason: string;
  book_id: string | null;
  created_at: string;
};
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export function percent(pages: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((pages / total) * 100))) : 0;
}
export function validProgress(pages: number, total: number) {
  if (
    !Number.isInteger(pages) ||
    !Number.isInteger(total) ||
    pages < 0 ||
    total < 0 ||
    pages > total
  )
    throw new Error('Прочитанные страницы должны быть от 0 до общего количества страниц');
}
export function message(e: unknown) {
  if (e instanceof z.ZodError) return 'Проверьте формат файла и допустимые значения полей.';
  if (
    e instanceof TypeError ||
    (e instanceof Error && /failed to fetch|networkerror|load failed/i.test(e.message))
  )
    return 'Не удалось связаться с сервером. Проверьте подключение и повторите.';
  return e instanceof Error ? e.message : 'Не удалось выполнить операцию';
}
