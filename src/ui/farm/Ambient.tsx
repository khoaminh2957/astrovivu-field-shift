/**
 * Small life in the farm drawing: birds, smoke, pollinators, a grower in the rows, a dog and hens,
 * light on the water, rain splashing. All of it is decoration (docs/FARM.md §1): each part is only
 * switched on or off, or sped up, by a reading the scene already carries (the sky, the wind, the
 * crop's stage, the paddy water), and none of it stands for a reading of its own.
 *
 * Motion is CSS (farm.css) on a few dozen nodes at most, and stops under `prefers-reduced-motion`.
 */
import type { CSSProperties } from 'react';

const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

// ------------------------------------------------------------------------------------------------
// Sky
// ------------------------------------------------------------------------------------------------

/** Slow rays turning around the sun. The sun group carries the opacity of the sky. */
export function SunRays({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`} aria-hidden>
      <g className="farm-rays" fill="#fff3c4" opacity={0.28}>
        {Array.from({ length: 10 }, (_, k) => (
          <path key={k} d="M -7 -58 L 0 -250 L 7 -58 Z" transform={`rotate(${k * 36 + (k % 2) * 9})`} opacity={k % 2 ? 0.55 : 1} />
        ))}
      </g>
    </g>
  );
}

function Bird({ x, y, s, d }: { x: number; y: number; s: number; d: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path className="farm-flap" style={delay(d)} d="M -10 0 Q -5 -7 0 0 Q 5 -7 10 0" fill="none" stroke="#2f4152" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** Two small flocks crossing the sky, in clear weather only. */
export function Birds({ show }: { show: boolean }) {
  return (
    <g className="farm-fade farm-motion-only" opacity={show ? 1 : 0} data-farm="birds" aria-hidden>
      <g className="farm-flock" style={delay(-6)}>
        <Bird x={0} y={128} s={1} d={0} />
        <Bird x={-26} y={118} s={0.8} d={-0.12} />
        <Bird x={-30} y={142} s={0.85} d={-0.2} />
      </g>
      <g className="farm-flock farm-flock-slow" style={delay(-31)}>
        <Bird x={0} y={232} s={0.7} d={-0.1} />
        <Bird x={-22} y={224} s={0.6} d={-0.25} />
      </g>
    </g>
  );
}

// ------------------------------------------------------------------------------------------------
// Farmstead
// ------------------------------------------------------------------------------------------------

/** A chimney on the house roof and its smoke, leaning further in a strong wind. Local to the farmstead group. */
export function Chimney({ windy }: { windy: boolean }) {
  return (
    <g aria-hidden>
      <rect x={-31} y={-90} width={11} height={20} fill="#7d4636" />
      <rect x={-33} y={-92} width={15} height={4} fill="#5f3529" />
      <g className={windy ? 'farm-smoke farm-smoke-windy farm-motion-only' : 'farm-smoke farm-motion-only'} fill="#eef0f0">
        {[0, -2, -4].map((d) => (
          <circle key={d} cx={-25} cy={-96} r={6} style={delay(d)} />
        ))}
      </g>
    </g>
  );
}

function Hen({ x, y, s = 1, d, flip }: { x: number; y: number; s?: number; d: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <ellipse cx={0} cy={1} rx={8} ry={1.8} fill="#1d3a2a" opacity={0.18} />
      <path d="M -2 0 V -4 M 2 0 V -4" stroke="#d98b2b" strokeWidth={1.2} />
      <path d="M -9 -9 Q -10 -14 -6 -13 Q -1 -16 4 -12 L 4 -5 Q -4 -2 -9 -9 Z" fill="#f4efe4" />
      <path d="M -9 -9 Q -11 -15 -7 -14 Z" fill="#e2dccd" />
      <g className="farm-peck" style={delay(d)}>
        <circle cx={6} cy={-13} r={3.4} fill="#f4efe4" />
        <path d="M 4.6 -16.5 Q 6 -19 7.6 -16.5 Z" fill="#cf3b2f" />
        <path d="M 9.2 -13.4 L 11.6 -12.6 L 9.2 -11.8 Z" fill="#e7a23a" />
        <circle cx={6.8} cy={-13.8} r={0.7} fill="#222" />
      </g>
    </g>
  );
}

/** Three hens pecking and a dog trotting on the bank by the farmstead. */
export function Yard() {
  return (
    <g data-farm="yard" aria-hidden>
      <Hen x={58} y={532} d={0} />
      <Hen x={96} y={541} s={0.9} d={-1.3} flip />
      <Hen x={30} y={548} s={1.05} d={-2.4} />
      <g transform="translate(150 512)">
        <g className="farm-trot">
          <g className="farm-step-bob">
            <ellipse cx={0} cy={1} rx={13} ry={2} fill="#1d3a2a" opacity={0.16} />
            <path d="M -9 0 V -6 M -5 0 V -6 M 5 0 V -6 M 9 0 V -6" stroke="#6b4a2c" strokeWidth={2} strokeLinecap="round" />
            <rect x={-11} y={-13} width={22} height={9} rx={4.5} fill="#a8733f" />
            <path className="farm-wag" d="M -11 -11 Q -17 -15 -16 -21" fill="none" stroke="#a8733f" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={11} cy={-15} r={5} fill="#a8733f" />
            <path d="M 9 -19 L 7 -23 L 12 -20 Z" fill="#7a5130" />
            <path d="M 15 -15 L 19 -13.5 L 15 -12 Z" fill="#3a2a1c" />
            <circle cx={12.5} cy={-16} r={0.8} fill="#222" />
          </g>
        </g>
      </g>
    </g>
  );
}

// ------------------------------------------------------------------------------------------------
// The field
// ------------------------------------------------------------------------------------------------

export type GrowerWork = 'sow' | 'tend' | 'harvest';

/**
 * A grower walking along a row, back and forth. What they carry follows the crop's stage:
 * a seed bag while sowing, a hoe over the shoulder while the crop stands, a sheaf at harvest.
 */
export function Grower({ work, x, y, s }: { work: GrowerWork; x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y})`} data-farm="grower" data-work={work} aria-hidden>
      <g className="farm-walk">
        <g transform={`scale(${s})`}>
          <ellipse cx={0} cy={1} rx={12} ry={2.6} fill="#1d3a2a" opacity={0.2} />
          <g className="farm-step-bob">
            <path className="farm-leg" d="M -2 -22 L -3 0" stroke="#3b4652" strokeWidth={4.4} strokeLinecap="round" />
            <path className="farm-leg farm-leg-b" d="M 2 -22 L 3 0" stroke="#34404b" strokeWidth={4.4} strokeLinecap="round" />
            <path d="M -7 -24 Q -8 -40 -2 -42 H 3 Q 8 -40 7 -24 Z" fill="#4d84b8" />
            {work === 'harvest' && (
              <g transform="translate(5 -46) rotate(28)">
                <path d="M -2 0 L -10 -22 M 0 0 L -2 -24 M 2 0 L 6 -22 M 1 0 L 12 -18" stroke="#d6a93c" strokeWidth={2.2} strokeLinecap="round" />
                <rect x={-4} y={-3} width={8} height={4} rx={1} fill="#a07528" />
              </g>
            )}
            {work === 'tend' && <path d="M 4 -40 L 20 -60 M 16 -64 L 24 -56" stroke="#7a5a3a" strokeWidth={2} strokeLinecap="round" />}
            {work === 'sow' && (
              <>
                <rect x={-9} y={-34} width={8} height={10} rx={2} fill="#c9b48a" />
                <g className="farm-sow-arm">
                  <path d="M 4 -38 L 11 -28" stroke="#4d84b8" strokeWidth={3.2} strokeLinecap="round" />
                </g>
                <g className="farm-seeds" fill="#e6d29a">
                  <circle cx={12} cy={-22} r={1.2} />
                  <circle cx={15} cy={-18} r={1} style={delay(-0.4)} />
                  <circle cx={10} cy={-16} r={1.1} style={delay(-0.8)} />
                </g>
              </>
            )}
            <circle cx={0} cy={-47} r={5} fill="#e0b48c" />
            <ellipse cx={0} cy={-50} rx={11} ry={2.6} fill="#e3c77d" />
            <path d="M -5 -50 Q -4 -56 0 -56 Q 4 -56 5 -50 Z" fill="#d6b863" />
          </g>
        </g>
      </g>
    </g>
  );
}

function Butterfly({ fill, s = 1, d = 0 }: { fill: string; s?: number; d?: number }) {
  return (
    <g transform={`scale(${s})`}>
      <g className="farm-flutter" style={delay(d)} fill={fill}>
        <path d="M 0 0 Q -9 -10 -11 -2 Q -10 4 0 1 Z" />
        <path d="M 0 0 Q 9 -10 11 -2 Q 10 4 0 1 Z" />
      </g>
      <path d="M 0 -4 V 4" stroke="#3a2f26" strokeWidth={1.6} strokeLinecap="round" />
    </g>
  );
}

function Bee({ d = 0 }: { d?: number }) {
  return (
    <g>
      <g className="farm-buzz" style={delay(d)} fill="#ffffff" opacity={0.8}>
        <ellipse cx={-2} cy={-4} rx={3} ry={2} />
        <ellipse cx={2} cy={-4} rx={3} ry={2} />
      </g>
      <ellipse cx={0} cy={0} rx={4.6} ry={3.2} fill="#f2c23a" />
      <path d="M -1 -3 V 3 M 2 -3 V 3" stroke="#3a2f26" strokeWidth={1.3} />
    </g>
  );
}

const FLIERS: { x: number; y: number; kind: 'b' | 'bee'; fill?: string; s?: number; wx: number; wy: number }[] = [
  { x: 520, y: 600, kind: 'b', fill: '#f7f3e6', s: 1.3, wx: 11, wy: 2.6 },
  { x: 980, y: 560, kind: 'b', fill: '#f4c542', s: 1.1, wx: 14, wy: 3.1 },
  { x: 1240, y: 690, kind: 'b', fill: '#ef8f4a', s: 1.5, wx: 9, wy: 2.2 },
  { x: 760, y: 720, kind: 'bee', wx: 6, wy: 1.4 },
  { x: 340, y: 760, kind: 'bee', wx: 7.5, wy: 1.7 },
];

/** Butterflies and bees over a standing crop in dry weather. */
export function Pollinators({ show }: { show: boolean }) {
  return (
    <g className="farm-fade" opacity={show ? 1 : 0} data-farm="pollinators" aria-hidden>
      {FLIERS.map((f, k) => (
        <g key={k} transform={`translate(${f.x} ${f.y})`}>
          <g className="farm-wander-x" style={{ animationDuration: `${f.wx}s`, animationDelay: `${-k * 1.7}s` }}>
            <g className="farm-wander-y" style={{ animationDuration: `${f.wy}s`, animationDelay: `${-k * 0.6}s` }}>
              {f.kind === 'b' ? <Butterfly fill={f.fill!} s={f.s} d={-k * 0.07} /> : <Bee d={-k * 0.03} />}
            </g>
          </g>
        </g>
      ))}
    </g>
  );
}

/** Dust thrown up behind the harvester. Local to the harvester, which heads right. */
export function Dust() {
  return (
    <g className="farm-motion-only" fill="#d9c49a" aria-hidden>
      {[0, -0.45, -0.9].map((d) => (
        <circle key={d} className="farm-dust" cx={-34} cy={-8} r={6} style={delay(d)} />
      ))}
    </g>
  );
}

const SPLASHES = Array.from({ length: 14 }, (_, k) => ({ x: 90 + ((k * 389) % 1440), y: 560 + ((k * 151) % 320), d: -((k * 0.23) % 1.1) }));

/** Rings where the drops land, while it rains. */
export function Splashes({ show, heavy }: { show: boolean; heavy: boolean }) {
  return (
    <g className="farm-fade farm-motion-only" opacity={show ? (heavy ? 0.9 : 0.6) : 0} fill="none" stroke="#e6f2fb" strokeWidth={1.6} data-farm="splashes" aria-hidden>
      {SPLASHES.map((p, k) => (
        <ellipse key={k} className="farm-splash" cx={p.x} cy={p.y} rx={9 + (p.y - 560) / 30} ry={2.4 + (p.y - 560) / 120} style={delay(p.d)} />
      ))}
    </g>
  );
}

/** Light moving on the canal: three glints sliding along it. */
export function CanalShimmer({ x0, x1, y }: { x0: number; x1: number; y: number }) {
  const span = x1 - x0;
  return (
    <g className="farm-motion-only" fill="#ffffff" aria-hidden>
      {[0.12, 0.45, 0.78].map((f, k) => (
        <rect key={f} className="farm-shimmer" x={x0 + span * f} y={y} width={46} height={2} rx={1} style={delay(-k * 1.6)} />
      ))}
    </g>
  );
}

const GLINTS = [
  [360, 640],
  [700, 590],
  [1080, 620],
  [520, 780],
  [930, 820],
  [1300, 730],
];

/** Sun glinting on the paddy water; as strong as the water is deep in the drawing. */
export function PaddyGlints({ opacity }: { opacity: number }) {
  return (
    <g className="farm-fade farm-motion-only" opacity={Math.min(0.8, opacity * 1.3)} fill="#ffffff" aria-hidden>
      {GLINTS.map(([x, y], k) => (
        <ellipse key={k} className="farm-glint" cx={x} cy={y} rx={12 + (y - 560) / 16} ry={1.8} style={delay(-k * 0.7)} />
      ))}
    </g>
  );
}

/** Shadows of the clouds sliding over the field, when the sun is out between them. */
export function CloudShadows({ strength }: { strength: number }) {
  return (
    <g className="farm-fade" opacity={strength} fill="#0d2a1c" aria-hidden>
      <ellipse className="farm-cloud-shadow" cx={0} cy={650} rx={260} ry={60} />
      <ellipse className="farm-cloud-shadow farm-cloud-shadow-slow" cx={0} cy={800} rx={340} ry={80} />
    </g>
  );
}
