export function CountVine() {
  return (
    <svg
      className="count-vine"
      viewBox="0 0 600 140"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 100C35 124 70 114 96 119S158 129 198 112S266 119 300 120S362 131 401 112S469 121 499 119S561 127 592 99M9 99C-2 70 5 37 22 20M591 100C603 70 594 36 578 20M23 20C61 4 139 5 180 17M220 17C260 5 340 5 380 17M420 17C463 5 540 4 577 20" />
        {[0, 200, 400].map((x) => (
          <g key={x} transform={`translate(${x} 0)`}>
            <path d="M30 22C20 12 24 5 34 8C39 15 36 20 30 22ZM49 17C44 6 52 1 62 5C61 14 56 18 49 17ZM159 18C157 7 165 4 173 9C171 17 165 21 159 18ZM58 119C47 105 53 99 65 103C69 111 64 117 58 119ZM129 123C134 110 146 109 151 116C147 125 137 128 129 123Z" />
          </g>
        ))}
      </g>
    </svg>
  );
}
