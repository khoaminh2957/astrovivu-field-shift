/**
 * FAO Irrigation and Drainage Paper 56 (Allen, Pereira, Raes, Smith 1998) rows used by the curated
 * overlay, transcribed from the FAO HTML edition and checked on 2026-11-14:
 *   Table 11 (stage lengths) and Table 12 (Kc): https://www.fao.org/4/X0490E/x0490e0b.htm
 *   Table 22 (rooting depth Zr, depletion fraction p) and Table 24 (seasonal Ky, from FAO I&D
 *   Paper 33): https://www.fao.org/4/X0490E/x0490e0e.htm
 *
 * Conventions:
 *   - where Table 12 prints no Kc ini for a crop, the Kc ini of its crop group is used (Table 12
 *     group headings: Small vegetables 0.7, Solanum 0.6, Cucumber family 0.5, Roots and tubers 0.5,
 *     Legumes 0.4, Oil crops 0.35, Cereals 0.3);
 *   - where a value is printed as a range, the midpoint is used unless a note says otherwise;
 *   - Zr is the midpoint of the Table 22 range (FAO: the low end suits irrigation scheduling, the
 *     high end rainfed conditions);
 *   - stage lengths are stored as fractions of the row's total;
 *   - a crop FAO-56 does not list is mapped to a named row or group and marked `assumed`. Those
 *     crops carry the catalogue flag `water-model-assumed`.
 */
import type { CropWaterModel } from '../../src/contracts';

export const FAO56_URL = 'https://www.fao.org/4/X0490E/x0490e0b.htm';

interface Row {
  /** Row name as printed in Table 12 / Table 22. */
  row: string;
  kc: [ini: number, mid: number, end: number];
  zr: [lo: number, hi: number];
  p: number;
  /** Table 11 row in days (Lini, Ldev, Lmid, Llate) and where it applies. */
  stages?: [number, number, number, number];
  stagesFrom?: string;
  ky?: number;
  kcNote?: string;
}

const mid = (a: number, b: number) => Math.round(((a + b) / 2) * 100) / 100;

/** Verified rows. Ranges printed by FAO are given in `kcNote`. */
export const FAO56 = {
  rice: { row: 'Rice', kc: [1.05, 1.2, 0.75], zr: [0.5, 1.0], p: 0.2, stages: [30, 30, 60, 30], stagesFrom: 'Rice, tropics', kcNote: 'Kc end 0.90-0.60' },
  maize: { row: 'Maize, field (grain)', kc: [0.3, 1.2, 0.35], zr: [1.0, 1.7], p: 0.55, stages: [30, 40, 50, 30], stagesFrom: 'Maize (grain), Spain / California', ky: 1.25, kcNote: 'Kc end 0.60-0.35: 0.35 is grain dried in the field' },
  springWheat: { row: 'Spring wheat', kc: [0.3, 1.15, 0.3], zr: [1.0, 1.5], p: 0.55, stages: [20, 25, 60, 30], stagesFrom: 'Barley/Oats/Wheat, 35-45° latitude', ky: 1.15, kcNote: 'Kc end 0.25-0.4' },
  sorghum: { row: 'Sorghum, grain', kc: [0.3, 1.05, 0.55], zr: [1.0, 2.0], p: 0.55, stages: [20, 35, 40, 30], stagesFrom: 'Sorghum, USA / Pakistan / Mediterranean', ky: 0.9, kcNote: 'Kc mid 1.00-1.10' },
  barley: { row: 'Barley', kc: [0.3, 1.15, 0.25], zr: [1.0, 1.5], p: 0.55, stages: [20, 25, 60, 30], stagesFrom: 'Barley/Oats/Wheat, 35-45° latitude' },
  oats: { row: 'Oats', kc: [0.3, 1.15, 0.25], zr: [1.0, 1.5], p: 0.55, stages: [20, 25, 60, 30], stagesFrom: 'Barley/Oats/Wheat, 35-45° latitude' },
  soybean: { row: 'Soybeans', kc: [0.4, 1.15, 0.5], zr: [0.6, 1.3], p: 0.5, stages: [20, 35, 60, 25], stagesFrom: 'Soybeans, Central USA', ky: 0.85 },
  groundnut: { row: 'Groundnut (peanut)', kc: [0.4, 1.15, 0.6], zr: [0.5, 1.0], p: 0.5, stages: [25, 35, 45, 25], stagesFrom: 'Groundnut, West Africa', ky: 0.7 },
  greenGram: { row: 'Green gram and cowpeas', kc: [0.4, 1.05, 0.35], zr: [0.6, 1.0], p: 0.45, stages: [20, 30, 30, 20], stagesFrom: 'Green gram, cowpeas', kcNote: 'Kc end 0.60 fresh, 0.35 dry' },
  beansDry: { row: 'Beans, dry and pulses', kc: [0.4, 1.15, 0.35], zr: [0.6, 0.9], p: 0.45, stages: [20, 30, 40, 20], stagesFrom: 'Beans (dry), continental climates', ky: 1.15 },
  beansGreen: { row: 'Beans, green', kc: [0.5, 1.05, 0.9], zr: [0.5, 0.7], p: 0.45, stages: [20, 30, 30, 10], stagesFrom: 'Beans (green), California / Mediterranean', ky: 1.15 },
  chickpea: { row: 'Chick pea', kc: [0.4, 1.0, 0.35], zr: [0.6, 1.0], p: 0.5 },
  peasDry: { row: 'Peas, dry/seed', kc: [0.4, 1.15, 0.3], zr: [0.6, 1.0], p: 0.4, stages: [15, 25, 35, 15], stagesFrom: 'Peas, Europe', ky: 1.15 },
  sesame: { row: 'Sesame', kc: [0.35, 1.1, 0.25], zr: [1.0, 1.5], p: 0.6, stages: [20, 30, 40, 20], stagesFrom: 'Sesame, China' },
  sunflower: { row: 'Sunflower', kc: [0.35, 1.1, 0.35], zr: [0.8, 1.5], p: 0.45, stages: [25, 35, 45, 25], stagesFrom: 'Sunflower, Mediterranean / California', ky: 0.95, kcNote: 'Kc mid 1.0-1.15' },
  canola: { row: 'Rapeseed, canola', kc: [0.35, 1.1, 0.35], zr: [1.0, 1.5], p: 0.6, kcNote: 'Kc mid 1.0-1.15' },
  safflower: { row: 'Safflower', kc: [0.35, 1.1, 0.25], zr: [1.0, 2.0], p: 0.6, stages: [20, 35, 45, 25], stagesFrom: 'Safflower, California', ky: 0.8, kcNote: 'Kc mid 1.0-1.15' },
  cassava: { row: 'Cassava, year 1', kc: [0.3, 0.8, 0.3], zr: [0.5, 0.8], p: 0.35, stages: [20, 40, 90, 60], stagesFrom: 'Cassava year 1, tropical regions' },
  sweetPotato: { row: 'Sweet potato', kc: [0.5, 1.15, 0.65], zr: [1.0, 1.5], p: 0.65, stages: [15, 30, 50, 30], stagesFrom: 'Sweet potato, tropical regions' },
  potato: { row: 'Potato', kc: [0.5, 1.15, 0.75], zr: [0.4, 0.6], p: 0.35, stages: [25, 30, 45, 30], stagesFrom: 'Potato, continental climate', ky: 1.1 },
  sugarcane: { row: 'Sugar cane', kc: [0.4, 1.25, 0.75], zr: [1.2, 2.0], p: 0.65, stages: [30, 50, 180, 60], stagesFrom: 'Sugarcane ratoon, tropics', ky: 1.2 },
  onionDry: { row: 'Onions, dry', kc: [0.7, 1.05, 0.75], zr: [0.3, 0.6], p: 0.3, stages: [15, 25, 70, 40], stagesFrom: 'Onion (dry), Mediterranean', ky: 1.1 },
  onionGreen: { row: 'Onions, green', kc: [0.7, 1.0, 1.0], zr: [0.3, 0.6], p: 0.3, stages: [25, 30, 10, 5], stagesFrom: 'Onion (green), Mediterranean' },
  coffee: { row: 'Coffee, bare ground cover', kc: [0.9, 0.95, 0.95], zr: [0.9, 1.5], p: 0.4 },
  tea: { row: 'Tea, non-shaded', kc: [0.95, 1.0, 1.0], zr: [0.9, 1.5], p: 0.4 },
  rubber: { row: 'Rubber trees', kc: [0.95, 1.0, 1.0], zr: [1.0, 1.5], p: 0.4 },
  palm: { row: 'Palm trees', kc: [0.95, 1.0, 1.0], zr: [0.7, 1.1], p: 0.65 },
  avocado: { row: 'Avocado, no ground cover', kc: [0.6, 0.85, 0.75], zr: [0.5, 1.0], p: 0.7 },
  banana: { row: 'Banana, 2nd year', kc: [1.0, 1.2, 1.1], zr: [0.5, 0.9], p: 0.35, stages: [120, 60, 180, 5], stagesFrom: 'Banana 2nd year, Mediterranean', ky: mid(1.2, 1.35), kcNote: 'Ky 1.2-1.35' },
  citrus: { row: 'Citrus, no ground cover, 70 % canopy', kc: [0.7, 0.65, 0.7], zr: [1.2, 1.5], p: 0.5, stages: [60, 90, 120, 95], stagesFrom: 'Citrus, Mediterranean', ky: mid(1.1, 1.3), kcNote: 'Ky 1.1-1.3' },
  alfalfa: { row: 'Alfalfa hay, averaged cutting effects', kc: [0.4, 0.95, 0.9], zr: [1.0, 2.0], p: 0.55, stages: [10, 30, 110, 15], stagesFrom: 'Alfalfa, total season (FAO prints 10/30/var./var.; mid and late set for a 165-day season)', ky: 1.1 },
  clover: { row: 'Clover hay, berseem, averaged cutting effects', kc: [0.4, 0.9, 0.85], zr: [0.6, 0.9], p: 0.5 },
  sudan: { row: 'Sudan grass hay (annual), averaged cutting effects', kc: [0.5, 0.9, 0.85], zr: [1.0, 1.5], p: 0.55, stages: [25, 25, 15, 10], stagesFrom: 'Sudan, first cutting cycle' },
  tomato: { row: 'Tomato', kc: [0.6, 1.15, 0.8], zr: [0.7, 1.5], p: 0.4, stages: [30, 40, 45, 30], stagesFrom: 'Tomato, Mediterranean', ky: 1.05, kcNote: 'Kc end 0.70-0.90' },
  pepper: { row: 'Sweet peppers (bell)', kc: [0.6, 1.05, 0.9], zr: [0.5, 1.0], p: 0.3, stages: [30, 35, 40, 20], stagesFrom: 'Sweet peppers, Europe and Mediterranean', ky: 1.1 },
  eggplant: { row: 'Egg plant', kc: [0.6, 1.05, 0.9], zr: [0.7, 1.2], p: 0.45, stages: [30, 40, 40, 20], stagesFrom: 'Egg plant, arid region' },
  lettuce: { row: 'Lettuce', kc: [0.7, 1.0, 0.95], zr: [0.3, 0.5], p: 0.3, stages: [20, 30, 15, 10], stagesFrom: 'Lettuce, Mediterranean' },
  spinach: { row: 'Spinach', kc: [0.7, 1.0, 0.95], zr: [0.3, 0.5], p: 0.2, stages: [20, 20, 20, 5], stagesFrom: 'Spinach, Mediterranean' },
  cabbage: { row: 'Cabbage', kc: [0.7, 1.05, 0.95], zr: [0.5, 0.8], p: 0.45, stages: [25, 35, 25, 10], stagesFrom: 'Crucifers, Mediterranean', ky: 0.95 },
  crucifer: { row: 'Small vegetables (group) / crucifers', kc: [0.7, 1.05, 0.95], zr: [0.4, 0.6], p: 0.45, stages: [20, 30, 20, 10], stagesFrom: 'Crucifers, Mediterranean' },
  cucumber: { row: 'Cucumber, fresh market', kc: [0.6, 1.0, 0.75], zr: [0.7, 1.2], p: 0.5, stages: [20, 30, 40, 15], stagesFrom: 'Cucumber, arid region' },
  watermelon: { row: 'Watermelon', kc: [0.4, 1.0, 0.75], zr: [0.8, 1.5], p: 0.4, stages: [20, 30, 30, 30], stagesFrom: 'Water melons, Italy', ky: 1.1 },
  pumpkin: { row: 'Pumpkin, winter squash', kc: [0.5, 1.0, 0.8], zr: [1.0, 1.5], p: 0.35, stages: [20, 30, 30, 20], stagesFrom: 'Pumpkin, Mediterranean' },
  radish: { row: 'Radish', kc: [0.7, 0.9, 0.85], zr: [0.3, 0.5], p: 0.3, stages: [5, 10, 15, 5], stagesFrom: 'Radish, Mediterranean / Europe' },
  carrot: { row: 'Carrots', kc: [0.7, 1.05, 0.95], zr: [0.5, 1.0], p: 0.35, stages: [30, 40, 60, 20], stagesFrom: 'Carrots, Mediterranean' },
  strawberry: { row: 'Strawberries', kc: [0.4, 0.85, 0.75], zr: [0.2, 0.3], p: 0.2 },
  mint: { row: 'Mint', kc: [0.6, 1.15, 1.1], zr: [0.4, 0.8], p: 0.4 },
  legumeGroup: { row: 'Legumes (group default)', kc: [0.4, 1.15, 0.55], zr: [0.6, 1.0], p: 0.45, stages: [20, 30, 40, 20], stagesFrom: 'Beans (dry), continental climates' },
  smallVegGroup: { row: 'Small vegetables (group default)', kc: [0.7, 1.05, 0.95], zr: [0.3, 0.5], p: 0.3, stages: [20, 30, 20, 10], stagesFrom: 'Crucifers, Mediterranean' },
  rootsGroup: { row: 'Roots and tubers (group default)', kc: [0.5, 1.1, 0.95], zr: [0.4, 0.6], p: 0.35 },
  cucurbitGroup: { row: 'Cucumber family (group default)', kc: [0.5, 1.0, 0.8], zr: [0.7, 1.2], p: 0.5, stages: [20, 30, 40, 15], stagesFrom: 'Cucumber, arid region' },
  cerealGroup: { row: 'Cereals (group default)', kc: [0.3, 1.15, 0.4], zr: [1.0, 1.5], p: 0.55, stages: [20, 30, 60, 40], stagesFrom: 'Grains (small), Mediterranean' },
} satisfies Record<string, Row>;

export type Fao56Key = keyof typeof FAO56;

/** Stage split used for evergreen perennials FAO-56 gives no Table 11 row for (citrus row pattern). */
const EVERGREEN_STAGES: [number, number, number, number] = [60, 90, 120, 95];
/** Stage split for short annual herbs and covers without a Table 11 row. */
const GENERIC_STAGES: [number, number, number, number] = [20, 30, 35, 15];

export interface WaterOptions {
  /** What was assumed because FAO-56 does not list the crop (goes into `source`, sets the flag). */
  assumed?: string;
  /** Override root depth (m) or p with a stated reason, e.g. a crop mapped to a group default. */
  zr?: number;
  p?: number;
  ky?: number | null;
  stages?: 'evergreen' | 'generic' | [number, number, number, number];
}

export function water(key: Fao56Key, opts: WaterOptions = {}): { model: CropWaterModel; assumed: boolean } {
  const r: Row = FAO56[key];
  const custom = Array.isArray(opts.stages) ? opts.stages : null;
  const days = custom ?? (opts.stages === 'evergreen' ? EVERGREEN_STAGES : opts.stages === 'generic' ? GENERIC_STAGES : r.stages) ?? GENERIC_STAGES;
  const total = days.reduce((a, b) => a + b, 0);
  const frac = days.map((d) => Math.round((d / total) * 1000) / 1000) as [number, number, number, number];
  const stagesAssumed = !custom && (opts.stages != null || !r.stages);
  const ky = opts.ky === null ? undefined : (opts.ky ?? r.ky);
  const parts = [
    `FAO-56 Table 12 "${r.row}" Kc ${r.kc.join('/')}${r.kcNote ? ` (${r.kcNote})` : ''}`,
    stagesAssumed
      ? `stage split ${days.join('/')} days assumed (no Table 11 row)`
      : `Table 11 "${custom ? 'see note' : r.stagesFrom}" ${days.join('/')} days`,
    `Table 22 Zr ${r.zr[0]}-${r.zr[1]} m${opts.zr != null ? ` (used ${opts.zr} m)` : ''}, p ${opts.p ?? r.p}`,
    ky != null ? `Ky ${ky} (FAO-56 Table 24, from FAO-33)` : 'no published Ky: 1.0 used',
  ];
  if (opts.assumed) parts.push(`ASSUMED: ${opts.assumed}`);
  return {
    model: {
      kc: { ini: r.kc[0], mid: r.kc[1], end: r.kc[2] },
      stages: frac,
      rootDepthM: opts.zr ?? mid(r.zr[0], r.zr[1]),
      depletionFraction: opts.p ?? r.p,
      ...(ky != null ? { ky } : {}),
      source: parts.join('; '),
    },
    assumed: Boolean(opts.assumed),
  };
}
