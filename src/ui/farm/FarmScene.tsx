/**
 * The farm as a drawing that fills its box: sky, a far range, hills, a farmstead, the canal and the
 * field with its rows running to the horizon. Every part that carries a reading is drawn from
 * `FarmScene` (src/core/farm) and this file adds no reading of its own; a part whose value is
 * missing is drawn in a neutral way, never guessed. The land around the field is decoration.
 *
 * The drawing is 1600 x 900 and is cropped to the box from its lower middle (`xMidYMax slice`), so
 * the field stays in view on a tall phone and on a wide desk alike.
 */
import type { FarmCrop, FarmScene, SkyKind } from '@/core/farm';
import { Birds, Chimney, CloudShadows, CanalShimmer, Dust, Grower, type GrowerWork, PaddyGlints, Pollinators, Splashes, SunRays, Yard } from './Ambient';
import { Plant, RIPENS, Stubble, leafColours } from './plants';
import './farm.css';

const W = 1600;
const H = 900;
/** Vanishing point of the rows, and the far edge of the field. */
const VP = { x: 800, y: 300 };
const FAR_Y = 470;
const rowX = (xNear: number, y: number): number => VP.x + ((xNear - VP.x) * (y - VP.y)) / (H - VP.y);
const depthScale = (y: number): number => (y - VP.y) / (H - VP.y);

const ROWS_NEAR = Array.from({ length: 21 }, (_, i) => -700 + 150 * i);
const RIDGES_NEAR = Array.from({ length: 20 }, (_, i) => -625 + 150 * i);
const DEPTHS = [486, 508, 536, 572, 618, 676, 748, 838];
const FIELD = `${rowX(ROWS_NEAR[0], FAR_Y)},${FAR_Y} ${rowX(ROWS_NEAR[20], FAR_Y)},${FAR_Y} ${W},620 ${W},${H} 0,${H} 0,620`;

interface Spot {
  x: number;
  y: number;
  s: number;
  i: number;
}
/** Where plants stand: far rows first, left to right, which is also the order the harvester cuts them in. */
const SPOTS: Spot[] = DEPTHS.flatMap((y) => RIDGES_NEAR.map((xn) => ({ x: rowX(xn, y), y, s: depthScale(y) })))
  .filter((p) => p.x > -30 && p.x < W + 30)
  .map((p, i) => ({ ...p, i }));
/** The row the grower walks: plants behind it are drawn before the grower, plants in front after. */
const WALK_Y = 598;
/** Size of a full-grown plant against the row spacing. */
const PLANT_SIZE = 2.3;

interface Sky {
  top: string;
  low: string;
  sun: number;
  clouds: number;
  cloud: string;
  shade: string;
  rain: number;
  /** A wash over the land: grey under rain, warm in heat, cold in frost. */
  wash: string;
  washOpacity: number;
}
const SKY: Record<SkyKind, Sky> = {
  clear: { top: '#6fb0dc', low: '#e4f1f2', sun: 1, clouds: 0.75, cloud: '#ffffff', shade: '#d7e6ef', rain: 0, wash: '#ffffff', washOpacity: 0 },
  cloudy: { top: '#93a9b9', low: '#dfe6e6', sun: 0.25, clouds: 1, cloud: '#eef1f3', shade: '#c6d0d8', rain: 0, wash: '#5f7180', washOpacity: 0.14 },
  rain: { top: '#71879a', low: '#c3cdd2', sun: 0, clouds: 1, cloud: '#bcc7d1', shade: '#97a6b3', rain: 0.7, wash: '#3d4f5f', washOpacity: 0.26 },
  'heavy-rain': { top: '#4f6276', low: '#a3b0ba', sun: 0, clouds: 1, cloud: '#8f9eae', shade: '#70829a', rain: 1, wash: '#27384a', washOpacity: 0.4 },
  hot: { top: '#7fb6d6', low: '#f6ecd0', sun: 1, clouds: 0.12, cloud: '#ffffff', shade: '#f3e4c2', rain: 0, wash: '#f0b84a', washOpacity: 0.12 },
  frost: { top: '#8db4d6', low: '#eaf2f7', sun: 0.7, clouds: 0.35, cloud: '#ffffff', shade: '#dde8f2', rain: 0, wash: '#cfe4f7', washOpacity: 0.2 },
  unknown: { top: '#a3b0ba', low: '#e3e6e6', sun: 0, clouds: 0.4, cloud: '#e6e9ec', shade: '#cdd4da', rain: 0, wash: '#7d8790', washOpacity: 0.12 },
};

/** How much the sun shows under a sky, 0..1: the stage lays its daylight over the drawing by it. */
export const sunOf = (kind: SkyKind): number => SKY[kind].sun;

function Cloud({ x, y, s, sky, slow }: { x: number; y: number; s: number; sky: Sky; slow?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className={slow ? 'farm-cloud farm-cloud-slow' : 'farm-cloud'}>
        <ellipse className="farm-fade" cx={92} cy={34} rx={86} ry={17} fill={sky.shade} />
        <g className="farm-fade" fill={sky.cloud}>
          <ellipse cx={86} cy={22} rx={74} ry={22} />
          <ellipse cx={46} cy={12} rx={36} ry={25} />
          <ellipse cx={104} cy={0} rx={46} ry={33} />
          <ellipse cx={152} cy={16} rx={34} ry={21} />
        </g>
      </g>
    </g>
  );
}

function RoundTree({ x, y, s = 1, tone = 0 }: { x: number; y: number; s?: number; tone?: 0 | 1 | 2 }) {
  const fill = ['#4f8f62', '#629e68', '#3f7d59'][tone];
  const light = ['#6fa97a', '#80b582', '#5a9670'][tone];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={3} cy={2} rx={22} ry={4.5} fill="#1d3a2a" opacity={0.16} />
      <rect x={-3} y={-20} width={6} height={22} rx={2} fill="#6b5137" />
      <g className="farm-rustle" style={{ animationDelay: `${-((x * 7) % 50) / 10}s` }}>
        <ellipse cx={-13} cy={-30} rx={16} ry={14} fill={fill} />
        <ellipse cx={13} cy={-28} rx={15} ry={13} fill={fill} />
        <ellipse cx={0} cy={-44} rx={19} ry={17} fill={fill} />
        <ellipse cx={-6} cy={-48} rx={10} ry={8} fill={light} />
      </g>
    </g>
  );
}

function Poplar({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-2} y={-8} width={4} height={10} fill="#6b5137" />
      <g className="farm-rustle" style={{ animationDelay: `${-((x * 11) % 40) / 10}s` }}>
        <path d="M 0 -78 Q 15 -44 10 -10 Q 0 -2 -10 -10 Q -15 -44 0 -78 Z" fill="#477f5c" />
        <path d="M 0 -78 Q -15 -44 -10 -10 Q -3 -34 0 -78 Z" fill="#5f9870" />
      </g>
    </g>
  );
}

/** What stands behind and beside the field. Only the sky follows the readings. */
function Landscape({ kind, windy }: { kind: SkyKind; windy: boolean }) {
  const sky = SKY[kind];
  return (
    <g data-farm="backdrop">
      <defs>
        <linearGradient id="farm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop className="farm-fade" offset="0" stopColor={sky.top} />
          <stop className="farm-fade" offset="1" stopColor={sky.low} />
        </linearGradient>
        <radialGradient id="farm-sun">
          <stop offset="0" stopColor="#fff6d6" />
          <stop offset="0.45" stopColor="#ffe79a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffe79a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="farm-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <rect x={0} y={-400} width={W} height={900} fill="url(#farm-sky)" />
      <g className="farm-fade" opacity={sky.sun}>
        <SunRays cx={1190} cy={150} />
        <circle className="farm-sun-pulse" cx={1190} cy={150} r={150} fill="url(#farm-sun)" />
        <circle cx={1190} cy={150} r={44} fill="#fff3c4" />
      </g>
      <g className="farm-fade" opacity={sky.clouds}>
        <Cloud x={140} y={96} s={1.1} sky={sky} slow />
        <Cloud x={620} y={52} s={0.8} sky={sky} />
        <Cloud x={930} y={170} s={1.25} sky={sky} slow />
        <Cloud x={1330} y={70} s={0.95} sky={sky} />
        <Cloud x={-120} y={210} s={0.7} sky={sky} />
      </g>
      <Birds show={kind === 'clear'} />

      {/* Two far ranges in haze, then the hills. */}
      <path className="farm-parallax-far" d="M -40 400 L 0 384 L 120 352 L 250 388 L 400 318 L 520 366 L 660 300 L 790 352 L 930 312 L 1080 372 L 1220 326 L 1380 384 L 1500 348 L 1600 376 L 1640 388 V 470 H -40 Z" fill="#a9c0c9" />
      <path className="farm-parallax-mid" d="M -40 434 L 0 424 L 160 386 L 330 420 L 480 378 L 640 416 L 820 372 L 1000 418 L 1160 384 L 1330 422 L 1480 392 L 1600 414 L 1640 420 V 470 H -40 Z" fill="#8fb0ad" />
      <rect x={0} y={330} width={W} height={140} fill="url(#farm-haze)" opacity={0.55} />
      <path d="M 0 452 Q 220 404 470 440 Q 700 470 900 438 Q 1150 400 1380 432 Q 1500 448 1600 436 V 480 H 0 Z" fill="#86b28a" />
      <path d="M 0 468 Q 260 438 520 460 Q 800 482 1060 456 Q 1330 432 1600 462 V 640 H 0 Z" fill="#74a57b" />

      {/* A line of trees along the far bank of the canal. */}
      {[60, 150, 232, 318, 1262, 1344, 1430, 1528].map((x, k) => (k % 3 === 1 ? <Poplar key={x} x={x} y={470} s={0.62} /> : <RoundTree key={x} x={x} y={470} s={0.58} tone={(k % 3) as 0 | 1 | 2} />))}
      {[452, 540, 626, 716, 884, 972, 1064, 1150].map((x, k) => (
        <RoundTree key={x} x={x} y={462} s={0.34} tone={(k % 3) as 0 | 1 | 2} />
      ))}

      {/* The farmstead on the left bank. */}
      <g transform="translate(196 548)">
        <ellipse cx={30} cy={6} rx={150} ry={12} fill="#1d3a2a" opacity={0.14} />
        <rect x={-96} y={-54} width={92} height={56} fill="#e8dfcc" />
        <Chimney windy={windy} />
        <path d="M -106 -54 L -50 -92 L 6 -54 Z" fill="#9a5a45" />
        <rect x={-64} y={-26} width={20} height={28} fill="#7a5a40" />
        <rect x={-90} y={-40} width={16} height={14} fill="#bcd6e2" />
        <rect x={-30} y={-40} width={16} height={14} fill="#bcd6e2" />
        <rect x={20} y={-70} width={96} height={72} fill="#b8644e" />
        <path d="M 12 -70 L 68 -112 L 124 -70 Z" fill="#8c4a3a" />
        <rect x={50} y={-36} width={36} height={38} fill="#6e3a2e" />
        <path d="M 50 -36 L 86 2 M 86 -36 L 50 2" stroke="#e8dfcc" strokeWidth={2.4} />
        <rect x={136} y={-96} width={30} height={98} rx={3} fill="#cfd6da" />
        <path d="M 136 -96 Q 151 -116 166 -96 Z" fill="#aab4ba" />
        <path d="M 136 -64 H 166 M 136 -32 H 166" stroke="#aab4ba" strokeWidth={2} />
      </g>
      <RoundTree x={62} y={560} s={1.05} tone={2} />
      <RoundTree x={420} y={524} s={0.8} tone={1} />

      {/* The wind pump on the right bank: its wheel turns faster in a strong wind. */}
      <g transform="translate(1418 566)">
        <ellipse cx={0} cy={4} rx={56} ry={7} fill="#1d3a2a" opacity={0.14} />
        <path d="M -22 0 L -5 -120 M 22 0 L 5 -120 M -16 -42 L 14 -72 M 16 -42 L -14 -72 M -19 -22 H 19" stroke="#74808a" strokeWidth={3.4} fill="none" />
        <g transform="translate(0 -124)">
          <g className={windy ? 'farm-vane farm-vane-fast' : 'farm-vane'}>
            {Array.from({ length: 8 }, (_, k) => (
              <path key={k} d="M 0 0 L 6 -34 L -6 -34 Z" fill={k % 2 ? '#dfe5e9' : '#c2ccd3'} transform={`rotate(${k * 45})`} />
            ))}
          </g>
          <circle r={5} fill="#74808a" />
        </g>
      </g>
      <RoundTree x={1540} y={556} s={0.95} tone={0} />
      <Poplar x={1290} y={520} s={0.8} />
    </g>
  );
}

/** The plants behind the grower's row (`near` false) or in front of it. */
function Plants({ crop, beat, near }: { crop: FarmCrop; beat: string; near: boolean }) {
  if (crop.look === 'none') return null;
  const { fill, dark } = leafColours(crop.vigor, crop.ripeness, RIPENS[crop.look]);
  const cut = crop.harvested == null ? 0 : Math.round(crop.harvested * SPOTS.length);
  return (
    // Keyed by the step shown, so that the plants rise into each new stage instead of switching.
    <g key={beat} data-farm={near ? 'plants-near' : 'plants'} data-look={crop.look} data-growth={crop.growth.toFixed(2)}>
      {SPOTS.filter((p) => p.y >= WALK_Y === near).map((p) => (
        <g key={p.i} transform={`translate(${p.x.toFixed(1)} ${p.y}) scale(${(p.s * PLANT_SIZE).toFixed(3)})`}>
          {p.i < cut ? (
            <Stubble />
          ) : (
            <g className="farm-rise" style={{ animationDelay: `${((p.i * 13) % 420).toFixed(0)}ms` }}>
              <g className="farm-sway" style={{ animationDelay: `-${((p.i * 0.37) % 4).toFixed(2)}s` }}>
                <Plant look={crop.look} growth={crop.growth} ripeness={crop.ripeness} fill={fill} dark={dark} seed={p.i} />
              </g>
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

function Wheel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g className="farm-wheel">
      <circle cx={cx} cy={cy} r={r} fill="#2c3136" />
      <circle cx={cx} cy={cy} r={r * 0.45} fill="#b9c0c7" />
      <path d={`M ${cx - r} ${cy} H ${cx + r} M ${cx} ${cy - r} V ${cy + r}`} stroke="#b9c0c7" strokeWidth={1.4} />
    </g>
  );
}

/** A combine harvester, heading right, its foot at (0, 0). */
function Harvester() {
  return (
    <g data-farm="harvester">
      <Dust />
      <g className="farm-vehicle-body">
        <rect x={-30} y={-30} width={46} height={22} rx={4} fill="#c98f2c" />
        <rect x={-2} y={-42} width={20} height={16} rx={3} fill="#dcab45" />
        <rect x={2} y={-39} width={12} height={9} rx={1.5} fill="#cfe3ec" />
        <path d="M -24 -30 L -32 -44 L -27 -45 L -18 -30 Z" fill="#a8761f" />
        <path d="M 16 -14 L 34 -8 L 34 -2 L 16 -6 Z" fill="#a8761f" />
        <rect x={30} y={-12} width={14} height={12} rx={2} fill="#9c4138" />
      </g>
      <g className="farm-wheel">
        <circle cx={38} cy={-6} r={8} fill="none" stroke="#6f2c27" strokeWidth={2} />
        <path d="M 30 -6 H 46 M 38 -14 V 2" stroke="#6f2c27" strokeWidth={2} />
      </g>
      <Wheel cx={-16} cy={-6} r={8} />
      <Wheel cx={8} cy={-5} r={6} />
    </g>
  );
}

/** A tractor with a seeder behind it, heading right, its foot at (0, 0). */
function Seeder() {
  return (
    <g data-farm="seeder">
      <g className="farm-vehicle-body">
        <rect x={-6} y={-24} width={28} height={14} rx={3} fill="#3f7fae" />
        <rect x={-8} y={-36} width={16} height={14} rx={2.5} fill="#5996c2" />
        <rect x={-5} y={-33} width={10} height={8} rx={1.2} fill="#cfe3ec" />
        <rect x={20} y={-28} width={3} height={8} fill="#2c3136" />
        <path d="M -8 -12 H -22" stroke="#2c3136" strokeWidth={2} />
        <rect x={-40} y={-18} width={18} height={9} rx={2} fill="#cfd5dc" />
        <path d="M -37 -9 V -3 M -31 -9 V -3 M -25 -9 V -3" stroke="#858d96" strokeWidth={1.6} />
      </g>
      <Wheel cx={-2} cy={-7} r={8} />
      <Wheel cx={17} cy={-5} r={5.5} />
    </g>
  );
}

export interface FarmSceneViewProps {
  scene: FarmScene;
  /** Accessible name of the drawing. */
  title: string;
  /** Changes when the step shown changes: the plants then rise into their new stage. */
  beat: string;
  className?: string;
}

export function FarmSceneView({ scene, title, beat, className }: FarmSceneViewProps) {
  const { weather, crop, soil } = scene;
  const sky = SKY[weather.kind];
  const windy = weather.windMs != null && weather.windMs >= 6;
  const soilFill = soil.state === 'dry' ? 'var(--farm-soil-dry)' : soil.state === 'wet' ? 'var(--farm-soil-wet)' : soil.state === 'usual' ? 'var(--farm-soil-usual)' : 'var(--farm-soil-none)';
  // A young paddy stands in water; the sheen fades as the canopy closes, and is thin when the root zone reads dry.
  const paddyWater = crop.look === 'paddy' && crop.harvested == null && crop.growth > 0 ? Math.max(0, 0.55 * (1 - crop.growth / 0.8)) * (soil.state === 'dry' ? 0.35 : 1) : 0;
  const canal = soil.state === 'dry' ? 5 : soil.state === 'wet' ? 16 : 10;
  const cutN = crop.harvested == null ? 0 : Math.round(crop.harvested * SPOTS.length);
  const front = SPOTS[Math.min(SPOTS.length - 1, cutN)];
  const farLeft = rowX(ROWS_NEAR[0], FAR_Y);
  const farRight = rowX(ROWS_NEAR[20], FAR_Y);
  const raining = weather.kind === 'rain' || weather.kind === 'heavy-rain';
  const standing = crop.look !== 'none' && crop.harvested == null && crop.growth > 0;
  // The grower's work follows the crop's stage; nobody walks a bare field.
  const work: GrowerWork | null = crop.sowing ? 'sow' : crop.harvested != null ? 'harvest' : standing ? 'tend' : null;

  return (
    <svg className={`farm-scene ${className ?? ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" role="img" aria-label={title} data-sky={weather.kind} data-soil={soil.state ?? 'none'} data-wind={windy ? 'strong' : 'calm'}>
      <defs>
        <clipPath id="farm-field">
          <polygon points={FIELD} />
        </clipPath>
        <linearGradient id="farm-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <Landscape kind={weather.kind} windy={windy} />

      {/* The field: soil coloured by the root-zone moisture, furrows, the canal along its far edge. */}
      <polygon className="farm-fade" points={FIELD} fill={soilFill} data-farm="soil" />
      <polygon points={FIELD} fill="url(#farm-depth)" />
      <g clipPath="url(#farm-field)">
        {ROWS_NEAR.map((xn, k) => (
          <g key={k}>
            <line x1={rowX(xn, FAR_Y)} y1={FAR_Y} x2={xn} y2={H} stroke="#000" strokeOpacity={0.2} strokeWidth={12} />
            <line x1={rowX(xn, FAR_Y) + 3} y1={FAR_Y} x2={xn + 20} y2={H} stroke="#fff" strokeOpacity={0.1} strokeWidth={4} />
          </g>
        ))}
        <polygon className="farm-fade" points={FIELD} fill="#a9cfe6" opacity={paddyWater} data-farm="paddy-water" />
        <PaddyGlints opacity={sky.sun > 0 ? paddyWater : 0} />
        <g className="farm-fade" opacity={soil.state === 'dry' ? 0.6 : 0} stroke="#6f4c2e" strokeWidth={2.6} fill="none" strokeLinejoin="round" data-farm="cracks">
          <path d="M 300 800 l 26 -20 l -10 -24 l 32 -16 l -6 -22 M 820 850 l -22 -26 l 24 -20 l -8 -24 M 1130 780 l 24 -24 l -16 -22 l 28 -14 M 560 690 l 22 -16 l -8 -20 l 20 -10 M 980 660 l -16 -18 l 18 -14 M 1340 860 l 20 -22 l -12 -20" />
        </g>
        <g className="farm-fade" opacity={soil.state === 'wet' ? 0.8 : 0} fill="var(--farm-water)" data-farm="puddles">
          <ellipse className="farm-ripple" cx={380} cy={800} rx={86} ry={16} />
          <ellipse className="farm-ripple" cx={1010} cy={740} rx={70} ry={13} />
          <ellipse className="farm-ripple" cx={690} cy={640} rx={46} ry={8} />
          <ellipse className="farm-ripple" cx={1250} cy={860} rx={90} ry={15} />
        </g>
        <CloudShadows strength={sky.sun * sky.clouds * 0.1} />
        <Splashes show={raining} heavy={weather.kind === 'heavy-rain'} />
      </g>
      {/* The grass banks beside the field, over the ends of the rows. */}
      <path d={`M 0 ${FAR_Y + 4} H ${farLeft - 6} L 0 624 Z`} fill="#6c9f72" />
      <path d={`M ${W} ${FAR_Y + 4} H ${farRight + 6} L ${W} 624 Z`} fill="#6c9f72" />
      <path d={`M ${farLeft - 6} ${FAR_Y + 4} L 0 624 L 0 640 L ${farLeft + 4} ${FAR_Y + 4} Z`} fill="#4f8459" />
      <path d={`M ${farRight + 6} ${FAR_Y + 4} L ${W} 624 L ${W} 640 L ${farRight - 4} ${FAR_Y + 4} Z`} fill="#4f8459" />
      <rect className="farm-fade" x={farLeft - 10} y={FAR_Y - canal} width={farRight - farLeft + 20} height={canal} rx={3} fill="var(--farm-water)" opacity={soil.state == null ? 0.5 : 1} data-farm="canal" />
      <rect x={farLeft - 10} y={FAR_Y - canal} width={farRight - farLeft + 20} height={2} fill="#fff" opacity={0.35} />
      <CanalShimmer x0={farLeft} x1={farRight - 46} y={FAR_Y - canal / 2 - 1} />
      <Yard />

      <Plants crop={crop} beat={beat} near={false} />
      {work && <Grower work={work} x={470} y={WALK_Y} s={depthScale(WALK_Y) * 1.9} />}
      <Plants crop={crop} beat={beat} near />
      <Pollinators show={standing && crop.growth >= 0.3 && (weather.kind === 'clear' || weather.kind === 'hot' || weather.kind === 'cloudy')} />

      {crop.harvested != null && crop.harvested < 1 && (
        <g className="farm-glide" style={{ transform: `translate(${front.x.toFixed(1)}px, ${front.y}px) scale(${(front.s * 2.6).toFixed(2)})` }}>
          <Harvester />
        </g>
      )}
      {crop.sowing && (
        <g className="farm-cross" data-farm="seeder-run">
          <g transform="translate(0 640) scale(1.5)">
            <Seeder />
          </g>
        </g>
      )}

      {/* The weather over the land: a wash of its light, then rain or frost in front of the field. */}
      <rect className="farm-fade" x={0} y={0} width={W} height={H} fill={sky.wash} opacity={sky.washOpacity} style={{ mixBlendMode: 'multiply' }} pointerEvents="none" />
      <g className="farm-rain farm-fade" opacity={sky.rain} stroke="#e6f2fb" strokeWidth={2.4} strokeLinecap="round" data-farm="rain">
        {Array.from({ length: 70 }, (_, k) => {
          const x = (k * 131 + 37) % (W + 60);
          const y = (k * 173) % 760;
          return <line key={k} x1={x} y1={y} x2={x - 12} y2={y + 36} opacity={weather.kind === 'heavy-rain' || k % 2 === 0 ? 0.85 : 0} />;
        })}
      </g>
      <g className="farm-fade" opacity={weather.kind === 'frost' ? 1 : 0} fill="#ffffff" data-farm="frost">
        {Array.from({ length: 26 }, (_, k) => {
          const x = (k * 233 + 80) % W;
          const y = 500 + ((k * 97) % 380);
          return <path key={k} className="farm-twinkle" d={`M ${x} ${y - 9} l 2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 Z`} />;
        })}
      </g>
    </svg>
  );
}
