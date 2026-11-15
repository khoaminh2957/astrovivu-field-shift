/**
 * The plants of the farm scene: thirteen silhouettes (`CropLook`), each drawn from how far the crop
 * has grown and ripened, so that a seedling, a young plant, a full one and a ripe one are different
 * drawings and not one drawing at four sizes. A plant is drawn upward from its foot at (0, 0); a
 * full-grown one is about 60 units tall. Colours: leaf from the canopy's greenness, fruit per kind.
 */
import type { ReactElement } from 'react';
import type { CropLook } from '@/core/farm';

export interface PlantProps {
  look: CropLook;
  /** Height as drawn, 0..1. */
  growth: number;
  /** Ripening as drawn, 0..1. */
  ripeness: number;
  fill: string;
  dark: string;
  /** Varies the drawing a little from plant to plant; any integer. */
  seed?: number;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const STRAW = '#d9b24a';
const GOLD = '#e3ae2f';
const BARK = '#6f5236';

/** Which kinds turn straw-coloured as they ripen (the whole plant, not only its fruit). */
export const RIPENS: Record<CropLook, boolean> = {
  paddy: true,
  cereal: true,
  'tall-cereal': true,
  legume: true,
  oilseed: true,
  row: false,
  root: false,
  leafy: false,
  vine: false,
  grass: false,
  bush: false,
  tree: false,
  palm: false,
  none: false,
};

/** Leaf colour from the greenness of the canopy; a neutral grey-green when there is no image. */
export function leafColours(vigor: number | null, ripeness: number, ripens: boolean): { fill: string; dark: string } {
  if (vigor == null) return { fill: 'hsl(104 12% 50%)', dark: 'hsl(104 12% 38%)' };
  let h = lerp(74, 132, vigor);
  let s = lerp(34, 46, vigor);
  let l = lerp(52, 37, vigor);
  if (ripens) {
    h = lerp(h, 46, ripeness);
    s = lerp(s, 58, ripeness);
    l = lerp(l, 56, ripeness);
  }
  return { fill: `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`, dark: `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${(l - 11).toFixed(0)}%)` };
}

/** Two seed leaves on a short stem: every annual in its first days. */
function Sprout({ fill, dark }: { fill: string; dark: string }) {
  return (
    <g>
      <path d="M 0 0 L 0 -8" stroke={dark} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M 0 -8 Q -9 -15 -12 -8 Q -6 -4 0 -8 Z" fill={fill} />
      <path d="M 0 -8 Q 9 -16 13 -9 Q 7 -4 0 -8 Z" fill={dark} />
    </g>
  );
}

/** Rice and the small grains: a fan of blades; ripe, the heads bow (rice) or stand (wheat). */
function Grain({ growth: g, ripeness: r, fill, dark, bows, seed }: PlantProps & { bows: boolean }) {
  const n = 3 + Math.round(4 * g);
  const h = lerp(14, 44, g);
  const blades = Array.from({ length: n }, (_, k) => {
    const u = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;
    const x = u * lerp(5, 15, g);
    return { x, top: -h + Math.abs(u) * 7 + (((k + (seed ?? 0)) % 3) - 1) * 2, k };
  });
  return (
    <g>
      {blades.map((b) => (
        <path key={b.k} d={`M ${(b.x * 0.18).toFixed(1)} 0 Q ${(b.x * 0.45).toFixed(1)} ${(b.top * 0.6).toFixed(1)} ${b.x.toFixed(1)} ${b.top.toFixed(1)}`} fill="none" stroke={b.k % 2 ? dark : fill} strokeWidth={2.4} strokeLinecap="round" />
      ))}
      {g > 0.7 && (
        <g className="farm-fade" opacity={Math.max(0.25, r)}>
          {blades
            .filter((b) => b.k % 2 === 0)
            .map((b) =>
              bows ? (
                <path key={b.k} d={`M ${b.x.toFixed(1)} ${b.top.toFixed(1)} q ${b.x >= 0 ? 6 : -6} -3 ${b.x >= 0 ? 9 : -9} 6`} fill="none" stroke={r > 0.3 ? GOLD : fill} strokeWidth={3.4} strokeLinecap="round" strokeDasharray="1.5 2.6" />
              ) : (
                <ellipse key={b.k} cx={b.x} cy={b.top - 4} rx={2.2} ry={6} fill={r > 0.3 ? GOLD : fill} transform={`rotate(${(b.x * 1.4).toFixed(0)} ${b.x.toFixed(1)} ${b.top.toFixed(1)})`} />
              ),
            )}
        </g>
      )}
    </g>
  );
}

/** Maize, sorghum, sugarcane: one stalk, arching leaves in pairs, a tassel, then a cob. */
function TallCereal({ growth: g, ripeness: r, fill, dark }: PlantProps) {
  const h = lerp(14, 62, g);
  const pairs = 1 + Math.round(4 * g);
  return (
    <g>
      <path d={`M 0 0 L 0 ${-h}`} stroke={dark} strokeWidth={3} strokeLinecap="round" />
      {Array.from({ length: pairs }, (_, k) => {
        const y = -h * ((k + 1) / (pairs + 1));
        const reach = lerp(9, 19, g) * (1 - k / (pairs * 2.4));
        const side = k % 2 ? 1 : -1;
        return <path key={k} d={`M 0 ${y.toFixed(1)} Q ${(side * reach * 0.7).toFixed(1)} ${(y - 9).toFixed(1)} ${(side * reach).toFixed(1)} ${(y + 3).toFixed(1)}`} fill="none" stroke={k % 2 ? fill : dark} strokeWidth={3.2} strokeLinecap="round" />;
      })}
      {g > 0.85 && <path d={`M 0 ${-h} l -4 -8 M 0 ${-h} l 0 -10 M 0 ${-h} l 4 -8`} stroke={STRAW} strokeWidth={1.6} strokeLinecap="round" />}
      {g > 0.9 && <ellipse className="farm-fade" cx={4.5} cy={-h * 0.5} rx={3} ry={7.5} fill={r > 0.4 ? GOLD : fill} stroke={dark} strokeWidth={0.8} transform={`rotate(14 4.5 ${(-h * 0.5).toFixed(1)})`} />}
    </g>
  );
}

/** Beans, peas, groundnut: a low bush of three-part leaves; pods hang under them and dry to tan. */
function Legume({ growth: g, ripeness: r, fill, dark }: PlantProps) {
  const h = lerp(9, 26, g);
  const leaves = 2 + Math.round(3 * g);
  return (
    <g>
      <path d={`M 0 0 L 0 ${-h}`} stroke={dark} strokeWidth={2.2} strokeLinecap="round" />
      {Array.from({ length: leaves }, (_, k) => {
        const side = k % 2 ? 1 : -1;
        const y = -h * (0.35 + (0.65 * k) / Math.max(1, leaves - 1));
        const x = side * lerp(6, 12, g);
        return (
          <g key={k} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${side * 24})`}>
            <path d={`M ${-x.toFixed(1)} 0 L 0 0`} stroke={dark} strokeWidth={1.2} transform={`rotate(${-side * 24})`} />
            <ellipse cx={0} cy={-4} rx={3.6} ry={5.4} fill={fill} />
            <ellipse cx={-4.6} cy={1} rx={3.2} ry={4.6} fill={dark} transform="rotate(-38 -4.6 1)" />
            <ellipse cx={4.6} cy={1} rx={3.2} ry={4.6} fill={dark} transform="rotate(38 4.6 1)" />
          </g>
        );
      })}
      {g > 0.8 && (
        <g className="farm-fade" fill="none" stroke={r > 0.5 ? '#b08a4a' : '#7fae54'} strokeWidth={2.6} strokeLinecap="round">
          <path d={`M -4 ${(-h * 0.45).toFixed(1)} q -3 5 -1 9`} />
          <path d={`M 5 ${(-h * 0.6).toFixed(1)} q 4 4 2 9`} />
          <path d={`M 1 ${(-h * 0.3).toFixed(1)} q 2 4 0 8`} />
        </g>
      )}
    </g>
  );
}

/** Sunflower, rapeseed, sesame: a stalk with paired leaves and a yellow flower head that sets seed and browns. */
function Oilseed({ growth: g, ripeness: r, fill, dark }: PlantProps) {
  const h = lerp(12, 46, g);
  const pairs = 1 + Math.round(2 * g);
  return (
    <g>
      <path d={`M 0 0 L 0 ${-h}`} stroke={dark} strokeWidth={2.6} strokeLinecap="round" />
      {Array.from({ length: pairs }, (_, k) => {
        const y = -h * ((k + 1) / (pairs + 1.4));
        const w = lerp(6, 11, g);
        return (
          <g key={k}>
            <ellipse cx={-w * 0.75} cy={y} rx={w * 0.7} ry={3.2} fill={fill} transform={`rotate(-18 ${(-w * 0.75).toFixed(1)} ${y.toFixed(1)})`} />
            <ellipse cx={w * 0.75} cy={y - 2} rx={w * 0.7} ry={3.2} fill={dark} transform={`rotate(18 ${(w * 0.75).toFixed(1)} ${(y - 2).toFixed(1)})`} />
          </g>
        );
      })}
      {g > 0.7 && (
        <g transform={`translate(0 ${(-h - 3).toFixed(1)})`}>
          {Array.from({ length: 9 }, (_, k) => (
            <ellipse key={k} className="farm-fade" cx={0} cy={-7} rx={2.4} ry={4.6} fill={r > 0.6 ? '#b99a52' : '#f0c53a'} transform={`rotate(${k * 40})`} />
          ))}
          <circle className="farm-fade" r={4.6} fill={r > 0.6 ? '#5a4326' : '#8a5a22'} />
        </g>
      )}
    </g>
  );
}

/** Cassava, sweet potato, carrot, beet: a tuft of leaves over the shoulder of the root, which swells into view. */
function Root({ growth: g, fill, dark }: PlantProps) {
  const n = 3 + Math.round(3 * g);
  const len = lerp(8, 22, g);
  return (
    <g>
      {g > 0.55 && <ellipse className="farm-fade" cx={0} cy={0.5} rx={lerp(3, 8, g)} ry={lerp(1.5, 4, g)} fill="#c98250" stroke="#9c5f36" strokeWidth={0.8} />}
      {Array.from({ length: n }, (_, k) => {
        const a = n === 1 ? 0 : -58 + (116 * k) / (n - 1);
        return (
          <g key={k} transform={`rotate(${a.toFixed(0)})`}>
            <path d={`M 0 0 L 0 ${(-len * 0.55).toFixed(1)}`} stroke={dark} strokeWidth={1.4} />
            <ellipse cx={0} cy={-len * 0.72} rx={lerp(2.4, 4.4, g)} ry={len * 0.36} fill={k % 2 ? dark : fill} />
          </g>
        );
      })}
    </g>
  );
}

/** Cabbage, lettuce, herbs: a rosette that closes into a head. */
function Leafy({ growth: g, fill, dark }: PlantProps) {
  const r = lerp(4, 12, g);
  return (
    <g>
      <ellipse cx={-r * 0.9} cy={-r * 0.45} rx={r * 0.9} ry={r * 0.5} fill={dark} transform={`rotate(-24 ${(-r * 0.9).toFixed(1)} ${(-r * 0.45).toFixed(1)})`} />
      <ellipse cx={r * 0.9} cy={-r * 0.45} rx={r * 0.9} ry={r * 0.5} fill={dark} transform={`rotate(24 ${(r * 0.9).toFixed(1)} ${(-r * 0.45).toFixed(1)})`} />
      <ellipse cx={0} cy={-r * 0.3} rx={r * 1.1} ry={r * 0.42} fill={dark} />
      <circle cx={0} cy={-r * 0.85} r={r * 0.82} fill={fill} />
      {g > 0.6 && <path d={`M ${(-r * 0.5).toFixed(1)} ${(-r * 0.9).toFixed(1)} Q 0 ${(-r * 1.5).toFixed(1)} ${(r * 0.5).toFixed(1)} ${(-r * 0.9).toFixed(1)}`} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1.4} strokeLinecap="round" />}
    </g>
  );
}

/** Pepper, grape, passion fruit: a stake, and a vine that climbs it; clusters hang when ripe. */
function Vine({ growth: g, ripeness: r, fill, dark }: PlantProps) {
  const h = lerp(10, 54, g);
  const leaves = 2 + Math.round(6 * g);
  return (
    <g>
      <path d="M 0 0 L 0 -58" stroke={BARK} strokeWidth={2.6} strokeLinecap="round" />
      <path d="M -9 -52 L 9 -52" stroke={BARK} strokeWidth={2} strokeLinecap="round" />
      <path d={`M 0 0 ${Array.from({ length: Math.ceil(h / 9) }, (_, k) => `q ${k % 2 ? -5 : 5} -4.5 0 -9`).join(' ')}`} fill="none" stroke={dark} strokeWidth={1.8} />
      {Array.from({ length: leaves }, (_, k) => {
        const y = -h * ((k + 0.6) / leaves);
        const side = k % 2 ? 1 : -1;
        return <path key={k} d={`M 0 ${y.toFixed(1)} q ${side * 8} -7 ${side * 11} 0 q ${-side * 5} 5 ${-side * 11} 0 Z`} fill={k % 3 ? fill : dark} />;
      })}
      {g > 0.8 && (
        <g className="farm-fade" opacity={Math.max(0.2, r)} fill={r > 0.5 ? '#8c3b52' : '#7fae54'}>
          {[-0.35, -0.6, -0.82].map((u, k) => (
            <g key={k} transform={`translate(${k % 2 ? 6 : -6} ${(h * u).toFixed(1)})`}>
              <circle r={2} />
              <circle cx={1.6} cy={3} r={1.9} />
              <circle cx={-1.2} cy={3.4} r={1.7} />
              <circle cx={0.3} cy={6.2} r={1.6} />
            </g>
          ))}
        </g>
      )}
    </g>
  );
}

/** Coffee, tea, berries: a rounded shrub; cherries redden. */
function Bush({ ripeness: r, fill, dark }: PlantProps) {
  return (
    <g>
      <path d="M 0 0 L 0 -12" stroke={BARK} strokeWidth={3} strokeLinecap="round" />
      <ellipse cx={-11} cy={-18} rx={12} ry={10} fill={dark} />
      <ellipse cx={11} cy={-18} rx={12} ry={10} fill={dark} />
      <ellipse cx={0} cy={-27} rx={15} ry={12} fill={fill} />
      <path d="M -8 -32 Q 0 -38 8 -32" fill="none" stroke="#ffffff" strokeOpacity={0.22} strokeWidth={2} strokeLinecap="round" />
      <g className="farm-fade" opacity={r} fill="#b9402f">
        {[
          [-10, -16],
          [6, -21],
          [-2, -29],
          [12, -13],
          [-15, -22],
        ].map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r={2.1} />
        ))}
      </g>
    </g>
  );
}

/** Fruit and other trees: a trunk under a layered crown; fruit colours in. */
function Tree({ ripeness: r, fill, dark }: PlantProps) {
  return (
    <g>
      <path d="M 0 0 L 0 -26 M 0 -18 l -7 -8 M 0 -21 l 7 -7" stroke={BARK} strokeWidth={3.6} strokeLinecap="round" fill="none" />
      <ellipse cx={-13} cy={-34} rx={14} ry={12} fill={dark} />
      <ellipse cx={13} cy={-34} rx={14} ry={12} fill={dark} />
      <ellipse cx={0} cy={-46} rx={18} ry={15} fill={fill} />
      <ellipse cx={-5} cy={-50} rx={9} ry={6} fill="#ffffff" opacity={0.13} />
      <g className="farm-fade" opacity={r} fill="#e08a2c">
        <circle cx={-10} cy={-33} r={2.6} />
        <circle cx={9} cy={-39} r={2.6} />
        <circle cx={2} cy={-28} r={2.4} />
        <circle cx={-3} cy={-48} r={2.4} />
      </g>
    </g>
  );
}

/** Coconut, oil palm, banana, pineapple: a leaning trunk and a crown of fronds. */
function Palm({ ripeness: r, fill, dark }: PlantProps) {
  return (
    <g>
      <path d="M 0 0 Q 3 -24 -2 -46" fill="none" stroke={BARK} strokeWidth={4.2} strokeLinecap="round" />
      <g transform="translate(-2 -46)">
        {[-78, -46, -16, 16, 46, 78].map((a, k) => (
          <path key={k} d="M 0 0 Q 12 -10 26 -2 Q 13 -3 0 0 Z" fill={k % 2 ? dark : fill} transform={`rotate(${a - 90}) scale(1 ${a < 0 ? -1 : 1})`} />
        ))}
        <path d="M 0 0 Q 2 -14 0 -24 Q -2 -14 0 0 Z" fill={fill} />
        <g className="farm-fade" opacity={Math.max(0.35, r)} fill={r > 0.5 ? '#c7802b' : '#8a9a4a'}>
          <circle cx={-3} cy={4} r={3} />
          <circle cx={3} cy={4.5} r={3} />
          <circle cx={0} cy={7.5} r={2.8} />
        </g>
      </g>
    </g>
  );
}

/** Forage and cover crops: a low, dense tuft. */
function Grass({ growth: g, fill, dark, seed }: PlantProps) {
  const h = lerp(6, 17, g);
  return (
    <g>
      {[-15, -10, -5, 0, 5, 10, 15].map((x, k) => (
        <path key={k} d={`M ${(x * 0.75).toFixed(1)} 0 Q ${x} ${(-h * 0.6).toFixed(1)} ${(x * 1.15).toFixed(1)} ${(-h - ((k + (seed ?? 0)) % 3) * 2).toFixed(1)}`} fill="none" stroke={k % 2 ? dark : fill} strokeWidth={2.2} strokeLinecap="round" />
      ))}
    </g>
  );
}

/** Anything else grown in rows: a small bush with fruit. */
function Row({ growth: g, ripeness: r, fill, dark }: PlantProps) {
  const s = lerp(0.45, 1, g);
  return (
    <g transform={`scale(${s.toFixed(2)})`}>
      <path d="M 0 0 L 0 -8" stroke={dark} strokeWidth={2.4} strokeLinecap="round" />
      <circle cx={-7} cy={-11} r={7.5} fill={dark} />
      <circle cx={7} cy={-11} r={7.5} fill={dark} />
      <circle cx={0} cy={-17} r={9} fill={fill} />
      <g className="farm-fade" opacity={r} fill="#c9502f">
        <circle cx={-6} cy={-9} r={2} />
        <circle cx={5} cy={-14} r={2} />
        <circle cx={1} cy={-6} r={2} />
      </g>
    </g>
  );
}

/** One plant. Annuals in their first days are a sprout whatever their kind. */
export function Plant(props: PlantProps): ReactElement | null {
  const { look, growth } = props;
  if (look === 'none' || growth <= 0) return null;
  const perennial = look === 'bush' || look === 'tree' || look === 'palm';
  if (!perennial && look !== 'grass' && look !== 'vine' && growth < 0.2) return <Sprout fill={props.fill} dark={props.dark} />;
  switch (look) {
    case 'paddy':
      return <Grain {...props} bows />;
    case 'cereal':
      return <Grain {...props} bows={false} />;
    case 'tall-cereal':
      return <TallCereal {...props} />;
    case 'legume':
      return <Legume {...props} />;
    case 'oilseed':
      return <Oilseed {...props} />;
    case 'root':
      return <Root {...props} />;
    case 'leafy':
      return <Leafy {...props} />;
    case 'vine':
      return <Vine {...props} />;
    case 'bush':
      return <Bush {...props} />;
    case 'tree':
      return <Tree {...props} />;
    case 'palm':
      return <Palm {...props} />;
    case 'grass':
      return <Grass {...props} />;
    default:
      return <Row {...props} />;
  }
}

/** What is left of a cut plant. */
export function Stubble() {
  return <path d="M -7 0 L -8 -5 M -2.5 0 L -2.5 -6 M 2.5 0 L 3.5 -5 M 7 0 L 8 -6" stroke="#c4a566" strokeWidth={2} strokeLinecap="round" />;
}

/**
 * A patch of field for the time bar: three plants of the month's kind on a strip of soil, cropped
 * tight so that a 30 px chip still reads. Height follows `growth`; a harvest shows stubble; bare
 * ground is the strip alone.
 */
export function FieldChip({ look, growth, ripeness, cut = false, size = 30 }: { look: CropLook; growth: number; ripeness: number; cut?: boolean; size?: number }) {
  const { fill, dark } = leafColours(0.85, ripeness, RIPENS[look]);
  const g = Math.max(0.35, growth);
  return (
    <svg viewBox="-32 -60 64 66" width={size} height={size} aria-hidden>
      <rect x={-30} y={0} width={60} height={5} rx={2.5} fill="#a9875c" />
      {look === 'none'
        ? <path d="M -22 -3 H 22" stroke="#a9875c" strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />
        : [-15, 0, 15].map((x, i) => (
            <g key={x} transform={`translate(${x} 0) scale(${i === 1 ? 0.8 : 0.66})`}>
              {cut ? <Stubble /> : <Plant look={look} growth={g} ripeness={ripeness} fill={fill} dark={dark} seed={i + 1} />}
            </g>
          ))}
    </svg>
  );
}

/**
 * A plant on a neutral ground, for a legend, a card or the time bar: by default the full-grown,
 * half-ripe drawing of its kind; with `growth` and `ripeness` the plant as it stands that month.
 * `cut` draws what a harvest leaves; `look: 'none'` a bare strip of ground.
 */
export function PlantIcon({ look, size = 28, vigor = 0.75, growth = 1, ripeness = 0.7, cut = false }: { look: CropLook; size?: number; vigor?: number; growth?: number; ripeness?: number; cut?: boolean }) {
  const { fill, dark } = leafColours(vigor, ripeness, RIPENS[look]);
  return (
    <svg viewBox="-34 -70 68 76" width={size} height={size} aria-hidden>
      {look === 'none' ? (
        <path d="M -24 0 H 24" stroke="var(--color-line-3)" strokeWidth={3} strokeDasharray="4 5" strokeLinecap="round" />
      ) : cut ? (
        <g transform="scale(2.2)"><Stubble /></g>
      ) : (
        <Plant look={look} growth={growth} ripeness={ripeness} fill={fill} dark={dark} />
      )}
    </svg>
  );
}
