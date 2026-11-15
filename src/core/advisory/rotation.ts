/**
 * Rotation planner: the current strategy plus soil-health, water-saver, income and resilience
 * alternatives built from the curated catalogue. Rules in docs/ADVISORY.md §2.
 */
import type { CropProfile, EvidenceItem, FarmerPriority, I18nText, ModelInput, RotationKind, RotationSeason, RotationSeasonDetail, RotationStrategy, SeasonEconomics } from '@/contracts';
import { getCrop, listCrops } from '@/core/crops';
import { economicRegions, ownEconomics, referenceEconomics, seasonEconomics, strategyEconomics } from '@/core/economics';
import { scanSowingWindows, windowMonths } from '@/core/scoring';
import { type MonthNormal, monthlyNormals } from '@/lib/climate';
import { cropSeasonDetail, fallowSeasons, sumNormal } from './seasonDetail';
import { climateNormals, cropText, effectiveIrrigation, factNum, meanKc, monthEn, monthVi, monthsFrom, r0, resolutionM, sourceName, tx, wrapMonth } from './util';

/** One planned season. `share` < 1 marks an inter-row or partial-area crop standing beside the main one. */
export interface Plan {
  cropId: string;
  start: number;
  len: number;
  year: number;
  share: number;
  role?: 'inter-row' | 'companion' | 'converted' | 'break' | 'cover';
  /** A legume the engine placed for its nitrogen (soil-health rules), not for its margin. */
  forN?: boolean;
}

export interface Ctx {
  input: ModelInput;
  irrigation: 'rainfed' | 'supplemental' | 'full';
  irrigationInferred: boolean;
  /** `known` is false when the scorer returned no windows and `s` is only a zero placeholder. */
  fit: (id: string) => { s: number[]; rel: (number | null)[]; known: boolean };
  /** Same monthly normals the calendar's rain strip is drawn from. */
  normals: MonthNormal[];
  best: (id: string) => { month: number; s: number };
  currentSource: 'ground-truth' | 'crop-history' | 'assumed';
  main: CropProfile | undefined;
}

const CDL: [RegExp, string][] = [
  [/corn/i, 'zea-mays'],
  [/soy/i, 'glycine-max'],
  [/alfalfa/i, 'medicago-sativa'],
  [/wheat/i, 'triticum-aestivum'],
  [/sorghum/i, 'sorghum-bicolor'],
  [/barley/i, 'hordeum-vulgare'],
  [/oats/i, 'avena-sativa'],
  [/rye/i, 'secale-cereale'],
  [/rice/i, 'oryza-sativa'],
  [/sunflower/i, 'helianthus-annuus'],
  [/canola/i, 'brassica-napus'],
  [/safflower/i, 'carthamus-tinctorius'],
  [/potato/i, 'solanum-tuberosum'],
  [/dry beans/i, 'phaseolus-vulgaris'],
  [/peas/i, 'pisum-sativum'],
];
const cdlCrop = (name: string) => CDL.find(([re]) => re.test(name))?.[1];

export const isStand = (c: CropProfile) => c.lifeSpan !== 'annual' && (c.category === 'forage' || c.category === 'cover' || c.id === 'saccharum-officinarum');
export const isTree = (c: CropProfile) => c.lifeSpan === 'perennial' && !isStand(c);
const hasEcon = (id: string, input: ModelInput) => {
  const r = referenceEconomics(id, input.parcel);
  return !!r && r.refYieldTHa != null && r.priceUsdPerT != null && r.costUsdPerHa != null;
};
const label = (p: Plan): I18nText => {
  const n = cropText(p.cropId);
  const pct = Math.round(p.share * 100);
  switch (p.role) {
    case 'inter-row':
      return tx(`${n.en} (inter-row cover, ~${pct} % of area)`, `${n.vi} (che phủ giữa hàng, ~${pct} % diện tích)`);
    case 'companion':
      return tx(`${n.en} (companion crop, ~${pct} % of area)`, `${n.vi} (cây trồng xen, ~${pct} % diện tích)`);
    case 'converted':
      return tx(`${n.en} (converted part, ~${pct} % of area)`, `${n.vi} (phần chuyển đổi, ~${pct} % diện tích)`);
    case 'cover':
      return tx(`${n.en} (cover crop)`, `${n.vi} (cây che phủ)`);
    case 'break':
      return tx(`${n.en} (break crop)`, `${n.vi} (cây cắt vòng)`);
    default:
      return n;
  }
};

// ------------------------------------------------------------------------------------------------
// Current strategy
// ------------------------------------------------------------------------------------------------

function currentPlans(ctx: Ctx): { plans: Plan[]; years: number } {
  const { input } = ctx;
  const cr = input.groundTruth.currentRotation?.filter((s) => getCrop(s.cropId) || s.cropId === 'fallow');
  if (cr?.length) {
    ctx.currentSource = 'ground-truth';
    const kept = cr.filter((s) => s.cropId !== 'fallow');
    // Crops entered in the same season grow side by side: same year, area split between them.
    const groupKey = (s: (typeof kept)[number], i: number) => (s.season != null ? `s${s.season}` : `i${i}`);
    const keys = kept.map(groupKey);
    const size = (k: string) => keys.filter((x) => x === k).length;
    const plans: Plan[] = kept.map((s, i) => {
      const n = size(keys[i]);
      const rank = keys.slice(0, i).filter((x) => x === keys[i]).length;
      const share = s.share != null && s.share > 0 && s.share <= 1 ? s.share : 1 / n;
      return {
        cropId: s.cropId,
        start: s.startMonth,
        len: getCrop(s.cropId)?.lifeSpan !== 'annual' && s.startMonth === wrapMonth(s.endMonth + 1) ? 12 : ((s.endMonth - s.startMonth + 12) % 12) + 1,
        year: 0,
        share,
        ...(n > 1 && rank > 0 ? { role: 'companion' as const } : {}),
      };
    });
    // Entries that overlap an earlier entry's months are later years of the rotation (e.g. corn then soybean).
    for (let i = 1; i < plans.length; i++) {
      const sibling = keys.findIndex((k, j) => j < i && k === keys[i]);
      if (sibling >= 0) {
        plans[i].year = plans[sibling].year;
        continue;
      }
      let y = plans[i - 1].year;
      const ms = monthsFrom(plans[i].start, plans[i].len);
      while (plans.some((q, j) => j < i && keys[j] !== keys[i] && q.year === y && monthsFrom(q.start, q.len).some((m) => ms.includes(m)))) y++;
      plans[i].year = y;
    }
    return { plans, years: Math.max(...plans.map((q) => q.year)) + 1 };
  }
  const hist = (input.telemetry.cropHistory ?? []).slice().sort((a, b) => a.year - b.year);
  const recent = hist.slice(-2).map((h) => cdlCrop(h.crop)).filter((x): x is string => !!x && !!getCrop(x));
  if (recent.length === 2) {
    ctx.currentSource = 'crop-history';
    const uniq = recent[0] === recent[1] ? [recent[0]] : recent;
    return { plans: uniq.map((id, i) => mkSeason(ctx, id, i)), years: uniq.length };
  }
  ctx.currentSource = 'assumed';
  const main = ctx.main ?? getCrop(bestOverall(ctx));
  if (!main) return { plans: [], years: 1 };
  if (main.lifeSpan !== 'annual') return { plans: [mkSeason(ctx, main.id, 0)], years: 1 };
  // As many back-to-back seasons of the crop as the calendar supports at a fit of 60 or more.
  const len = windowMonths(main);
  const { s } = ctx.fit(main.id);
  const b = ctx.best(main.id);
  const plans: Plan[] = [{ cropId: main.id, start: b.month, len, year: 0, share: 1 }];
  for (let k = 1; k < 3 && (k + 1) * len <= 12; k++) {
    const m = wrapMonth(b.month + k * len);
    if (s[m - 1] >= 60) plans.push({ cropId: main.id, start: m, len, year: 0, share: 1 });
    else break;
  }
  return { plans, years: 1 };
}

function mkSeason(ctx: Ctx, id: string, year: number, role?: Plan['role'], share = 1): Plan {
  const c = getCrop(id)!;
  const b = ctx.best(id);
  const len = c.lifeSpan === 'annual' ? windowMonths(c) : 12;
  return { cropId: id, start: c.lifeSpan === 'annual' ? b.month : 1, len, year, share, ...(role ? { role } : {}) };
}

function bestOverall(ctx: Ctx): string {
  let best = 'zea-mays';
  let bs = -1;
  for (const c of listCrops()) {
    if (c.lifeSpan !== 'annual' || !hasEcon(c.id, ctx.input)) continue;
    const s = ctx.best(c.id).s;
    if (s > bs) (bs = s), (best = c.id);
  }
  return best;
}

// ------------------------------------------------------------------------------------------------
// Candidate building
// ------------------------------------------------------------------------------------------------

type Chooser = (c: CropProfile, month: number, s: number) => number;

function pool(ctx: Ctx, kind: 'cash' | 'cover' | 'tree'): CropProfile[] {
  const avoid = new Set(ctx.input.groundTruth.avoidCropIds ?? []);
  return listCrops().filter((c) => {
    if (avoid.has(c.id) || !c.rotation) return false;
    if (kind === 'cover') return c.category === 'cover' && c.lifeSpan !== 'perennial';
    if (kind === 'tree') return isTree(c) && hasEcon(c.id, ctx.input);
    return c.lifeSpan === 'annual' && c.category !== 'cover' && hasEcon(c.id, ctx.input);
  });
}

/** Fill the months left free in `year` with crops picked by `choose`, never repeating a pest group back to back. */
function fill(ctx: Ctx, plans: Plan[], year: number, choose: Chooser, opts: { maxAdd?: number; allowCover?: boolean; cashMin?: number } = {}): Plan[] {
  const out = [...plans];
  const occupied = (m: number) => out.some((p) => p.year === year && p.share === 1 && monthsFrom(p.start, p.len).includes(m));
  const candidates = [...pool(ctx, 'cash'), ...(opts.allowCover === false ? [] : pool(ctx, 'cover'))];
  let added = 0;
  for (let guard = 0; guard < 4 && added < (opts.maxAdd ?? 3); guard++) {
    let pick: Plan | null = null;
    let pv = -Infinity;
    for (let m = 1; m <= 12; m++) {
      if (occupied(m) || !occupied(wrapMonth(m - 1))) continue;
      let free = 0;
      while (free < 12 && !occupied(wrapMonth(m + free))) free++;
      const prev = out.find((p) => p.year === year && wrapMonth(p.start + p.len) === m);
      const next = out.find((p) => p.year === year && p.share === 1 && p.start === wrapMonth(m + free));
      for (const c of candidates) {
        const len = windowMonths(c);
        if (len > free) continue;
        const pg = c.rotation!.pestGroup;
        if (getCrop(prev?.cropId)?.rotation?.pestGroup === pg || getCrop(next?.cropId)?.rotation?.pestGroup === pg) continue;
        for (const st of [m, wrapMonth(m + 1)]) {
          if (st !== m && len + 1 > free) continue;
          const s = ctx.fit(c.id).s[st - 1];
          if (s < (c.category === 'cover' ? 35 : (opts.cashMin ?? 55))) continue;
          const v = choose(c, st, s);
          if (v > pv) (pv = v), (pick = { cropId: c.id, start: st, len, year, share: 1, ...(c.category === 'cover' ? { role: 'cover' as const } : choose === soilChooser && c.rotation!.nitrogenFixing ? { forN: true } : {}) });
        }
      }
    }
    if (!pick) break;
    out.push(pick);
    added++;
  }
  return out;
}

function etcMm(ctx: Ctx, c: CropProfile, start: number, len: number): number {
  const n = climateNormals(ctx.input.telemetry);
  const et0 = monthsFrom(start, len).reduce((a, m) => a + (n ? n[m - 1].et0Mm : 120), 0);
  return meanKc(c) * et0;
}
const RES = { low: 0.3, medium: 0.6, high: 1 } as const;
const COV = { low: 0.2, medium: 0.6, high: 1 } as const;

const soilChooser: Chooser = (c, _m, s) => s / 100 + (c.rotation!.nitrogenFixing ? 0.6 : 0) + COV[c.rotation!.coverValue] * 0.4 + RES[c.rotation!.residue] * 0.2;
const waterChooser = (ctx: Ctx): Chooser => (c, m, s) => (c.rotation!.waterUse === 'high' ? -Infinity : s / 100 - etcMm(ctx, c, m, windowMonths(c)) / 500);
const marginOf = (ctx: Ctx, id: string, s: number) => {
  const r = referenceEconomics(id, ctx.input.parcel);
  if (!r || r.refYieldTHa == null || r.priceUsdPerT == null || r.costUsdPerHa == null) return -Infinity;
  return (r.refYieldTHa * (s / 100) * r.priceUsdPerT - r.costUsdPerHa) / 1000;
};
const incomeChooser = (ctx: Ctx): Chooser => (c, _m, s) => (c.category === 'cover' ? -Infinity : marginOf(ctx, c.id, s));

function bestBy(ctx: Ctx, list: CropProfile[], value: (c: CropProfile, s: number, m: number) => number, min = 55, exclude: string[] = []): CropProfile | undefined {
  let best: CropProfile | undefined;
  let bv = -Infinity;
  for (const c of list) {
    if (exclude.includes(c.id)) continue;
    const b = ctx.best(c.id);
    if (b.s < min) continue;
    const v = value(c, b.s, b.month);
    if (v > bv) (bv = v), (best = c);
  }
  return best;
}

// ------------------------------------------------------------------------------------------------
// The most profitable sequence under constraints (docs/ECONOMICS.md, section 5)
// ------------------------------------------------------------------------------------------------

/** One season the search can place: a cash crop sown in a month in which the field suits it. */
interface Slot {
  crop: CropProfile;
  start: number;
  len: number;
  /** Months of the year the season occupies, one bit each. */
  mask: number;
  /** Those of them that lie after December, in the following year. */
  spill: number;
  marginUsd: number;
}

/** A field score from which a cash crop is placed at all: the threshold `fill` has always used. */
const CASH_MIN_SCORE = 55;
/** A sowing month whose needs were met in fewer than half of the analysed years is not planned on (the scorer's own reliability threshold). */
const MIN_RELIABILITY = 0.5;
const MAX_SEASONS = 4;
/** Sequences are checked against the constraints best margin first; this many are kept for that. */
const KEPT = 2000;
/** The search gives up (and the caller falls back) when this many of the best sequences all fail a constraint. */
const MAX_CHECKED = 200;

/** Two-year alternations are built from this many of the best one-year sequences (all of them when there are fewer). */
const PAIRED = 300;

export interface ProfitSearch {
  plans: Plan[];
  /** Length of the cycle in years: 1, or 2 for two different years in alternation. */
  years: number;
  /** Sequences compared: one-year sequences, and two-year alternations of them. */
  examined: { oneYear: number; twoYear: number };
  /** Place of the chosen sequence by margin; 1 when no constraint had to be applied. */
  rank: number;
  /** Margin per hectare and year, USD: of the chosen sequence, and of the best one before constraints. */
  marginUsdPerHaYr: number;
  bestMarginUsdPerHaYr: number;
  /** How many sequences with a higher margin failed each constraint (a sequence can fail several). */
  rejected: { soil: number; water: number; risk: number };
  /** True when low risk is among the grower's priorities: the risk score may then not rise above today's. */
  riskCapped: boolean;
  /** True when what the grower does now came out first: the plan returned is then the next one. */
  currentIsBest: boolean;
  /** Crops that suit the field but have no reference price or cost for its region, and so were not compared. */
  noEconomics: string[];
}

/** What the grower does now is the floor: a plan may earn more, it may not leave soil or water worse off. */
export function meetsConstraints(e: Evaluated, current: Evaluated, riskCapped: boolean): { soil: boolean; water: boolean; risk: boolean } {
  return {
    soil: e.metrics.soilHealth >= current.metrics.soilHealth,
    water: e.metrics.waterFit >= current.metrics.waterFit,
    risk: !riskCapped || e.metrics.risk <= current.metrics.risk,
  };
}

/** The seasons of a plan as a set, so that the same rotation written in another order compares equal. */
const planKey = (plans: Pick<Plan, 'cropId' | 'start' | 'year'>[], years: number, shift = 0): string =>
  plans
    .map((p) => `${p.cropId}@${p.start}/${(p.year + shift) % years}`)
    .sort()
    .join('+');

/**
 * The sequence of cash crops with the highest expected margin that keeps soil health and water fit
 * at least at the level of the current rotation (and risk no higher, when the grower ranks low
 * risk). Compared are all one-year sequences of up to four seasons and all two-year alternations
 * of them (of the best `PAIRED` when there are more). Nothing is sampled, so the same field gives
 * the same answer. Null when no crop has economics for the region, or when none of the best
 * sequences passes.
 */
export function profitSearch(ctx: Ctx, current: Evaluated, currentPlans: Plan[] = []): ProfitSearch | null {
  const { input } = ctx;
  const area = input.parcel.areaHa;
  const own = ownEconomics(input.groundTruth);
  // `referenceEconomics` falls back to another region when the parcel's has no figure for a crop.
  // A comparison of margins may not rest on that: only figures of the parcel's own region count here.
  const regions = economicRegions(input.parcel);
  const localReference = (id: string) => {
    const r = referenceEconomics(id, input.parcel);
    return r && regions.includes(r.region) ? r : null;
  };
  const slots: Slot[] = [];
  for (const crop of pool(ctx, 'cash')) {
    const len = windowMonths(crop);
    if (len > 12) continue;
    const fit = ctx.fit(crop.id);
    const reference = localReference(crop.id);
    for (let m = 1; m <= 12; m++) {
      const score = fit.s[m - 1];
      const reliability = fit.rel[m - 1];
      if (score < CASH_MIN_SCORE || (reliability != null && reliability < MIN_RELIABILITY)) continue;
      const e = seasonEconomics({ cropId: crop.id, areaHa: area, yieldFraction: score / 100, reference, own: crop.id === input.cropId ? own : undefined });
      if (!e) continue;
      const months = Array.from({ length: len }, (_, i) => m - 1 + i);
      slots.push({
        crop,
        start: m,
        len,
        mask: months.reduce((a, month) => a | (1 << month % 12), 0),
        spill: months.filter((month) => month >= 12).reduce((a, month) => a | (1 << (month - 12)), 0),
        marginUsd: e.marginUsd,
      });
    }
  }
  if (slots.length === 0) return null;
  slots.sort((a, b) => a.start - b.start || a.crop.id.localeCompare(b.crop.id));

  type Sequence = { margin: number; picks: number[] };
  const pest = (i: number) => slots[i].crop.rotation!.pestGroup;
  // Equal margins are ordered by what the sequence is, so the result does not depend on the order of enumeration.
  const sig = (c: Sequence) => c.picks.map((i) => `${slots[i].crop.id}@${slots[i].start}`).join('+');
  const byMargin = (a: Sequence, b: Sequence) => b.margin - a.margin || sig(a).localeCompare(sig(b));

  // Every set of non-overlapping seasons of one year, built in order of sowing month. Two seasons
  // that follow each other (the last and the first too: the year repeats) may not share a pest group.
  let oneYearCount = 0;
  let oneYear: Sequence[] = [];
  let floor = -Infinity;
  const picks: number[] = [];
  const visit = (from: number, mask: number, margin: number): void => {
    for (let i = from; i < slots.length; i++) {
      const slot = slots[i];
      if (mask & slot.mask) continue;
      if (picks.length && pest(picks[picks.length - 1]) === pest(i)) continue;
      picks.push(i);
      const total = margin + slot.marginUsd;
      if (picks.length === 1 || pest(picks[0]) !== pest(i)) {
        oneYearCount++;
        if (total > floor || oneYear.length < KEPT) {
          oneYear.push({ margin: total, picks: [...picks] });
          if (oneYear.length >= 2 * KEPT) {
            oneYear.sort(byMargin);
            oneYear = oneYear.slice(0, KEPT);
            floor = oneYear[oneYear.length - 1].margin;
          }
        }
      }
      if (picks.length < MAX_SEASONS) visit(i + 1, mask | slot.mask, total);
      picks.pop();
    }
  };
  visit(0, 0, 0);
  oneYear.sort(byMargin);
  oneYear = oneYear.slice(0, KEPT);

  // Two different years in alternation (maize, then soybean). A season that runs past December
  // lands in the other year, and the last crop of one year is followed by the first of the other.
  const own12 = (c: Sequence) => c.picks.reduce((a, i) => a | (slots[i].mask & ~slots[i].spill), 0);
  const spill = (c: Sequence) => c.picks.reduce((a, i) => a | slots[i].spill, 0);
  const first = (c: Sequence) => c.picks[0];
  const last = (c: Sequence) => c.picks[c.picks.length - 1];
  type Candidate2 = { margin: number; a: Sequence; b: Sequence | null };
  const all: Candidate2[] = oneYear.map((a) => ({ margin: a.margin, a, b: null }));
  const paired = oneYear.slice(0, PAIRED);
  let twoYearCount = 0;
  for (let i = 0; i < paired.length; i++)
    for (let j = i + 1; j < paired.length; j++) {
      const a = paired[i];
      const b = paired[j];
      if (spill(a) & own12(b) || spill(b) & own12(a)) continue;
      if (pest(last(a)) === pest(first(b)) || pest(last(b)) === pest(first(a))) continue;
      twoYearCount++;
      all.push({ margin: (a.margin + b.margin) / 2, a, b });
    }
  const key2 = (c: Candidate2) => sig(c.a) + (c.b ? ` | ${sig(c.b)}` : '');
  all.sort((x, y) => y.margin - x.margin || key2(x).localeCompare(key2(y)));

  const riskCapped = input.priorities.includes('risk');
  const rejected = { soil: 0, water: 0, risk: 0 };
  const noEconomics = listCrops()
    .filter((c) => c.lifeSpan === 'annual' && c.category !== 'cover' && c.rotation && !(input.groundTruth.avoidCropIds ?? []).includes(c.id) && !slots.some((slot) => slot.crop.id === c.id) && ctx.best(c.id).s >= CASH_MIN_SCORE)
    .map((c) => c.id);
  const toPlans = (c: Sequence, year: number) => c.picks.map((i): Plan => ({ cropId: slots[i].crop.id, start: slots[i].start, len: slots[i].len, year, share: 1 }));
  const currentYears = Math.max(1, ...currentPlans.map((p) => p.year + 1));
  const currentKeys = new Set(Array.from({ length: currentYears }, (_, shift) => planKey(currentPlans, currentYears, shift)));
  let currentIsBest = false;
  let failed = 0;
  for (const c of all) {
    if (failed >= MAX_CHECKED) break;
    const years = c.b ? 2 : 1;
    const plans = [...toPlans(c.a, 0), ...(c.b ? toPlans(c.b, 1) : [])];
    if (years === currentYears && currentKeys.has(planKey(plans, years))) {
      // What the grower already does, met before any sequence that passes: nothing that passes earns more.
      currentIsBest = true;
      continue;
    }
    const ok = meetsConstraints(evaluate(ctx, { kind: 'income', plans, years, why: [] }, current, 'income'), current, riskCapped);
    if (ok.soil && ok.water && ok.risk)
      return { plans, years, examined: { oneYear: oneYearCount, twoYear: twoYearCount }, rank: failed + 1 + (currentIsBest ? 1 : 0), marginUsdPerHaYr: c.margin / area, bestMarginUsdPerHaYr: all[0].margin / area, rejected, riskCapped, currentIsBest, noEconomics };
    failed++;
    if (!ok.soil) rejected.soil++;
    if (!ok.water) rejected.water++;
    if (!ok.risk) rejected.risk++;
  }
  return null;
}

/** In words: how the sequence was chosen, what was set aside, and what could not be compared. */
function profitWhy(found: ProfitSearch): I18nText[] {
  // Thousands are grouped as each language writes them: 1,278 and 1.278.
  const num = (v: number, lang: 'en' | 'vi') => Math.round(v).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');
  const names = (ids: string[], lang: 'en' | 'vi') => ids.map((id) => cropText(id)[lang]).join(', ');
  const why: I18nText[] = [
    tx(
      `The highest expected margin among ${num(found.examined.oneYear, 'en')} one-year sequences and ${num(found.examined.twoYear, 'en')} two-year alternations of crops that suit this field and have a reference price and cost here. Every one was compared; none was drawn at random.`,
      `Lãi kỳ vọng cao nhất trong ${num(found.examined.oneYear, 'vi')} chuỗi cây trồng một năm và ${num(found.examined.twoYear, 'vi')} cách xen hai năm của các cây phù hợp với thửa ruộng và có giá, chi phí tham chiếu tại đây. Mọi phương án đều được so sánh, không chọn ngẫu nhiên.`,
    ),
    tx(
      `It keeps the soil-health index and the water fit at least at the level of what you do now${found.riskCapped ? ', and the risk score no higher, because low risk is among your priorities' : ''}.`,
      `Phương án giữ chỉ số sức khỏe đất và mức đáp ứng nước không thấp hơn cách làm hiện tại${found.riskCapped ? ', và điểm rủi ro không cao hơn, vì ít rủi ro nằm trong ưu tiên của bạn' : ''}.`,
    ),
  ];
  if (found.currentIsBest) {
    why.push(
      tx(
        'Under these conditions nothing compared earns more than what you do now: this is the next best sequence, shown for comparison.',
        'Với các điều kiện này, không phương án nào được so sánh có lãi cao hơn cách bạn đang làm: đây là phương án tốt kế tiếp, đưa ra để so sánh.',
      ),
    );
  }
  const failed = found.rank - 1 - (found.currentIsBest ? 1 : 0);
  if (failed > 0) {
    const gap = found.bestMarginUsdPerHaYr - found.marginUsdPerHaYr;
    why.push(
      tx(
        `${failed} sequences with a higher margin were set aside (soil health: ${found.rejected.soil}, water fit: ${found.rejected.water}${found.riskCapped ? `, risk: ${found.rejected.risk}` : ''}). The best of them would earn ${num(gap, 'en')} USD per hectare and year more.`,
        `${failed} phương án có lãi cao hơn đã bị loại (sức khỏe đất: ${found.rejected.soil}, đáp ứng nước: ${found.rejected.water}${found.riskCapped ? `, rủi ro: ${found.rejected.risk}` : ''}). Phương án tốt nhất trong số đó lãi hơn ${num(gap, 'vi')} USD mỗi hecta mỗi năm.`,
      ),
    );
  }
  if (found.noEconomics.length) {
    why.push(
      tx(
        `Not compared, because no reference price or cost is known for this region: ${names(found.noEconomics, 'en')}. No figure of another region was used in their place.`,
        `Không được so sánh vì chưa có giá hoặc chi phí tham chiếu cho vùng này: ${names(found.noEconomics, 'vi')}. Không dùng số liệu của vùng khác để thay thế.`,
      ),
    );
  }
  return why;
}

export interface Candidate {
  kind: RotationKind;
  plans: Plan[];
  years: number;
  why: I18nText[];
}

function annualCandidates(ctx: Ctx, cur: Plan[], curYears: number, current: Evaluated): Candidate[] {
  const out: Candidate[] = [];
  const main = getCrop(cur[0]?.cropId) ?? getCrop(bestOverall(ctx))!;
  const mainPlan: Plan = cur.find((p) => p.cropId === main.id) ?? mkSeason(ctx, main.id, 0);
  const anchor = { ...mainPlan, year: 0, share: 1 };
  const cash = pool(ctx, 'cash');
  const mn = cropText(main.id);

  // Soil health: keep the main crop, add legumes and covers, and a legume year when the main crop fixes no N.
  {
    let plans = fill(ctx, [anchor], 0, soilChooser);
    let years = 1;
    if (!main.rotation?.nitrogenFixing) {
      const leg = bestBy(ctx, cash, (c, s) => (c.rotation!.nitrogenFixing ? s : -1), 50, [main.id]);
      if (leg && leg.rotation!.nitrogenFixing) {
        plans = fill(ctx, [...plans, { ...mkSeason(ctx, leg.id, 1), forN: true }], 1, soilChooser);
        years = 2;
      }
    }
    out.push({ kind: 'soil-health', plans, years, why: [tx(`Keeps ${mn.en} as the main crop and fills the gaps with legumes or cover crops that fix nitrogen, protect the soil and break pest cycles.`, `Giữ ${mn.vi} làm cây chính và lấp khoảng trống bằng cây họ đậu hoặc cây che phủ để cố định đạm, bảo vệ đất và cắt vòng sâu bệnh.`)] });
  }
  // Water saver: the crop with the best fit per millimetre, at most one extra low-water season.
  {
    const wc = waterChooser(ctx);
    const a = bestBy(ctx, [main, ...cash], (c, s, m) => (c.rotation!.waterUse === 'high' && c.id !== main.id ? -Infinity : s / 100 - etcMm(ctx, c, m, windowMonths(c)) / 500), 55) ?? main;
    const plans = fill(ctx, [a.id === main.id ? anchor : mkSeason(ctx, a.id, 0)], 0, wc, { maxAdd: 1 });
    const an = cropText(a.id);
    out.push({ kind: 'water-saver', plans, years: 1, why: [tx(`Built around ${an.en}, the suitable crop with the lowest modelled water demand for its fit here, with at most one more season of a crop that is not a heavy water user; the remaining months stay fallow instead of carrying another thirsty crop.`, `Xây dựng quanh ${an.vi}, cây thích hợp có nhu cầu nước mô hình thấp nhất so với mức phù hợp ở đây, thêm tối đa một vụ cây không tốn nhiều nước; các tháng còn lại để đất nghỉ thay vì trồng thêm cây tốn nước.`)] });
  }
  // Income: the sequence with the highest expected margin under the constraints (profitSearch). Where the search
  // finds none: the highest reference margin per season, then the best-paying crop for the remaining months.
  const found = profitSearch(ctx, current, cur);
  if (found) out.push({ kind: 'income', plans: found.plans, years: found.years, why: profitWhy(found) });
  else {
    const a = bestBy(ctx, cash, (c, s) => marginOf(ctx, c.id, s), 55) ?? main;
    const plans = fill(ctx, [a.id === main.id ? anchor : mkSeason(ctx, a.id, 0)], 0, incomeChooser(ctx), { allowCover: false });
    const an = cropText(a.id);
    const borrowed = economicRegions(ctx.input.parcel).length === 0;
    out.push({ kind: 'income', plans, years: 1, why: [tx(`${an.en} has the highest reference margin per season among the crops that fit this field; the remaining months go to the next best-paying crop that fits the calendar.`, `${an.vi} có lãi tham chiếu mỗi vụ cao nhất trong các cây phù hợp với thửa ruộng; các tháng còn lại dành cho cây có lãi cao tiếp theo phù hợp lịch thời vụ.`), ...(borrowed ? [tx('No reference price or cost is known for the country of this field. The margins here use figures of another region, named in the sources, and show an order of magnitude only.', 'Chưa có giá và chi phí tham chiếu cho nước của thửa ruộng này. Các con số lãi ở đây dùng số liệu của vùng khác, có ghi trong phần nguồn, và chỉ cho biết cỡ lớn.')] : [])] });
  }
  // Resilience: three years, three families, reliable crops first.
  {
    const rel = (c: CropProfile, s: number, m: number) => (s / 100) * (ctx.fit(c.id).rel[m - 1] ?? 0.5);
    const fams = new Set([main.rotation?.family]);
    const y1 = bestBy(ctx, cash, (c, s, m) => (fams.has(c.rotation!.family) ? -1 : rel(c, s, m) + (c.rotation!.nitrogenFixing ? 0.3 : 0)), 50, [main.id]);
    if (y1) fams.add(y1.rotation!.family);
    const y2 = bestBy(ctx, cash, (c, s, m) => (fams.has(c.rotation!.family) ? -1 : rel(c, s, m)), 50, [main.id, y1?.id ?? '']);
    let plans = fill(ctx, [anchor], 0, (c, m, s) => (s / 100) * (ctx.fit(c.id).rel[m - 1] ?? 0.5) + (c.category === 'cover' ? 0.2 : 0), { maxAdd: 1 });
    let years = 1;
    if (y1) (plans = fill(ctx, [...plans, mkSeason(ctx, y1.id, 1)], 1, soilChooser, { maxAdd: 1 })), (years = 2);
    if (y1 && y2) (plans = [...plans, mkSeason(ctx, y2.id, 2)]), (years = 3);
    out.push({ kind: 'resilience', plans, years, why: [tx(`Spreads risk across ${years} years and ${new Set(plans.map((p) => getCrop(p.cropId)?.rotation?.family)).size} plant families, favouring crops that met their needs in most of the analysed years.`, `Phân tán rủi ro qua ${years} năm và ${new Set(plans.map((p) => getCrop(p.cropId)?.rotation?.family)).size} họ cây, ưu tiên cây đáp ứng nhu cầu trong phần lớn số năm phân tích.`)] });
  }
  void curYears;
  return out;
}

function perennialCandidates(ctx: Ctx, main: CropProfile): Candidate[] {
  const out: Candidate[] = [];
  const mn = cropText(main.id);
  const covers = listCrops().filter((c) => c.category === 'cover' && c.rotation?.nitrogenFixing && !(ctx.input.groundTruth.avoidCropIds ?? []).includes(c.id));
  const cover = bestBy(ctx, covers, (c, s) => s + (c.lifeSpan === 'perennial' ? 40 : 0) + COV[c.rotation!.coverValue] * 10, 30);
  const stand = (share = 1): Plan => ({ cropId: main.id, start: 1, len: 12, year: 0, share });
  if (isTree(main)) {
    const inter = (p: Plan[]) => (cover ? [...p, { ...mkSeason(ctx, cover.id, 0, 'inter-row', 0.25), ...(cover.lifeSpan === 'perennial' ? { start: 1, len: 12 } : {}) }] : p);
    out.push({ kind: 'soil-health', plans: inter([stand()]), years: 1, why: [tx(`${mn.en} is a perennial stand and is not rotated year to year. The agronomically real change is a nitrogen-fixing cover between the rows${cover ? ` (${cropText(cover.id).en})` : ''} to protect the soil and feed it.`, `${mn.vi} là cây lâu năm, không luân canh hằng năm. Thay đổi thực tế là trồng cây họ đậu che phủ giữa hàng${cover ? ` (${cropText(cover.id).vi})` : ''} để bảo vệ và nuôi đất.`)] });
    const trees = pool(ctx, 'tree').filter((c) => c.id !== main.id && c.rotation!.pestGroup !== main.rotation?.pestGroup);
    const comp = bestBy(ctx, trees, (c, s) => marginOf(ctx, c.id, s), 55);
    if (comp) out.push({ kind: 'income', plans: [stand(0.8), mkSeason(ctx, comp.id, 0, 'companion', 0.2)], years: 1, why: [tx(`Adds ${cropText(comp.id).en} as a companion crop on about a fifth of the block: it fits this site and has a higher reference margin per hectare, while ${mn.en} stays the main crop.`, `Trồng xen ${cropText(comp.id).vi} trên khoảng một phần năm lô: cây phù hợp với nơi này và có lãi tham chiếu mỗi hecta cao hơn, ${mn.vi} vẫn là cây chính.`)] });
    const low = bestBy(ctx, [...trees, ...pool(ctx, 'cash')], (c, s, m) => (c.rotation!.waterUse === 'high' ? -Infinity : s / 100 - etcMm(ctx, c, c.lifeSpan === 'annual' ? m : 1, c.lifeSpan === 'annual' ? windowMonths(c) : 12) / 1500), 55);
    if (low) out.push({ kind: 'water-saver', plans: [stand(0.7), mkSeason(ctx, low.id, 0, 'converted', 0.3)], years: 1, why: [tx(`Partial conversion: about 30 % of the block moves to ${cropText(low.id).en}, which needs less water, so the dry-season irrigation demand of ${mn.en} falls.`, `Chuyển đổi một phần: khoảng 30 % lô chuyển sang ${cropText(low.id).vi}, cây cần ít nước hơn, giảm nhu cầu tưới mùa khô của ${mn.vi}.`)] });
    const res = [stand(0.6), ...(comp ? [mkSeason(ctx, comp.id, 0, 'companion', 0.2)] : []), ...(low && low.id !== comp?.id ? [mkSeason(ctx, low.id, 0, 'converted', 0.2)] : [])];
    out.push({ kind: 'resilience', plans: inter(res), years: 1, why: [tx(`A diversified block: ${mn.en} with companion crops and an inter-row cover, so one price slump, pest or dry year does not hit the whole income.`, `Lô đa dạng: ${mn.vi} với cây trồng xen và cây che phủ giữa hàng, để một đợt giá xuống, sâu bệnh hay năm hạn không ảnh hưởng toàn bộ thu nhập.`)] });
    return out;
  }
  // Stands that are renewed (forage legumes, sugarcane): years of stand, then annual break crops.
  const life = main.category === 'forage' ? 4 : 4;
  const standYears = (n: number): Plan[] => Array.from({ length: n }, (_, y) => ({ ...stand(), year: y }));
  const cash = pool(ctx, 'cash').filter((c) => c.rotation!.family !== main.rotation?.family);
  // Paddy rice needs flooded basins, so it is never proposed as a break crop on an upland stand.
  const pickCash = (v: (c: CropProfile, s: number, m: number) => number) => bestBy(ctx, cash, v, 40, ['oryza-sativa']) ?? bestBy(ctx, cash, v, 20, ['oryza-sativa']);
  const brk = pickCash((c, s) => s / 100 + (c.rotation!.family === 'Poaceae' ? 0.3 : 0));
  if (brk) {
    out.push({ kind: 'soil-health', plans: fill(ctx, [...standYears(life), mkSeason(ctx, brk.id, life, 'break')], life, soilChooser, { maxAdd: 1 }), years: life + 1, why: [tx(`${mn.en} is a multi-year stand, not a yearly crop. Renewing it after ${life} years with a break crop (${cropText(brk.id).en}) uses the nitrogen the stand left behind and breaks its disease and pest cycle before re-seeding.`, `${mn.vi} là cây nhiều năm, không trồng theo năm. Trồng lại sau ${life} năm với cây cắt vòng (${cropText(brk.id).vi}) tận dụng đạm để lại và cắt vòng sâu bệnh trước khi gieo lại.`)] });
  } else {
    out.push({
      kind: 'soil-health',
      plans: standYears(life),
      years: life + 1,
      why: [
        tx(
          `${mn.en} is a multi-year stand, and no annual break crop from another plant family reaches 20/100 on this soil without a field test. Resting the field for one year after ${life} years breaks autotoxicity and root pests before re-seeding, and cuts average annual water use by a fifth.`,
          `${mn.vi} là cây nhiều năm, và chưa có cây cắt vòng họ khác nào đạt 20/100 trên nền đất này khi chưa xét nghiệm đất tại ruộng. Cho đất nghỉ một năm sau ${life} năm giúp giải độc tự thân và cắt vòng sâu bệnh rễ trước khi gieo lại, đồng thời giảm một phần năm lượng nước dùng trung bình năm.`,
        ),
      ],
    });
  }
  const dry = pickCash((c, s, m) => (c.rotation!.waterUse === 'high' ? -Infinity : s / 100 - etcMm(ctx, c, m, windowMonths(c)) / 500));
  if (dry) out.push({ kind: 'water-saver', plans: [...standYears(life - 1), mkSeason(ctx, dry.id, life - 1, 'break'), mkSeason(ctx, dry.id, life, 'break')], years: life + 1, why: [tx(`Shortens the stand to ${life - 1} years and grows ${cropText(dry.id).en} for two years: a short-season crop that needs far less water than a full ${mn.en} season.`, `Rút ngắn chu kỳ còn ${life - 1} năm và trồng ${cropText(dry.id).vi} trong hai năm: cây ngắn ngày cần ít nước hơn nhiều so với một năm ${mn.vi}.`)] });
  const inc = pickCash((c, s) => marginOf(ctx, c.id, s));
  if (inc) out.push({ kind: 'income', plans: fill(ctx, [...standYears(life), mkSeason(ctx, inc.id, life, 'break')], life, incomeChooser(ctx), { maxAdd: 1, allowCover: false }), years: life + 1, why: [tx(`Renews the stand after ${life} years with ${cropText(inc.id).en}, the break crop with the best reference margin here.`, `Trồng lại sau ${life} năm với ${cropText(inc.id).vi}, cây cắt vòng có lãi tham chiếu tốt nhất ở đây.`)] });
  const fams = new Set([main.rotation?.family, brk?.rotation?.family]);
  const third = pickCash((c, s) => (fams.has(c.rotation!.family) ? -1 : s));
  // The text says what the plan really holds: years no break crop could fill stay fallow and are named as such.
  const resilienceWhy =
    brk && third
      ? tx(`Two different break crops between stands spread market and weather risk over more plant families.`, `Hai cây cắt vòng khác nhau giữa các chu kỳ giúp phân tán rủi ro thị trường và thời tiết qua nhiều họ cây hơn.`)
      : brk
        ? tx(`One break crop (${cropText(brk.id).en}) and a rest year between stands: no second crop from another plant family fits this field well enough.`, `Một cây cắt vòng (${cropText(brk.id).vi}) và một năm để đất nghỉ giữa các chu kỳ: không có cây thứ hai thuộc họ khác đủ phù hợp với thửa ruộng này.`)
        : tx(
            `No annual cash crop from another plant family reaches a fit of 20/100 on this field, so the ${life - 1}-year stand is followed by two rest years before re-seeding: that breaks the stand's pest and disease cycle but earns nothing in those years.`,
            `Không có cây hằng năm khác họ nào đạt mức phù hợp 20/100 trên thửa ruộng này, nên sau ${life - 1} năm cây đứng là hai năm để đất nghỉ trước khi gieo lại: cắt được vòng sâu bệnh nhưng không có thu trong các năm đó.`,
          );
  out.push({ kind: 'resilience', plans: [...standYears(life - 1), ...(brk ? [mkSeason(ctx, brk.id, life - 1, 'break')] : []), ...(third ? [mkSeason(ctx, third.id, life, 'break')] : [])], years: life + 1, why: [resilienceWhy] });
  return out;
}

// ------------------------------------------------------------------------------------------------
// Metrics, economics, lists
// ------------------------------------------------------------------------------------------------

const N_CREDIT = (c: CropProfile): number => (!c.rotation?.nitrogenFixing ? 0 : c.category === 'cover' ? 90 : c.category === 'forage' ? 150 : 40);

export interface Evaluated extends Omit<RotationStrategy, 'score'> {
  costPerYear: number;
}

export function evaluate(ctx: Ctx, cand: Candidate, cur: Evaluated | null, id: string): Evaluated {
  const { input } = ctx;
  const t = input.telemetry;
  const area = input.parcel.areaHa;
  const n = climateNormals(t);
  const plans = cand.plans;
  const crops = plans.map((p) => getCrop(p.cropId)!);
  let sW = 0;
  let sSum = 0;
  let relSum = 0;
  let water = 0;
  let need = 0;
  let supply = 0;
  let nitrogen = 0;
  const seasons: SeasonEconomics[] = [];
  const noEcon = new Set<string>();
  const details: RotationSeasonDetail[] = [];
  const historyYears = t.climateHistory?.length ?? 0;
  const seq = plans.filter((p) => p.share === 1).sort((a, b) => a.year - b.year || a.start - b.start);
  plans.forEach((p, i) => {
    const c = crops[i];
    const f = ctx.fit(p.cropId);
    const s = c.lifeSpan === 'annual' ? f.s[p.start - 1] : Math.max(...f.s);
    const rel = c.lifeSpan === 'annual' ? f.rel[p.start - 1] : f.rel[ctx.best(p.cropId).month - 1];
    const w = p.len * p.share;
    sW += w;
    sSum += s * w;
    relSum += (rel ?? 0.5) * w;
    const etcHa = etcMm(ctx, c, p.start, p.len);
    const etc = etcHa * p.share;
    water += etc;
    need += etc;
    const rain = n ? monthsFrom(p.start, p.len).reduce((a, m) => a + n[m - 1].rainMm, 0) * 0.8 * p.share : 0;
    const irr = ctx.irrigation === 'full' ? etc : ctx.irrigation === 'supplemental' ? 0.3 * etc : 0;
    const reliab = input.groundTruth.waterReliability === 'often-short' ? 0.5 : input.groundTruth.waterReliability === 'dry-season-short' ? 0.75 : 1;
    supply += Math.min(etc, rain + irr * reliab);
    nitrogen += N_CREDIT(c) * p.share;
    // The grower's numbers describe the crop they grow, so they apply to the seasons of that crop only.
    const own = p.cropId === input.cropId ? ownEconomics(input.groundTruth) : undefined;
    const e = seasonEconomics({ cropId: p.cropId, areaHa: area * p.share, yieldFraction: s / 100, reference: referenceEconomics(p.cropId, input.parcel), own });
    if (e) seasons.push(e);
    else noEcon.add(p.cropId);
    // The next crop in the sequence that is harvested (covers skipped): the one a legume's nitrogen is left for.
    const si = seq.indexOf(p);
    const follower = si < 0 ? undefined : Array.from({ length: seq.length - 1 }, (_, k) => seq[(si + 1 + k) % seq.length]).find((q) => getCrop(q.cropId)?.category !== 'cover');
    details.push(
      cropSeasonDetail(
        {
          crop: c,
          start: p.start,
          len: p.len,
          share: p.share,
          interRow: p.role === 'inter-row',
          forNitrogen: !!p.forN,
          suitability: f.known ? s : null,
          reliability: rel,
          bestMonth: c.lifeSpan === 'annual' && ctx.best(p.cropId).month === p.start,
          // The metric falls back to an assumed ET0 or Kc when one is missing; the per-season figure is given only when both are on record.
          etcMm: n && c.water && sumNormal(ctx.normals, p.start, p.len, 'et0Mm') != null ? etcHa : null,
          econ: e,
          nitrogenKgHa: N_CREDIT(c),
          irrigation: ctx.irrigation,
          ...(follower && follower.cropId !== p.cropId ? { next: cropText(follower.cropId) } : {}),
          ...(p.role === 'inter-row' && plans[0] !== p ? { host: cropText(plans[0].cropId) } : {}),
        },
        ctx.normals,
        historyYears,
      ),
    );
  });
  const years = cand.years;
  const economics = strategyEconomics(seasons, years, area);
  const inYear = (p: Plan, y: number) => p.year === y || (p.len === 12 && plans.every((q) => q.year === 0));
  const covered = Array.from({ length: years }, (_, y) => {
    const ms = new Set<number>();
    for (const p of plans) if (inYear(p, y)) monthsFrom(p.start, p.len).forEach((m) => ms.add(m));
    return ms;
  });
  const coverFrac = covered.reduce((a, ms) => a + ms.size / 12, 0) / Math.max(1, years);
  // The crop a fallow gap is compared with: the longest full-area season of that year.
  const mainOf = (y: number) => getCrop((plans.filter((p) => p.share === 1 && inYear(p, y)).sort((a, b) => b.len - a.len)[0] ?? plans[0])?.cropId);
  const families = new Set(crops.map((c) => c.rotation?.family ?? c.id));
  let pest = 0;
  if (seq.length >= 2 && plans.every((p) => p.share === 1)) {
    let sum = 0;
    for (let i = 0; i < seq.length; i++) {
      const a = getCrop(seq[i].cropId)!.rotation;
      const b = getCrop(seq[(i + 1) % seq.length].cropId)!.rotation;
      sum += !a || !b ? 0.5 : a.pestGroup === b.pestGroup ? 0 : a.family === b.family ? 0.5 : 1;
    }
    pest = (100 * sum) / seq.length;
  } else pest = Math.min(60, 20 * (new Set(crops.map((c) => c.rotation?.pestGroup)).size - 1) + (crops.length > 1 ? 20 : 0));
  const residue = crops.reduce((a, c) => a + RES[c.rotation?.residue ?? 'medium'], 0) / crops.length;
  const nYr = nitrogen / years;
  const soilHealth = 30 * coverFrac + 20 * Math.min(1, nYr / 80) + 20 * residue + 15 * Math.min(1, (families.size - 1) / 2) + 15 * (crops.some((c) => c.category === 'cover' || c.lifeSpan === 'perennial') ? 1 : 0);
  const waterFit = need > 0 ? (100 * supply) / need : 100;
  const relAvg = sW ? relSum / sW : 0.5;
  const risk = 50 * (1 - relAvg) + 25 / families.size + 25 * (1 - waterFit / 100);
  const metrics: RotationStrategy['metrics'] = {
    suitability: r0(sW ? sSum / sW : 0),
    soilHealth: r0(Math.min(100, soilHealth)),
    waterUseMm: r0(water / years),
    waterFit: r0(Math.min(100, waterFit)),
    marginUsdPerHaYr: economics.perHaMarginUsd,
    risk: r0(Math.max(0, Math.min(100, risk))),
    nitrogenKgHaYr: r0(nYr),
    groundCoverPct: r0(100 * coverFrac),
    pestBreak: r0(pest),
  };
  const lists = buildLists(ctx, cand, metrics, crops, cur, noEcon, economics.seasons.some((s) => s.usesReferenceValues));
  return {
    id,
    kind: cand.kind,
    name: NAMES[cand.kind],
    years,
    // Crop seasons in plan order, then one fallow season per uncovered run of months so the calendar can explain the gaps.
    seasons: [
      ...plans.map(
        (p, i): RotationSeason => ({
          cropId: p.cropId,
          label: label(p),
          startMonth: p.start,
          endMonth: wrapMonth(p.start + p.len - 1),
          year: p.year,
          ...(p.share < 1 ? { share: p.share } : {}),
          ...(p.role ? { slotRole: p.role } : {}),
          detail: details[i],
        }),
      ),
      ...fallowSeasons(covered, mainOf, ctx.normals),
    ],
    metrics,
    economics,
    ...lists,
    costPerYear: economics.perYear.costUsd,
  };
}

const NAMES: Record<RotationKind, I18nText> = {
  current: tx('Current practice', 'Cách làm hiện tại'),
  'soil-health': tx('Soil-health rotation', 'Luân canh cải tạo đất'),
  'water-saver': tx('Water-saver rotation', 'Luân canh tiết kiệm nước'),
  income: tx('Income rotation', 'Luân canh tăng thu nhập'),
  resilience: tx('Resilience rotation', 'Luân canh chống chịu rủi ro'),
  custom: tx('Your custom rotation', 'Luân canh bạn tự chỉnh'),
};

function buildLists(ctx: Ctx, cand: Candidate, m: RotationStrategy['metrics'], crops: CropProfile[], cur: Evaluated | null, noEcon: Set<string>, usesRef: boolean) {
  const { input } = ctx;
  const t = input.telemetry;
  const gt = input.groundTruth;
  const climSrc = t.climateSourceId;
  const soilSrc = t.branches.soil?.sources[0];
  const evidence: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const p of cand.plans) {
    if (seen.has(p.cropId)) continue;
    seen.add(p.cropId);
    const c = getCrop(p.cropId)!;
    const f = ctx.fit(p.cropId);
    const mo = c.lifeSpan === 'annual' ? p.start : ctx.best(p.cropId).month;
    const rel = f.rel[mo - 1];
    const yrs = t.climateHistory?.length ?? 0;
    const fitScore = c.lifeSpan === 'annual' ? f.s[mo - 1] : Math.max(...f.s);
    const met = rel != null && yrs ? Math.round(rel * yrs) : null;
    evidence.push({
      label: tx(`Climate and soil fit of ${c.names.en}${c.lifeSpan === 'annual' ? ` sown in ${monthEn(mo)}` : ''}`, `Mức phù hợp khí hậu và đất của ${c.names.vi ?? c.names.en}${c.lifeSpan === 'annual' ? ` gieo ${monthVi(mo)}` : ''}`),
      value: met != null ? tx(`${fitScore}/100, needs met in ~${met} of ${yrs} years`, `${fitScore}/100, đáp ứng nhu cầu trong ~${met}/${yrs} năm`) : `${fitScore}/100`,
      sourceId: climSrc,
      branch: 'agromet',
    });
  }
  const ph = gt.ph ?? factNum(t, 'ph');
  if (ph != null) {
    const src = sourceName(t, soilSrc);
    evidence.push({
      label: tx('Soil pH', 'pH đất'),
      value: gt.ph != null ? tx(`${ph} (your measurement)`, `${ph} (số bạn đo)`) : `${ph} (${src})`,
      sourceId: gt.ph != null ? undefined : soilSrc,
      branch: 'soil',
    });
  }
  const n = climateNormals(t);
  if (n) {
    const rainYr = r0(n.reduce((a, x) => a + x.rainMm, 0));
    evidence.push({
      label: tx('Normal annual rainfall', 'Lượng mưa trung bình năm'),
      value: tx(`${rainYr} mm; modelled crop water use ${m.waterUseMm} mm/yr`, `${rainYr} mm; lượng nước cây dùng mô hình ${m.waterUseMm} mm/năm`),
      sourceId: climSrc,
      branch: 'rainfall',
    });
  }
  if (cand.kind === 'current' && ctx.currentSource === 'crop-history') {
    const histEn = (t.cropHistory ?? []).map((h) => `${h.year} ${h.crop}`).join(', ');
    const histVi = (t.cropHistory ?? []).map((h) => {
      const id = cdlCrop(h.crop);
      return `${h.year} ${id ? cropText(id).vi : h.crop}`;
    }).join(', ');
    evidence.push({ label: tx('Crops recorded on this field', 'Cây trồng ghi nhận trên thửa ruộng'), value: tx(histEn, histVi), sourceId: t.cropHistory?.[0]?.sourceId, branch: 'vegetation' });
  }
  evidence.push({
    label: tx('Margin per hectare and year', 'Lãi mỗi hecta mỗi năm'),
    value: usesRef ? tx(`${m.marginUsdPerHaYr} USD (reference values)`, `${m.marginUsdPerHaYr} USD (giá trị tham chiếu)`) : `${m.marginUsdPerHaYr} USD`,
    sourceId: 'reference-economics',
  });

  const benefits: I18nText[] = [];
  if (!cur) {
    benefits.push(tx('Known system: no new equipment, markets or skills needed.', 'Hệ thống quen thuộc: không cần thiết bị, thị trường hay kỹ năng mới.'));
    if (m.suitability >= 60) benefits.push(tx(`The current crops fit this field well (${m.suitability}/100).`, `Cây hiện tại phù hợp tốt với thửa ruộng (${m.suitability}/100).`));
    if (m.groundCoverPct >= 90) benefits.push(tx('The soil stays covered almost all year.', 'Đất được che phủ gần như quanh năm.'));
    if (m.nitrogenKgHaYr > 0) benefits.push(tx(`Legumes already supply about ${m.nitrogenKgHaYr} kg N/ha a year.`, `Cây họ đậu đã cung cấp khoảng ${m.nitrogenKgHaYr} kg N/ha mỗi năm.`));
  } else {
    const c = cur.metrics;
    if (m.waterUseMm < c.waterUseMm - 20) benefits.push(tx(`About ${c.waterUseMm - m.waterUseMm} mm less crop water use a year than the current practice.`, `Ít hơn khoảng ${c.waterUseMm - m.waterUseMm} mm nước cây sử dụng mỗi năm so với hiện tại.`));
    if (m.nitrogenKgHaYr > c.nitrogenKgHaYr) benefits.push(tx(`About ${m.nitrogenKgHaYr - c.nitrogenKgHaYr} kg N/ha a year more from legumes (indicative), which can lower fertiliser needs.`, `Thêm khoảng ${m.nitrogenKgHaYr - c.nitrogenKgHaYr} kg N/ha mỗi năm từ cây họ đậu (ước lượng), có thể giảm phân bón.`));
    if (m.groundCoverPct > c.groundCoverPct + 5) benefits.push(tx(`Soil covered ${m.groundCoverPct} % of the year instead of ${c.groundCoverPct} %: less erosion and weed pressure.`, `Đất được che phủ ${m.groundCoverPct} % thời gian thay vì ${c.groundCoverPct} %: ít xói mòn và cỏ dại hơn.`));
    if (m.pestBreak > c.pestBreak + 5) benefits.push(tx(`Better pest and disease break (${m.pestBreak}/100 against ${c.pestBreak}/100).`, `Cắt vòng sâu bệnh tốt hơn (${m.pestBreak}/100 so với ${c.pestBreak}/100).`));
    if (m.marginUsdPerHaYr > c.marginUsdPerHaYr + 20) benefits.push(tx(`Reference margin about ${m.marginUsdPerHaYr - c.marginUsdPerHaYr} USD/ha a year higher.`, `Lãi tham chiếu cao hơn khoảng ${m.marginUsdPerHaYr - c.marginUsdPerHaYr} USD/ha mỗi năm.`));
    if (m.risk < c.risk - 3) benefits.push(tx(`Lower overall risk score (${m.risk} against ${c.risk}).`, `Điểm rủi ro tổng thể thấp hơn (${m.risk} so với ${c.risk}).`));
    if (m.soilHealth > c.soilHealth + 3) benefits.push(tx(`Higher soil-health index (${m.soilHealth} against ${c.soilHealth}).`, `Chỉ số sức khỏe đất cao hơn (${m.soilHealth} so với ${c.soilHealth}).`));
    if (!benefits.length) benefits.push(tx('Diversifies the system at a similar overall performance to the current practice.', 'Đa dạng hóa hệ thống với hiệu quả tổng thể tương tự cách làm hiện tại.'));
  }

  const gaps: I18nText[] = [];
  if (gt.ph == null) gaps.push(tx(`No soil test: pH and texture come from ${sourceName(t, soilSrc)}${resolutionM(t, soilSrc) ? ` (${resolutionM(t, soilSrc)} m map)` : ''}, not from this field.`, `Chưa có phân tích đất: pH và sa cấu lấy từ ${sourceName(t, soilSrc)}${resolutionM(t, soilSrc) ? ` (bản đồ ${resolutionM(t, soilSrc)} m)` : ''}, không phải từ thửa ruộng này.`));
  const cr = resolutionM(t, climSrc);
  if (cr && cr >= 1000) gaps.push(tx(`Climate history is a ~${r0(cr / 1000)} km grid average (${sourceName(t, climSrc)}): local frost pockets and rain shadows are not resolved.`, `Lịch sử khí hậu là trung bình ô lưới ~${r0(cr / 1000)} km (${sourceName(t, climSrc)}): điểm sương giá cục bộ và vùng khuất mưa không được thể hiện.`));
  if (usesRef || noEcon.size) gaps.push(tx(`Yields, prices and costs are reference values for the region, not your own figures${noEcon.size ? `; no reference economics for ${[...noEcon].map((id) => cropText(id).en).join(', ')}` : ''}.`, `Năng suất, giá và chi phí là giá trị tham chiếu của vùng, không phải số liệu của bạn${noEcon.size ? `; chưa có số liệu kinh tế tham chiếu cho ${[...noEcon].map((id) => cropText(id).vi).join(', ')}` : ''}.`));
  if (ctx.irrigationInferred) gaps.push(tx('Irrigation was not entered: full irrigation is assumed because the climate is arid and the field is cropped.', 'Chưa nhập thông tin tưới: giả định tưới đủ vì khí hậu khô hạn mà ruộng vẫn canh tác.'));
  else if (!gt.irrigation) gaps.push(tx('Irrigation was not entered: the comparison assumes a rainfed field.', 'Chưa nhập thông tin tưới: so sánh giả định ruộng nhờ nước mưa.'));
  if (cand.kind === 'current' && ctx.currentSource === 'assumed') gaps.push(tx('Your actual rotation is not known: the current practice is assumed from the selected crop and the calendar. Enter it under Ground Truth.', 'Chưa biết luân canh thực tế: cách làm hiện tại được giả định từ cây đã chọn và lịch thời vụ. Hãy nhập ở mục Dữ liệu thực địa.'));
  if (crops.some((c) => c.lifeSpan !== 'annual')) gaps.push(tx('Establishment years of perennial stands (lower yield, extra cost) are not modelled; margins are for a mature stand.', 'Chưa mô hình năm kiến thiết của cây lâu năm (năng suất thấp, thêm chi phí); lãi tính cho vườn/đồng đã ổn định.'));
  if (crops.some((c) => c.category === 'cover')) gaps.push(tx('Cover-crop benefits (nitrogen, soil cover) are indicative literature values, not measured here.', 'Lợi ích cây che phủ (đạm, che phủ đất) là giá trị tham khảo từ tài liệu, không đo tại đây.'));

  const risks: I18nText[] = [];
  const newCrops = crops.filter((c) => !cur || !cur.seasons.some((s) => s.cropId === c.id));
  if (cur && newCrops.length) risks.push(tx(`Market, varieties and seed supply for ${[...new Set(newCrops.map((c) => c.names.en))].join(', ')} must be checked locally before switching.`, `Cần kiểm tra thị trường, giống và nguồn hạt giống của ${[...new Set(newCrops.map((c) => c.names.vi ?? c.names.en))].join(', ')} tại địa phương trước khi chuyển đổi.`));
  const prevPaddy = (cur?.seasons ?? []).some((s) => s.cropId === 'oryza-sativa') || input.cropId === 'oryza-sativa';
  if (prevPaddy && newCrops.some((c) => c.id !== 'oryza-sativa' && c.lifeSpan === 'annual')) risks.push(tx('Upland crops after paddy rice need drained, raised beds; a waterlogged or saline field can lose the crop. A local agronomist should confirm drainage and salinity.', 'Cây màu sau lúa cần lên liếp, thoát nước tốt; ruộng úng hoặc nhiễm mặn có thể mất trắng. Cần cán bộ nông nghiệp địa phương xác nhận thoát nước và độ mặn.'));
  if (crops.some((c) => c.category === 'cover')) risks.push(tx('Cover crops must be sown right after harvest and terminated on time so they do not compete with the next crop; timing needs local review.', 'Cây che phủ phải gieo ngay sau thu hoạch và kết thúc đúng lúc để không cạnh tranh với vụ sau; thời điểm cần chuyên gia địa phương xem xét.'));
  if (n && n.some((x) => x.tMin < 0)) risks.push(tx('Frost dates vary from year to year: sowing and harvest months here are climatological and must be adjusted to the local frost calendar.', 'Ngày sương giá thay đổi theo năm: tháng gieo và thu hoạch ở đây theo khí hậu trung bình, cần điều chỉnh theo lịch sương giá địa phương.'));
  const ec = gt.ecDsM ?? factNum(t, 'ec_dsm');
  if ((ec != null && ec >= 2) || (ph != null && ph >= 8.3)) risks.push(tx(`Soil chemistry is limiting (${ph != null ? `pH ${ph}` : ''}${ec != null ? `, EC ${ec} dS/m` : ''}): crop tolerance must be confirmed with a soil test and a local agronomist.`, `Hóa tính đất là yếu tố giới hạn (${ph != null ? `pH ${ph}` : ''}${ec != null ? `, EC ${ec} dS/m` : ''}): cần phân tích đất và chuyên gia địa phương xác nhận khả năng chịu của cây.`));
  if (crops.some((c) => isTree(c)) && cand.plans.some((p) => p.share < 1)) risks.push(tx('Intercropping changes shade, root competition and labour: spacing and the share of the block need local review.', 'Trồng xen thay đổi độ che bóng, cạnh tranh rễ và lao động: khoảng cách và tỉ lệ diện tích cần chuyên gia địa phương xem xét.'));
  if (m.pestBreak === 0 && crops.every((c) => c.lifeSpan === 'annual')) risks.push(tx('The same crop every season lets soil-borne pests, diseases and weeds build up; monitor them closely.', 'Trồng cùng một cây mọi vụ khiến sâu bệnh và cỏ dại trong đất tích tụ; cần theo dõi chặt chẽ.'));
  if (m.suitability < 40) risks.push(tx(`Low modelled suitability (${m.suitability}/100): do not change practice on this basis alone; verify the limiting factor in the field first.`, `Mức phù hợp mô hình thấp (${m.suitability}/100): không nên thay đổi chỉ dựa trên kết quả này; hãy kiểm tra yếu tố giới hạn ngoài đồng trước.`));
  risks.push(tx('Sowing months and fertiliser plans need confirmation by a local extension officer for the varieties available.', 'Tháng gieo và kế hoạch bón phân cần cán bộ khuyến nông địa phương xác nhận theo giống sẵn có.'));

  const why = [...cand.why];
  if (cand.kind === 'current') why.push(ctx.currentSource === 'ground-truth' ? tx('The rotation you entered under Ground Truth.', 'Luân canh bạn đã nhập ở mục Dữ liệu thực địa.') : ctx.currentSource === 'crop-history' ? tx('Read from the crops recorded on this field by the Cropland Data Layer.', 'Đọc từ cây trồng ghi nhận trên thửa ruộng theo Cropland Data Layer.') : tx('Assumed from the selected crop at its best sowing window.', 'Giả định từ cây đã chọn ở thời vụ tốt nhất.'));
  return { why, evidence, benefits, gaps, risks };
}

// ------------------------------------------------------------------------------------------------
// Entry point (memoised on the identity of telemetry and on the other inputs' values)
// ------------------------------------------------------------------------------------------------

const memo = new WeakMap<object, Map<string, RotationStrategy[]>>();

const PRIORITY_METRIC: Record<FarmerPriority, (e: Evaluated, all: Evaluated[]) => number> = {
  profit: (e, all) => norm(e.metrics.marginUsdPerHaYr, all.map((x) => x.metrics.marginUsdPerHaYr)),
  yield: (e) => e.metrics.suitability / 100,
  water: (e, all) => 0.5 * (e.metrics.waterFit / 100) + 0.5 * (1 - e.metrics.waterUseMm / Math.max(1, ...all.map((x) => x.metrics.waterUseMm))),
  soil: (e) => e.metrics.soilHealth / 100,
  risk: (e) => 1 - e.metrics.risk / 100,
  cost: (e, all) => 1 - e.costPerYear / Math.max(1, ...all.map((x) => x.costPerYear)),
};
function norm(v: number, xs: number[]): number {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return hi - lo < 1 ? 0.5 : (v - lo) / (hi - lo);
}

export function buildRotations(input: ModelInput): RotationStrategy[] {
  const key = JSON.stringify([input.cropId, input.groundTruth, input.priorities, input.parcel.id, input.parcel.areaHa]);
  let m = memo.get(input.telemetry);
  if (!m) memo.set(input.telemetry, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const res = compute(input);
  m.set(key, res);
  return res;
}

export function makeCtx(input: ModelInput): Ctx {
  const irr = effectiveIrrigation(input);
  const cache = new Map<string, { s: number[]; rel: (number | null)[]; known: boolean }>();
  const fit = (id: string) => {
    let f = cache.get(id);
    if (!f) {
      const w = scanSowingWindows({ ...input, cropId: id, groundTruth: { ...input.groundTruth, irrigation: irr.mode, sowingDate: undefined } });
      f = { s: w.length ? w.map((x) => x.score) : new Array(12).fill(0), rel: w.length ? w.map((x) => x.reliability) : new Array(12).fill(null), known: w.length > 0 };
      cache.set(id, f);
    }
    return f;
  };
  const best = (id: string) => {
    const { s, rel } = fit(id);
    let bm = 0;
    for (let i = 1; i < 12; i++) if (s[i] > s[bm] || (s[i] === s[bm] && (rel[i] ?? 0) > (rel[bm] ?? 0))) bm = i;
    return { month: bm + 1, s: s[bm] };
  };
  return { input, irrigation: irr.mode, irrigationInferred: irr.inferred, fit, best, normals: monthlyNormals(input.telemetry.climateHistory), currentSource: 'assumed', main: getCrop(input.cropId) };
}

export function scoreAll(all: Evaluated[], priorities: FarmerPriority[]): RotationStrategy[] {
  const pri = priorities.length ? priorities : (['profit', 'water', 'soil'] as FarmerPriority[]);
  const weights = Object.fromEntries((Object.keys(PRIORITY_METRIC) as FarmerPriority[]).map((k) => [k, 0.5 + (pri.indexOf(k) >= 0 ? 3 - pri.indexOf(k) : 0)])) as Record<FarmerPriority, number>;
  const wSum = Object.values(weights).reduce((a, b) => a + b, 0);
  return all.map(({ costPerYear: _c, ...e }, i) => {
    const s = (Object.keys(weights) as FarmerPriority[]).reduce((a, k) => a + weights[k] * PRIORITY_METRIC[k](all[i], all), 0) / wSum;
    return { ...e, score: r0(100 * Math.max(0, Math.min(1, s))) };
  });
}

/** The search for one field, with the current rotation it is held against. For tests and for the tables of docs/ECONOMICS.md. */
export function profitSearchFor(input: ModelInput): { found: ProfitSearch | null; current: Evaluated; ctx: Ctx } {
  const ctx = makeCtx(input);
  const cur = currentPlans(ctx);
  const plans = cur.plans.length ? cur.plans : [mkSeason(ctx, bestOverall(ctx), 0)];
  const current = evaluate(ctx, { kind: 'current', plans, years: cur.years, why: [] }, null, 'current');
  return { found: profitSearch(ctx, current, plans), current, ctx };
}

function compute(input: ModelInput): RotationStrategy[] {
  const ctx = makeCtx(input);
  const cur = currentPlans(ctx);
  const curMain = getCrop(cur.plans[0]?.cropId) ?? ctx.main;
  const curCand: Candidate = { kind: 'current', plans: cur.plans.length ? cur.plans : [mkSeason(ctx, bestOverall(ctx), 0)], years: cur.years, why: [tx('The reference every alternative is compared with.', 'Mốc để so sánh mọi phương án khác.')] };
  const current = evaluate(ctx, curCand, null, 'current');
  const main = curMain ?? getCrop(curCand.plans[0].cropId)!;
  const cands = main.lifeSpan !== 'annual' ? perennialCandidates(ctx, main) : annualCandidates(ctx, curCand.plans, cur.years, current);
  const sig = (c: { plans?: Plan[]; seasons?: RotationSeason[]; years?: number }) => JSON.stringify([c.years ?? 1, (c.plans ?? c.seasons ?? []).map((p) => ('cropId' in p ? [p.cropId, 'start' in p ? p.start : p.startMonth, p.year] : [])).sort()]);
  const seen = new Set([sig({ plans: curCand.plans, years: curCand.years })]);
  const alts: Evaluated[] = [];
  for (const c of cands) {
    if (!c.plans.length) continue;
    const s = sig({ seasons: c.plans.map((p) => ({ cropId: p.cropId, label: tx(''), startMonth: p.start, endMonth: 0, year: p.year })), years: c.years });
    if (seen.has(s)) continue;
    seen.add(s);
    alts.push(evaluate(ctx, c, current, c.kind));
  }
  // Guarantee two alternatives without overlapping an already occupied month.
  if (alts.length < 2) {
    const kind: RotationKind = alts.some((a) => a.kind === 'soil-health') ? 'resilience' : 'soil-health';
    const withCover = fill(ctx, curCand.plans, 0, soilChooser, { maxAdd: 1 });
    if (withCover.length > curCand.plans.length) {
      alts.push(evaluate(ctx, { kind, plans: withCover, years: curCand.years, why: [tx('Keeps the current crops and protects the soil between seasons with a cover crop.', 'Giữ cây hiện tại và bảo vệ đất giữa các vụ bằng cây che phủ.')] }, current, `${kind}-fallback`));
    } else {
      alts.push(evaluate(ctx, { kind, plans: curCand.plans, years: curCand.years + 1, why: [tx('Adds a fallow rest year after the current cycle to break pest build-up and lower average water demand.', 'Thêm một năm đất nghỉ sau chu kỳ hiện tại để cắt vòng sâu bệnh và giảm nhu cầu nước trung bình.')] }, current, `${kind}-fallback`));
    }
  }
  return scoreAll([current, ...alts], input.priorities);
}

