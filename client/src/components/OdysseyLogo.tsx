interface Props {
  size?: number;
}

/**
 * Greek sailboat (trireme-style) icon for the Odyssey brand.
 * Hull uses --color-accent, sail uses --color-accent3 (amber).
 * No background — transparent SVG only.
 */
export default function OdysseyLogo({ size = 28 }: Props) {
  // viewBox is 56 × 40; preserve aspect ratio
  const h = Math.round((size * 40) / 56);

  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 56 40"
      fill="none"
      aria-hidden="true"
    >
      {/* ── Sail ── amber/accent3, slight billow on left side */}
      <path
        d="M16 9 L40 9 L34 27 L22 27 C19 22 17 15 16 9Z"
        fill="var(--color-accent3)"
        fillOpacity="0.85"
      />

      {/* ── Mast ── */}
      <rect
        x="27"
        y="5"
        width="2"
        height="22"
        rx="1"
        fill="var(--color-accent)"
      />

      {/* ── Yard arm ── */}
      <rect
        x="14"
        y="7"
        width="28"
        height="2"
        rx="1"
        fill="var(--color-accent)"
      />

      {/*
        ── Hull ──
        One closed path: left curl tip → top rail → right curl tip →
        right side down → curved bottom → left side up → back to tip.

        Left curl tip is at (8, 14): curves right-downward into hull rail.
        Right curl tip is at (48, 14): curves left-downward into hull rail.
        Bottom bows down slightly via a quadratic bezier.
      */}
      <path
        d={[
          'M 8 14',
          'C 10 14 11 17 11 21',   // left curl → top rail
          'L 45 21',               // top rail
          'C 45 17 46 14 48 14',   // top rail → right curl tip
          'C 50 14 51 17 50 21',   // right curl tip → down
          'L 50 33',               // right side down
          'Q 28 37 6 33',          // curved bottom
          'L 6 21',                // left side up
          'C 5 17 6 14 8 14',      // back to left curl tip
          'Z',
        ].join(' ')}
        fill="var(--color-accent)"
      />

      {/* ── Oar ports ── small dots along the hull mid-rail */}
      {[16, 21, 26, 31, 36, 41].map((x) => (
        <circle key={x} cx={x} cy={27} r={1.2} fill="var(--color-bg)" fillOpacity="0.5" />
      ))}
    </svg>
  );
}
