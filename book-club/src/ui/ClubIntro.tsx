import { BookOpen, LoaderCircle } from 'lucide-react';
export function ClubIntro() {
  return (
    <main className="startup-screen">
      <article className="club-intro">
        <BookOpen size={32} aria-hidden="true" />
        <p className="eyebrow">КНИЖНЫЙ КЛУБ · САНКТ-ПЕТЕРБУРГ</p>
        <h1>Книжный клуб</h1>
        <p>
          Мы — книжный клуб, который зародился в Санкт-Петербурге. Мы учились на программистов, а
          теперь собираемся, чтобы обсуждать книги и авторов.
        </p>
        <p>
          Здесь рождаются споры, восхищение новыми историями и разговоры о том, кто мы и что нам
          важно. Читаем, ищем себя, делимся идеями и находим в книгах что-то своё.
        </p>
        <div className="intro-loading" role="status">
          <LoaderCircle size={18} className="spin" />
          Открываем клуб…
        </div>
      </article>
    </main>
  );
}
