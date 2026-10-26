/**
 * Surreal illustration kit (master prompt §6.5).
 *
 * Pure inline SVG/CSS, each component well under 6 KB, always
 * aria-hidden and pointer-events:none, and colored only through
 * design tokens (tailwind arbitrary fill-/stroke- values that read
 * the CSS variables — never hard-coded colors). The same motif
 * family (sun-disc, horizon line, long cast shadows) repeats across
 * every piece so the app reads as one world.
 */

type Props = { className?: string };

/* ------------------------------------------------------------------ */
/* SunArch — floating archway in front of a half-sun on a thin         */
/* horizon line with a long diagonal shadow. Used on login.            */
/* ------------------------------------------------------------------ */
export function SunArch({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 320 260"
      className={`pointer-events-none h-auto w-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* long diagonal cast shadow */}
      <path
        d="M96 196 L40 246 L268 246 L212 196 Z"
        className="fill-[var(--orange-deep)] opacity-25"
      />
      {/* thin horizon line */}
      <line
        x1="8"
        y1="196"
        x2="312"
        y2="196"
        className="stroke-[var(--ink)]"
        strokeWidth="2"
      />
      {/* half sun disc */}
      <path
        d="M70 196 a90 90 0 0 1 180 0 Z"
        className="fill-[var(--apricot)] stroke-[var(--ink)]"
        strokeWidth="2"
      />
      {/* thin orbit ring across the sun */}
      <ellipse
        cx="160"
        cy="128"
        rx="118"
        ry="30"
        className="fill-none stroke-[var(--ink)]"
        strokeWidth="1.5"
        opacity="0.55"
      />
      {/* floating archway */}
      <path
        d="M104 196 V118 a56 56 0 0 1 112 0 V196 h-26 V120 a30 30 0 0 0 -60 0 V196 Z"
        className="fill-[var(--surface)] stroke-[var(--ink)]"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* impossible step inside the arch */}
      <rect
        x="132"
        y="166"
        width="56"
        height="12"
        className="fill-[var(--orange)] stroke-[var(--ink)]"
        strokeWidth="2"
      />
      {/* floating key-block above the arch */}
      <g className="animate-orbit" style={{ transformOrigin: "160px 62px" }}>
        <rect
          x="146"
          y="48"
          width="28"
          height="28"
          rx="3"
          className="fill-[var(--peach)] stroke-[var(--ink)]"
          strokeWidth="2"
        />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* OrbitNodes — sun-disc with orbiting institution/bureau nodes joined */
/* by 1px lines; nodes gently drift. Dashboard hero.                   */
/* ------------------------------------------------------------------ */
export function OrbitNodes({ className = "" }: Props) {
  const nodes: Array<[number, number, number]> = [
    // [cx, cy, r] — laid out on two orbit rings
    [200, 120, 9],
    [120, 34, 7],
    [52, 128, 8],
    [150, 214, 7],
    [86, 66, 6],
    [246, 176, 7],
    [232, 66, 6],
    [58, 196, 6],
  ];

  return (
    <svg
      viewBox="0 0 280 260"
      className={`pointer-events-none h-auto w-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* orbit rings */}
      <circle
        cx="140"
        cy="130"
        r="96"
        className="fill-none stroke-[var(--ink)]"
        strokeWidth="1"
        opacity="0.4"
      />
      <circle
        cx="140"
        cy="130"
        r="134"
        className="fill-none stroke-[var(--ink)]"
        strokeWidth="1"
        opacity="0.25"
      />

      {/* spokes + nodes (slow drift, transform only) */}
      <g className="animate-orbit">
        {nodes.map(([cx, cy, r], i) => (
          <g key={i}>
            <line
              x1="140"
              y1="130"
              x2={cx}
              y2={cy}
              className="stroke-[var(--indigo)]"
              strokeWidth="1"
              opacity="0.7"
            />
            <circle
              cx={cx}
              cy={cy}
              r={r}
              className="fill-[var(--surface)] stroke-[var(--ink)]"
              strokeWidth="2"
            />
          </g>
        ))}
      </g>

      {/* counter-drifting inner nodes */}
      <g className="animate-orbit-reverse">
        <circle cx="176" cy="96" r="5" className="fill-[var(--orange)]" />
        <circle cx="104" cy="170" r="5" className="fill-[var(--teal)]" />
        <line
          x1="104"
          y1="170"
          x2="176"
          y2="96"
          className="stroke-[var(--ink)]"
          strokeWidth="1"
          opacity="0.35"
        />
      </g>

      {/* central sun-disc */}
      <circle
        cx="140"
        cy="130"
        r="34"
        className="fill-[var(--orange)] stroke-[var(--ink)]"
        strokeWidth="2.5"
      />
      <circle
        cx="140"
        cy="130"
        r="46"
        className="fill-none stroke-[var(--ink)]"
        strokeWidth="1"
        opacity="0.5"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* StairsToNowhere — isometric staircase ending in a floating paper    */
/* stack. Used for empty states.                                       */
/* ------------------------------------------------------------------ */
export function StairsToNowhere({ className = "" }: Props) {
  const steps = [0, 1, 2, 3, 4];
  return (
    <svg
      viewBox="0 0 240 200"
      className={`pointer-events-none h-auto w-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* ground shadow */}
      <ellipse
        cx="96"
        cy="176"
        rx="80"
        ry="12"
        className="fill-[var(--ink)] opacity-15"
      />
      {steps.map((i) => (
        <g key={i}>
          {/* riser */}
          <path
            d={`M40 ${168 - i * 26} l24 -12 h40 l-24 12 Z`}
            className="fill-[var(--orange-deep)] stroke-[var(--ink)]"
            strokeWidth="1.5"
          />
          {/* tread */}
          <path
            d={`M40 ${168 - i * 26} l24 -12 h40 l-24 12 Z`}
            transform={`translate(0, -8)`}
            className="fill-[var(--peach)] stroke-[var(--ink)]"
            strokeWidth="1.5"
          />
        </g>
      ))}
      {/* floating paper stack where the stairs end */}
      <g className="animate-rise">
        {[0, 6, 12].map((dy) => (
          <path
            key={dy}
            d={`M140 ${64 + dy} l46 -14 l20 10 l-46 14 Z`}
            className="fill-[var(--surface)] stroke-[var(--ink)]"
            strokeWidth="1.5"
            opacity={1 - dy * 0.02}
          />
        ))}
      </g>
      {/* thin tether from last step to the papers */}
      <line
        x1="128"
        y1="76"
        x2="150"
        y2="70"
        className="stroke-[var(--ink)]"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity="0.6"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* FloatingFiles — offset document slabs with rotation and cast        */
/* shadows. Cross-Bureau intro + report headers.                       */
/* ------------------------------------------------------------------ */
export function FloatingFiles({ className = "" }: Props) {
  const files = [
    { x: 30, y: 40, rot: -7, fill: "var(--surface)" },
    { x: 92, y: 26, rot: 4, fill: "var(--peach)" },
    { x: 156, y: 48, rot: -3, fill: "var(--sand)" },
  ];
  return (
    <svg
      viewBox="0 0 260 170"
      className={`pointer-events-none h-auto w-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {files.map((f, i) => (
        <g key={i} transform={`rotate(${f.rot} ${f.x + 36} ${f.y + 46})`}>
          {/* cast shadow */}
          <rect
            x={f.x + 8}
            y={f.y + 10}
            width="72"
            height="92"
            rx="4"
            className="fill-[var(--ink)] opacity-20"
          />
          <rect
            x={f.x}
            y={f.y}
            width="72"
            height="92"
            rx="4"
            className="stroke-[var(--ink)]"
            fill={f.fill}
            strokeWidth="2"
          />
          {/* ruled lines */}
          <line
            x1={f.x + 12}
            y1={f.y + 26}
            x2={f.x + 60}
            y2={f.y + 26}
            className="stroke-[var(--ink)]"
            strokeWidth="2"
            opacity="0.65"
          />
          <line
            x1={f.x + 12}
            y1={f.y + 44}
            x2={f.x + 52}
            y2={f.y + 44}
            className="stroke-[var(--ink)]"
            strokeWidth="2"
            opacity="0.4"
          />
          <line
            x1={f.x + 12}
            y1={f.y + 60}
            x2={f.x + 56}
            y2={f.y + 60}
            className="stroke-[var(--ink)]"
            strokeWidth="2"
            opacity="0.4"
          />
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* DistortedGrid — faint perspective-warped grid; hero backgrounds     */
/* only (never behind tables/forms).                                   */
/* ------------------------------------------------------------------ */
export function DistortedGrid({ className = "" }: Props) {
  const verticals = [0, 1, 2, 3, 4, 5, 6, 7];
  const horizontals = [0, 1, 2, 3, 4, 5];
  return (
    <svg
      viewBox="0 0 400 200"
      preserveAspectRatio="none"
      className={`pointer-events-none h-full w-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {verticals.map((i) => {
        const x = 25 + i * 50;
        // lines converge slightly toward the top — perspective warp
        return (
          <line
            key={`v${i}`}
            x1={x}
            y1="200"
            x2={200 + (x - 200) * 0.62}
            y2="0"
            className="stroke-[var(--ink)]"
            strokeWidth="1"
            opacity="0.14"
          />
        );
      })}
      {horizontals.map((i) => {
        const t = i / horizontals.length;
        const y = 200 * t;
        const spread = 0.55 + 0.45 * t;
        const half = 200 * spread;
        return (
          <line
            key={`h${i}`}
            x1={200 - half}
            y1={y}
            x2={200 + half}
            y2={y}
            className="stroke-[var(--ink)]"
            strokeWidth="1"
            opacity="0.14"
          />
        );
      })}
    </svg>
  );
}
