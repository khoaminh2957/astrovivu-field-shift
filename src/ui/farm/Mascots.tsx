/**
 * Stand-in figures of the three characters, drawn in SVG. The characters on the stage are the
 * mascot owner's 3D figures (`@/ui/mascot`); these are shown while a model loads and in its place
 * when WebGL or the file is not available. Each is drawn around (0, 0) in a box of about 44 x 52.
 */
import type { FarmVoice } from '@/core/farm';

export type MascotMood = 'calm' | 'glad' | 'worried';

function Face({ mood, y = 0, ink = '#2b2b2b' }: { mood: MascotMood; y?: number; ink?: string }) {
  const mouth = mood === 'glad' ? 'M -5 5 Q 0 10 5 5' : mood === 'worried' ? 'M -4 8 Q 0 4 4 8' : 'M -4 6.5 L 4 6.5';
  return (
    <g transform={`translate(0 ${y})`}>
      <ellipse cx={-6} cy={-1} rx={2.2} ry={mood === 'worried' ? 3 : 2.6} fill={ink} />
      <ellipse cx={6} cy={-1} rx={2.2} ry={mood === 'worried' ? 3 : 2.6} fill={ink} />
      <circle cx={-5.3} cy={-2} r={0.8} fill="#fff" />
      <circle cx={6.7} cy={-2} r={0.8} fill="#fff" />
      <path d={mouth} fill="none" stroke={ink} strokeWidth={1.6} strokeLinecap="round" />
      {mood === 'glad' && (
        <>
          <ellipse cx={-10} cy={4} rx={2.6} ry={1.6} fill="#ff9d9d" opacity={0.7} />
          <ellipse cx={10} cy={4} rx={2.6} ry={1.6} fill="#ff9d9d" opacity={0.7} />
        </>
      )}
    </g>
  );
}

/** Space: a small round satellite with an orbit ring and a star on its antenna. */
function Space({ mood }: { mood: MascotMood }) {
  return (
    <g>
      <ellipse cx={0} cy={2} rx={25} ry={8} fill="none" stroke="#f5c84b" strokeWidth={2.4} transform="rotate(-18)" />
      <circle cx={0} cy={0} r={17} fill="#3e5fd0" />
      <path d="M -15 -7 A 17 17 0 0 1 9 -14 A 22 22 0 0 0 -15 -7 Z" fill="#6d8af0" />
      <line x1={0} y1={-17} x2={0} y2={-26} stroke="#3e5fd0" strokeWidth={2} strokeLinecap="round" />
      <path d="M 0 -33 l 1.9 4 4.3 0.5 -3.2 2.9 0.9 4.2 -3.9 -2.2 -3.9 2.2 0.9 -4.2 -3.2 -2.9 4.3 -0.5 Z" fill="#f5c84b" />
      <Face mood={mood} y={1} ink="#fff" />
    </g>
  );
}

/** Soil: a rounded clod of earth with a sprout on its head. */
function Soil({ mood }: { mood: MascotMood }) {
  return (
    <g>
      <path d="M -18 6 Q -20 -12 -6 -15 Q 6 -19 15 -11 Q 22 -3 18 9 Q 14 18 0 18 Q -15 18 -18 6 Z" fill="#8b5a36" />
      <path d="M -14 -6 Q -8 -13 2 -13" fill="none" stroke="#a9744a" strokeWidth={3} strokeLinecap="round" />
      <circle cx={11} cy={10} r={1.8} fill="#6f4426" />
      <circle cx={-11} cy={11} r={1.4} fill="#6f4426" />
      <path d="M 1 -15 Q 1 -22 1 -25" fill="none" stroke="#4d9d4f" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M 1 -24 Q -8 -30 -10 -23 Q -5 -20 1 -24 Z" fill="#62b865" />
      <path d="M 1 -25 Q 9 -32 12 -25 Q 7 -21 1 -25 Z" fill="#4d9d4f" />
      <ellipse cx={-8} cy={19} rx={5} ry={2.6} fill="#6f4426" />
      <ellipse cx={8} cy={19} rx={5} ry={2.6} fill="#6f4426" />
      <Face mood={mood} y={1} ink="#2a1a0e" />
    </g>
  );
}

/** Rice: a grain of rice with two leaves for hair. */
function Rice({ mood }: { mood: MascotMood }) {
  return (
    <g>
      <path d="M 0 -20 Q 15 -14 14 2 Q 13 17 0 20 Q -13 17 -14 2 Q -15 -14 0 -20 Z" fill="#f6e7b4" stroke="#e2c873" strokeWidth={1.4} />
      <path d="M -8 -10 Q -4 -16 2 -17" fill="none" stroke="#fff8dc" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M 0 -20 Q -11 -27 -15 -36 Q -4 -33 0 -20 Z" fill="#5fb562" />
      <path d="M 0 -20 Q 9 -30 17 -33 Q 13 -23 0 -20 Z" fill="#4a9a4e" />
      <ellipse cx={-6} cy={21} rx={4} ry={2.2} fill="#e2c873" />
      <ellipse cx={6} cy={21} rx={4} ry={2.2} fill="#e2c873" />
      <Face mood={mood} y={1} />
    </g>
  );
}

const FIGURE: Record<FarmVoice, (p: { mood: MascotMood }) => React.ReactElement> = { space: Space, soil: Soil, rice: Rice };

/** One stand-in character. It is drawn only until the 3D figure is on screen, or in its place when that cannot be shown. */
export function MascotFigure({ who, mood }: { who: FarmVoice; mood: MascotMood }) {
  const Figure = FIGURE[who];
  return (
    <svg viewBox="-34 -42 68 70" className="farm-figure h-3/5 w-3/5" aria-hidden>
      <g className={who === 'space' ? 'farm-bob-slow' : 'farm-bob'}>
        <Figure mood={mood} />
      </g>
    </svg>
  );
}
