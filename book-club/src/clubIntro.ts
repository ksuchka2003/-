import { z } from 'zod';
export const introSchema = z.object({
  title: z.string().trim().min(1).max(100),
  text: z.string().trim().min(1).max(4000),
});
export type Intro = z.infer<typeof introSchema>;
export const defaultIntro: Intro = {
  title: 'Книжный клуб',
  text: 'Мы — книжный клуб, который зародился в Санкт-Петербурге. Мы учились на программистов, а теперь собираемся, чтобы обсуждать книги и авторов.\n\nЗдесь рождаются споры, восхищение новыми историями и разговоры о том, кто мы и что нам важно. Читаем, ищем себя, делимся идеями и находим в книгах что-то своё.',
};
const key = 'bookclub-intro';
export function cachedIntro(): Intro {
  try {
    return introSchema.parse(JSON.parse(localStorage.getItem(key) || 'null'));
  } catch {
    return defaultIntro;
  }
}
export function cacheIntro(value: unknown): Intro {
  const parsed = introSchema.safeParse(value);
  if (!parsed.success) return cachedIntro();
  try {
    localStorage.setItem(key, JSON.stringify(parsed.data));
  } catch {
    /* optional cache */
  }
  return parsed.data;
}
