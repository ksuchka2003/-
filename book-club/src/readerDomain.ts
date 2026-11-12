import { z } from 'zod';
export const entrySchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  kind: z.enum(['note', 'thought']),
  text: z.string().trim().min(1).max(50000),
  page: z.number().int().min(0).max(1000000).nullable(),
  chapter: z.string().max(300),
  published: z.boolean(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Entry = z.infer<typeof entrySchema>;
export const shelfSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(80) });
export type Shelf = z.infer<typeof shelfSchema>;
export type ContentKind = 'quote' | 'note' | 'thought' | 'review' | 'comment';
export type RootContentKind = Exclude<ContentKind, 'comment'>;
export type Reaction = {
  target_kind: ContentKind;
  target_id: string;
  member_id: string;
  value: 1 | -1;
};
export type ContentComment = {
  id: string;
  member_id: string;
  target_kind: RootContentKind;
  target_id: string;
  text: string;
  created_at: string;
  updated_at: string;
};
export type ClubEntry = {
  id: string;
  member_id: string;
  book_id: string;
  title: string;
  kind: 'note' | 'thought';
  text: string;
  page: number | null;
  chapter: string;
  created_at: string;
  updated_at: string;
};
export type ReadingChoice = 'reading' | 'already_read' | 'declined';
export type Participation = {
  reading_id: string;
  book_id: string;
  member_id: string;
  choice: ReadingChoice;
  updated_at: string;
};
export const choiceLabels: Record<ReadingChoice, string> = {
  reading: 'Читаю с клубом',
  already_read: 'Уже читал',
  declined: 'Не буду читать',
};
export const entryLabels = { note: 'Заметка', thought: 'Мысль' } as const;
export type Palette = 'library' | 'forest' | 'clay' | 'ink' | 'wine' | 'beer' | 'coffee' | 'sea';
export const paletteLabels = {
  library: 'Тёплая библиотека',
  forest: 'Лесная',
  beer: 'Пивная',
  coffee: 'Кофейная',
  sea: 'Морская',
} as const;
export function activePalette(value: unknown): keyof typeof paletteLabels {
  if (typeof value === 'string' && Object.hasOwn(paletteLabels, value))
    return value as keyof typeof paletteLabels;
  if (value === 'clay') return 'coffee';
  if (value === 'ink') return 'sea';
  return 'library';
}
