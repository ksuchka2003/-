import readersAtlas from '../assets/illustrations/readers-atlas.png';
import clubLifeAtlas from '../assets/illustrations/club-life-atlas.png';

export type ReaderScene =
  | 'reader'
  | 'coffee'
  | 'conversation'
  | 'headphones'
  | 'carrying'
  | 'writing'
  | 'discussion'
  | 'boardgames';
const clubLifeScenes: readonly ReaderScene[] = ['carrying', 'writing', 'discussion', 'boardgames'];

export function PaperTape({ className = '' }: { className?: string }) {
  return <span className={`paper-tape ${className}`} aria-hidden="true" />;
}

export function MarginDoodle({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`margin-doodle ${className}`}
      viewBox="0 0 140 68"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 48L43 43L63 50L28 57Z M9 48V54L28 63L63 56V50M28 57V63M15 43L43 39L66 46M20 38L45 35L63 40M76 27C74 45 78 51 90 51C100 51 103 42 102 27ZM102 30C116 27 114 41 102 41M72 55C83 61 104 60 110 54M82 19C73 11 88 8 83 2M94 19C88 13 100 9 95 4M119 18L122 11L124 18L132 20L124 22L122 29L120 22L114 20Z" />
        <path d="M7 65C42 67 78 65 108 64" opacity=".4" />
      </g>
    </svg>
  );
}

export function BookmarkTab() {
  return <span className="bookmark-tab" aria-hidden="true" />;
}

export function PaperFrame() {
  return (
    <span className="profile-paper-frame" aria-hidden="true">
      {[0, 1, 2, 3].map((corner) => (
        <span className="paper-frame-corner" key={corner} />
      ))}
      <BotanicalSprig className="paper-frame-sprig" />
      <BookplateSticker className="paper-frame-sticker" />
    </span>
  );
}

/** Artwork is decoration, never a profile picture or user publication. */
export function ReaderIllustration({
  scene,
  className = '',
}: {
  scene: ReaderScene;
  className?: string;
}) {
  return (
    <span
      className={`reader-illustration reader-${scene} ${className}`}
      data-reader-scene={scene}
      aria-hidden="true"
    >
      <img
        src={clubLifeScenes.includes(scene) ? clubLifeAtlas : readersAtlas}
        alt=""
        decoding="async"
        draggable="false"
      />
    </span>
  );
}

const paperLines = [
  'На полях остаются слова, к которым однажды хочется вернуться.',
  'Страницы остаются с нами: в разговорах, заметках и воспоминаниях.',
  'Мы читаем, чтобы замечать больше. В мире, в людях и в самих себе.',
  'Одна история заканчивается, другая начинается между её строк.',
];

export function PaperFragment({
  className = '',
  ruled = false,
}: {
  className?: string;
  ruled?: boolean;
}) {
  return (
    <span
      className={`paper-fragment ${ruled ? 'paper-ruled' : ''} ${className}`}
      aria-hidden="true"
    >
      <span className="paper-print">
        {[...paperLines, ...paperLines, ...paperLines].map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </span>
    </span>
  );
}

export function HeadingCollage({ scene }: { scene: ReaderScene }) {
  return (
    <span className={`heading-collage heading-collage-${scene}`} aria-hidden="true">
      <PaperFragment />
      <PaperFragment className="paper-layer" ruled />
      <PaperTape />
      <BotanicalSprig className="heading-sprig" />
      <ReaderIllustration scene={scene} />
    </span>
  );
}

export function BookplateSticker({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`bookplate-sticker ${className}`}
      viewBox="0 0 32 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 3H30V37H2Z" fill="var(--paper-piece)" />
      <path d="M5 6H27V34H5Z" stroke="currentColor" strokeWidth=".65" strokeDasharray="1 2.5" />
      <path
        d="M9 15C12 13 14 14 16 16C18 14 21 13 24 15V25C21 23 19 24 16 26C13 24 11 23 9 25ZM16 16V26M11 18L14 19M18 19L22 18M11 21L14 22M18 22L22 21"
        stroke="currentColor"
        strokeWidth=".8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BotanicalSprig({ className = '' }: { className?: string }) {
  const leaves = [
    [88, 185, -62, 1],
    [101, 163, 32, 0.9],
    [76, 146, -68, 0.85],
    [111, 126, 24, 1],
    [81, 107, -55, 0.78],
    [118, 86, 38, 0.8],
    [95, 68, -30, 0.65],
    [132, 54, 25, 0.6],
  ];
  return (
    <svg
      className={'botanical-sprig ' + className}
      viewBox="0 0 180 240"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round">
        <path d="M68 231C99 187 93 159 101 131S115 77 132 37M88 185L65 171M101 163L120 145M76 146L95 157M111 126L133 110M81 107L105 127M118 86L139 69M95 68L117 87M132 54L142 34" />
        {leaves.map(([x, y, angle, scale], i) => (
          <g
            key={i}
            transform={'translate(' + x + ' ' + y + ') rotate(' + angle + ') scale(' + scale + ')'}
          >
            <path d="M0 0C-1-12 6-26 14-33C20-20 16-7 0 0Z" />
            <path d="M1-2L13-30M4-9L2-16M7-17L14-20M8-21L7-27" strokeWidth=".65" />
          </g>
        ))}
        <path d="M132 37C121 32 119 21 123 14C134 16 140 28 132 37ZM132 37C141 34 148 24 146 16C135 17 130 27 132 37ZM63 215C53 197 43 189 32 183M66 211C57 204 48 206 44 213C53 220 60 218 66 211ZM57 199C54 187 45 183 39 187C39 197 47 202 57 199Z" />
        <path d="M100 200L124 187M124 187C131 174 141 172 148 176C142 188 133 192 124 187ZM109 195C107 181 113 172 120 170C124 181 121 190 109 195Z" />
      </g>
    </svg>
  );
}
