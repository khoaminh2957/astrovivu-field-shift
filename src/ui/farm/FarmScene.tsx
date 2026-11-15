/**
 * The farm as a drawing: sky, hills, a storehouse, a canal, the field with its rows, the machines
 * and the three characters. Every part is drawn from `FarmScene` (src/core/farm): this file adds
 * no reading of its own. Parts whose value is missing are drawn in a neutral way, never guessed.
 */
import type { KeyboardEvent, ReactElement } from 'react';
import type { CropLook, FarmCrop, FarmLine, FarmScene, FarmVoice } from '@/core/farm';
import { Backdrop, SKY, Verges } from './Backdrop';
import { MascotFigure } from './Mascots';
import './farm.css';

const W = 560;
const H = 330;
/** Vanishing point of the rows, and the far and near edge of the field. */
const VP = { x: 280, y: 110 };
const FAR_Y = 210;
const NEAR_Y = H;
/** x of a row line at depth `y`, for the x it has at the near edge. */
const rowX = (xNear: number, y: number): number => VP.x + ((xNear - VP.x) * (y - VP.y)) / (NEAR_Y - VP.y);
const depthScale = (y: number): number => (y - VP.y) / (NEAR_Y - VP.y);

const ROWS_NEAR = Array.from({ length: 9 }, (_, i) => -150 + (860 / 8) * i);
const RIDGES_NEAR = Array.from({ length: 8 }, (_, i) => -150 + (860 / 8) * (i + 0.5));
const DEPTHS = [222, 240, 262, 288, 316];

interface Spot {
  x: number;
  y: number;
  s: number;
  i: number;
}
/** Where plants stand: far rows first, left to right, which is also the order the harvester cuts them in. */
const SPOTS: Spot[] = DEPTHS.flatMap((y) => RIDGES_NEAR.map((xn) => ({ x: rowX(xn, y), y, s: depthScale(y) })))
  .filter((p) => p.x > 6 && p.x < W - 6)
  .map((p, i) => ({ ...p, i }));

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** Leaf colour from the greenness of the canopy; a neutral grey-green when there is no image. */
function leaf(vigor: number | null, ripeness: number, ripens: boolean): { fill: string; dark: string } {
  if (vigor == null) return { fill: 'hsl(100 14% 52%)', dark: 'hsl(100 14% 40%)' };
  let h = lerp(72, 128, vigor);
  let s = lerp(42, 58, vigor);
  let l = lerp(52, 36, vigor);
  if (ripens) {
    h = lerp(h, 46, ripeness);
    s = lerp(s, 74, ripeness);
    l = lerp(l, 56, ripeness);
  }
  return { fill: `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`, dark: `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${(l - 12).toFixed(0)}%)` };
}

const RIPENS: Record<CropLook, boolean> = { paddy: true, cereal: true, 'tall-cereal': true, row: true, root: false, grass: false, bush: false, tree: false, none: false };
const GOLD = '#e8b93a';
/** Size of a full-grown plant against the row spacing. */
const PLANT_SIZE = 1.35;

/** One plant at full size, drawn upward from its foot at (0, 0). */
function Plant({ look, ripeness, fill, dark }: { look: CropLook; ripeness: number; fill: string; dark: string }): ReactElement | null {
  switch (look) {
    case 'paddy':
    case 'cereal':
      return (
        <g>
          {[-9, -4.5, 0, 4.5, 9].map((dx, k) => (
            <path key={k} d={`M 0 0 Q ${dx * 0.5} -12 ${dx} ${-20 - (k % 2) * 4}`} fill="none" stroke={k % 2 ? dark : fill} strokeWidth={2.6} strokeLinecap="round" />
          ))}
          <g className="farm-fade" opacity={ripeness}>
            {[-9, 0, 9].map((dx, k) => (
              <ellipse key={k} cx={dx} cy={-21 - (k % 2) * 3} rx={2.4} ry={4.6} fill={GOLD} transform={`rotate(${dx * 3} ${dx} -21)`} />
            ))}
          </g>
        </g>
      );
    case 'tall-cereal':
      return (
        <g>
          <path d="M 0 0 L 0 -36" stroke={dark} strokeWidth={3} strokeLinecap="round" />
          {[-8, -17, -26].map((y, k) => (
            <path key={k} d={`M 0 ${y} Q ${k % 2 ? 10 : -10} ${y - 6} ${k % 2 ? 15 : -15} ${y + 2}`} fill="none" stroke={fill} strokeWidth={3} strokeLinecap="round" />
          ))}
          <path d="M 0 -36 l -3 -7 M 0 -36 l 0 -8 M 0 -36 l 3 -7" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" className="farm-fade" opacity={Math.min(1, ripeness * 2)} />
          <ellipse cx={4} cy={-18} rx={2.6} ry={6} fill={GOLD} className="farm-fade" opacity={ripeness} />
        </g>
      );
    case 'grass':
      return (
        <g>
          {[-13, -9, -5, -1, 3, 7, 11].map((dx, k) => (
            <path key={k} d={`M ${dx * 0.7} 0 Q ${dx} -7 ${dx * 1.1} ${-11 - (k % 3) * 2}`} fill="none" stroke={k % 2 ? dark : fill} strokeWidth={2.2} strokeLinecap="round" />
          ))}
        </g>
      );
    case 'root':
      return (
        <g>
          {[-52, -26, 0, 26, 52].map((a, k) => (
            <ellipse key={k} cx={0} cy={-8} rx={3.4} ry={9} fill={k % 2 ? dark : fill} transform={`rotate(${a} 0 0)`} />
          ))}
        </g>
      );
    case 'row':
      return (
        <g>
          <circle cx={-6} cy={-7} r={6.5} fill={dark} />
          <circle cx={6} cy={-7} r={6.5} fill={dark} />
          <circle cx={0} cy={-12} r={7.5} fill={fill} />
          <g className="farm-fade" opacity={ripeness}>
            <circle cx={-5} cy={-6} r={1.8} fill={GOLD} />
            <circle cx={4} cy={-10} r={1.8} fill={GOLD} />
            <circle cx={1} cy={-4} r={1.8} fill={GOLD} />
          </g>
        </g>
      );
    case 'bush':
      return (
        <g>
          <path d="M 0 0 L 0 -8" stroke="#7a5230" strokeWidth={3} strokeLinecap="round" />
          <circle cx={-8} cy={-13} r={9} fill={dark} />
          <circle cx={8} cy={-13} r={9} fill={dark} />
          <circle cx={0} cy={-20} r={11} fill={fill} />
          <g className="farm-fade" opacity={ripeness}>
            {[
              [-7, -12],
              [5, -15],
              [-1, -22],
              [8, -9],
            ].map(([x, y], k) => (
              <circle key={k} cx={x} cy={y} r={2} fill="#d2453b" />
            ))}
          </g>
        </g>
      );
    case 'tree':
      return (
        <g>
          <path d="M 0 0 L 0 -18" stroke="#7a5230" strokeWidth={4} strokeLinecap="round" />
          <circle cx={-9} cy={-24} r={10} fill={dark} />
          <circle cx={9} cy={-24} r={10} fill={dark} />
          <circle cx={0} cy={-33} r={13} fill={fill} />
          <g className="farm-fade" opacity={ripeness}>
            <circle cx={-6} cy={-24} r={2.4} fill="#e8973a" />
            <circle cx={7} cy={-29} r={2.4} fill="#e8973a" />
          </g>
        </g>
      );
    default:
      return null;
  }
}

function Stubble() {
  return (
    <g stroke="#c9a86a" strokeWidth={2} strokeLinecap="round">
      <path d="M -6 0 L -7 -4 M -2 0 L -2 -5 M 2 0 L 3 -4 M 6 0 L 7 -5" />
    </g>
  );
}

function Plants({ crop }: { crop: FarmCrop }) {
  if (crop.look === 'none') return null;
  const { fill, dark } = leaf(crop.vigor, crop.ripeness, RIPENS[crop.look]);
  const cut = crop.harvested == null ? 0 : Math.round(crop.harvested * SPOTS.length);
  // A seedling is drawn large enough to be seen: the drawn size starts at a third of the full plant.
  const shown = crop.growth <= 0 ? 0 : 0.34 + 0.66 * crop.growth;
  return (
    <g data-farm="plants" data-look={crop.look} data-growth={crop.growth.toFixed(2)}>
      {SPOTS.map((p) => (
        <g key={p.i} transform={`translate(${p.x.toFixed(1)} ${p.y}) scale(${(p.s * PLANT_SIZE).toFixed(2)})`}>
          {p.i < cut ? (
            <Stubble />
          ) : (
            <g className="farm-grow" style={{ transform: `scale(${shown.toFixed(3)})` }}>
              <g className="farm-sway" style={{ animationDelay: `-${((p.i * 0.37) % 3).toFixed(2)}s` }}>
                <Plant look={crop.look} ripeness={crop.ripeness} fill={fill} dark={dark} />
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
      <circle cx={cx} cy={cy} r={r} fill="#2f3237" />
      <circle cx={cx} cy={cy} r={r * 0.45} fill="#c9ced6" />
      <path d={`M ${cx - r} ${cy} H ${cx + r} M ${cx} ${cy - r} V ${cy + r}`} stroke="#c9ced6" strokeWidth={1.4} />
    </g>
  );
}

/** A combine harvester, heading right, its foot at (0, 0). */
function Harvester() {
  return (
    <g className="farm-drive-in" data-farm="harvester">
      <g>
        <circle className="farm-puff" cx={-34} cy={-22} r={5} fill="#e9dcae" />
        <circle className="farm-puff" cx={-34} cy={-22} r={5} fill="#e9dcae" />
        <circle className="farm-puff" cx={-34} cy={-22} r={5} fill="#e9dcae" />
      </g>
      <g className="farm-vehicle-body">
        <rect x={-30} y={-30} width={46} height={22} rx={4} fill="#e2a52e" />
        <rect x={-2} y={-42} width={20} height={16} rx={3} fill="#f4c653" />
        <rect x={2} y={-39} width={12} height={9} rx={1.5} fill="#cfeaf7" />
        <path d="M -24 -30 L -32 -44 L -27 -45 L -18 -30 Z" fill="#c98f1f" />
        <path d="M 16 -14 L 34 -8 L 34 -2 L 16 -6 Z" fill="#c98f1f" />
        <rect x={30} y={-12} width={14} height={12} rx={2} fill="#b8423a" />
      </g>
      <g className="farm-wheel">
        <circle cx={38} cy={-6} r={8} fill="none" stroke="#7b2c27" strokeWidth={2} />
        <path d="M 30 -6 H 46 M 38 -14 V 2" stroke="#7b2c27" strokeWidth={2} />
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
        <rect x={-6} y={-24} width={28} height={14} rx={3} fill="#3f8fd0" />
        <rect x={-8} y={-36} width={16} height={14} rx={2.5} fill="#5aa9e6" />
        <rect x={-5} y={-33} width={10} height={8} rx={1.2} fill="#cfeaf7" />
        <rect x={20} y={-28} width={3} height={8} fill="#2f3237" />
        <path d="M -8 -12 H -22" stroke="#2f3237" strokeWidth={2} />
        <rect x={-40} y={-18} width={18} height={9} rx={2} fill="#d9dee6" />
        <path d="M -37 -9 V -3 M -31 -9 V -3 M -25 -9 V -3" stroke="#8b929c" strokeWidth={1.6} />
      </g>
      <Wheel cx={-2} cy={-7} r={8} />
      <Wheel cx={17} cy={-5} r={5.5} />
    </g>
  );
}

const MASCOT_AT: Record<FarmVoice, { x: number; y: number; scale: number }> = {
  space: { x: 508, y: 96, scale: 0.95 },
  soil: { x: 52, y: 292, scale: 1.05 },
  rice: { x: 470, y: 268, scale: 1 },
};

export interface FarmSceneViewProps {
  scene: FarmScene;
  lines: Record<FarmVoice, FarmLine>;
  speaker: FarmVoice;
  onSpeak: (who: FarmVoice) => void;
  /** Accessible name of the drawing, and of each character's button. */
  title: string;
  names: Record<FarmVoice, string>;
}

export function FarmSceneView({ scene, lines, speaker, onSpeak, title, names }: FarmSceneViewProps) {
  const { weather, crop, soil } = scene;
  const sky = SKY[weather.kind];
  const soilFill = soil.state === 'dry' ? 'var(--farm-soil-dry)' : soil.state === 'wet' ? 'var(--farm-soil-wet)' : soil.state === 'usual' ? 'var(--farm-soil-usual)' : 'var(--farm-soil-none)';
  // A young paddy stands in water; the sheen fades as the canopy closes, and is thin when the root zone reads dry.
  const paddyWater = crop.look === 'paddy' && crop.harvested == null && crop.growth > 0 ? Math.max(0, 0.5 * (1 - crop.growth / 0.8)) * (soil.state === 'dry' ? 0.35 : 1) : 0;
  const canal = soil.state === 'dry' ? 3 : soil.state === 'wet' ? 10 : 6;
  const field = `${rowX(ROWS_NEAR[0], FAR_Y)},${FAR_Y} ${rowX(ROWS_NEAR[8], FAR_Y)},${FAR_Y} ${W},253 ${W},${H} 0,${H} 0,253`;
  const cutN = crop.harvested == null ? 0 : Math.round(crop.harvested * SPOTS.length);
  const front = SPOTS[Math.min(SPOTS.length - 1, cutN)];
  const key = (who: FarmVoice) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSpeak(who);
    }
  };

  return (
    <svg className="farm-scene" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={title} data-sky={weather.kind} data-soil={soil.state ?? 'none'} data-wind={weather.windMs != null && weather.windMs >= 6 ? 'strong' : 'calm'}>
      <defs>
        <clipPath id="farm-field">
          <polygon points={field} />
        </clipPath>
        <linearGradient id="farm-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#000" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      <Backdrop kind={weather.kind} windy={weather.windMs != null && weather.windMs >= 6} />

      {/* The field: soil coloured by the root-zone moisture, furrows, the canal along its far edge. */}
      <polygon className="farm-fade" points={field} fill={soilFill} data-farm="soil" />
      <polygon points={field} fill="url(#farm-depth)" />
      <Verges />
      <g clipPath="url(#farm-field)">
        {ROWS_NEAR.map((xn, k) => (
          <g key={k}>
            <line x1={rowX(xn, FAR_Y)} y1={FAR_Y} x2={xn} y2={NEAR_Y} stroke="#000" strokeOpacity={0.2} strokeWidth={5} />
            <line x1={rowX(xn, FAR_Y) + 2} y1={FAR_Y} x2={xn + 9} y2={NEAR_Y} stroke="#fff" strokeOpacity={0.12} strokeWidth={2} />
          </g>
        ))}
        <polygon className="farm-fade" points={field} fill="#9fd3f2" opacity={paddyWater} data-farm="paddy-water" />
        <g className="farm-fade" opacity={soil.state === 'dry' ? 0.55 : 0} stroke="#7a5230" strokeWidth={1.4} fill="none" data-farm="cracks">
          <path d="M 120 300 l 10 -8 l -4 -9 l 12 -6 M 300 312 l -8 -10 l 9 -7 M 410 296 l 9 -9 l -6 -8 l 10 -5 M 210 262 l 8 -6 l -3 -7" />
        </g>
        <g className="farm-fade" opacity={soil.state === 'wet' ? 0.8 : 0} fill="var(--farm-water)" data-farm="puddles">
          <ellipse className="farm-ripple" cx={150} cy={300} rx={30} ry={6} />
          <ellipse className="farm-ripple" cx={360} cy={282} rx={24} ry={5} />
          <ellipse className="farm-ripple" cx={250} cy={248} rx={16} ry={3.4} />
        </g>
      </g>
      <rect className="farm-fade" x={rowX(ROWS_NEAR[0], FAR_Y) - 4} y={FAR_Y - canal} width={rowX(ROWS_NEAR[8], FAR_Y) - rowX(ROWS_NEAR[0], FAR_Y) + 8} height={canal} rx={2} fill="var(--farm-water)" opacity={soil.state == null ? 0.5 : 1} data-farm="canal" />

      <Plants crop={crop} />

      {crop.harvested != null && crop.harvested < 1 && (
        <g className="farm-glide" style={{ transform: `translate(${front.x.toFixed(1)}px, ${front.y}px) scale(${(front.s * 1.45).toFixed(2)})` }}>
          <Harvester />
        </g>
      )}
      {crop.sowing && (
        <g className="farm-cross" data-farm="seeder-run">
          <g transform="translate(0 262) scale(0.7)">
            <Seeder />
          </g>
        </g>
      )}

      {/* Weather in front of the field. */}
      <g className="farm-rain farm-fade" opacity={sky.rain} stroke="#dff1ff" strokeWidth={1.8} strokeLinecap="round" data-farm="rain">
        {Array.from({ length: 36 }, (_, k) => {
          const x = (k * 47 + 13) % (W + 30);
          const y = (k * 61) % 230;
          return <line key={k} x1={x} y1={y} x2={x - 5} y2={y + 15} opacity={weather.kind === 'heavy-rain' || k % 2 === 0 ? 0.9 : 0} />;
        })}
      </g>
      <g className="farm-fade" opacity={weather.kind === 'frost' ? 1 : 0} fill="#ffffff" data-farm="frost">
        {Array.from({ length: 14 }, (_, k) => {
          const x = (k * 83 + 30) % W;
          const y = 222 + ((k * 37) % 100);
          return <path key={k} className="farm-twinkle" d={`M ${x} ${y - 4} l 1.2 2.8 2.8 1.2 -2.8 1.2 -1.2 2.8 -1.2 -2.8 -2.8 -1.2 2.8 -1.2 Z`} />;
        })}
      </g>

      {(Object.keys(MASCOT_AT) as FarmVoice[]).map((who) => {
        const at = MASCOT_AT[who];
        return (
          <g
            key={who}
            className="farm-mascot"
            transform={`translate(${at.x} ${at.y}) scale(${at.scale})`}
            role="button"
            tabIndex={0}
            aria-pressed={speaker === who}
            aria-label={names[who]}
            data-farm-mascot={who}
            onClick={() => onSpeak(who)}
            onKeyDown={key(who)}
          >
            <MascotFigure who={who} mood={lines[who].mood} talking={speaker === who} />
          </g>
        );
      })}
    </svg>
  );
}
