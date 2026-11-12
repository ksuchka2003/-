import type { Intro } from '../clubIntro';
import { PaletteMotif } from './PaletteMotif';
export function ClubIntro({
  intro,
  ready,
  held,
  onHold,
}: {
  intro: Intro;
  ready: boolean;
  held: boolean;
  onHold: (value: boolean) => void;
}) {
  return (
    <main
      className="startup-screen"
      data-held={held}
      tabIndex={0}
      aria-label="О книжном клубе"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
      onBlur={() => onHold(false)}
      onKeyDown={(e) => {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          onHold(true);
        }
      }}
      onKeyUp={(e) => {
        if (e.code === 'Space' || e.code === 'Enter') onHold(false);
      }}
    >
      <article className="club-intro">
        <p className="eyebrow">КНИЖНЫЙ КЛУБ · САНКТ-ПЕТЕРБУРГ</p>
        <h1>{intro.title}</h1>
        <p className="intro-text">{intro.text}</p>
        <p className="intro-hold">
          {held
            ? 'Читай спокойно. Отпусти, чтобы открыть клуб.'
            : 'Удерживай экран, чтобы дочитать.'}
        </p>
        <div className="intro-loading" role="status">
          <div
            className="intro-track"
            data-ready={ready}
            role="progressbar"
            aria-label="Подключение к клубу"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={ready ? 100 : undefined}
          >
            <span className="intro-token">
              <PaletteMotif />
            </span>
          </div>
          <span>{ready ? 'Клуб готов' : 'Открываем клуб…'}</span>
        </div>
      </article>
    </main>
  );
}
