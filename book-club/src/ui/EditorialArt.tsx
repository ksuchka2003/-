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
