/** Small pure helpers shared by the advisory and urban engines. */
import type { BaselinePoint, BranchId, CropProfile, FieldTelemetry, I18nText, ModelInput, Series, StaticFact } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { addDays, dayOfYear } from '@/lib/time';

export { tx };
export const r0 = (v: number) => Math.round(v);
export const r1 = (v: number) => Math.round(v * 10) / 10;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthEn = (m: number) => MONTHS_EN[(((m - 1) % 12) + 12) % 12];
export const monthVi = (m: number) => `tháng ${((((m - 1) % 12) + 12) % 12) + 1}`;
/** Months `start..start+n-1`, wrapped to 1..12. */
export const monthsFrom = (start: number, n: number): number[] => Array.from({ length: n }, (_, i) => ((start - 1 + i) % 12) + 1);
export const wrapMonth = (m: number) => ((((m - 1) % 12) + 12) % 12) + 1;

export function cropText(id: string): I18nText {
  if (id === 'fallow') return tx('Fallow', 'Đất nghỉ');
  const c = getCrop(id);
  return c ? tx(c.names.en, c.names.vi ?? c.names.en) : tx(id);
}

export function findSeries(t: FieldTelemetry, key: string): Series | undefined {
  for (const b of Object.values(t.branches)) {
    const s = b?.series.find((x) => x.key === key);
    if (s && s.samples.some((p) => p.v != null)) return s;
  }
  return undefined;
}

export function findFact(t: FieldTelemetry, key: string): StaticFact | undefined {
  for (const b of Object.values(t.branches)) {
    const f = b?.facts.find((x) => x.key === key);
    if (f && f.value != null) return f;
  }
  return undefined;
}
export const factNum = (t: FieldTelemetry, key: string): number | null => {
  const v = findFact(t, key)?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export const resolutionM = (t: FieldTelemetry, sourceId: string | undefined): number | null => (sourceId ? (t.sources[sourceId]?.resolutionM ?? null) : null);
export const sourceName = (t: FieldTelemetry, sourceId: string | undefined): string => (sourceId ? (t.sources[sourceId]?.name ?? sourceId) : 'unknown source');

/** Baseline point nearest to a day of year (baselines may be sampled every few days). */
export function baselineAt(bl: BaselinePoint[] | undefined, doy: number): BaselinePoint | null {
  if (!bl?.length) return null;
  let best = bl[0];
  let bd = 999;
  for (const p of bl) {
    const d = Math.min(Math.abs(p.doy - doy), 366 - Math.abs(p.doy - doy));
    if (d < bd) (bd = d), (best = p);
  }
  return bd <= 20 ? best : null;
}

/** Daily values over [start, start+n), nulls as NaN; falls back to a second series when the first has a gap. */
export function dailyArray(t: FieldTelemetry, keys: string[], start: string, n: number): Float64Array {
  const out = new Float64Array(n).fill(NaN);
  for (const key of [...keys].reverse()) {
    const s = findSeries(t, key);
    if (!s || s.cadence !== 'daily') continue;
    const idx = new Map(s.samples.map((p) => [p.t, p.v]));
    for (let i = 0; i < n; i++) {
      const v = idx.get(addDays(start, i));
      if (v != null && Number.isFinite(v)) out[i] = v;
    }
  }
  return out;
}

/** Mean monthly climate over all years of `climateHistory` (null fields when absent). */
export interface ClimNormal {
  month: number;
  rainMm: number;
  tMean: number;
  tMin: number;
  tMax: number;
  et0Mm: number;
}
const normalCache = new WeakMap<FieldTelemetry, ClimNormal[] | null>();
export function climateNormals(t: FieldTelemetry): ClimNormal[] | null {
  if (normalCache.has(t)) return normalCache.get(t)!;
  const h = t.climateHistory;
  let out: ClimNormal[] | null = null;
  if (h?.length) {
    out = [];
    for (let m = 1; m <= 12; m++) {
      const rows = h.map((y) => y.months.find((x) => x.month === m)).filter((x) => x != null);
      const avg = (f: (x: (typeof rows)[number]) => number | null | undefined, dflt: number) => {
        const v = rows.map(f).filter((x): x is number => x != null && Number.isFinite(x));
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : dflt;
      };
      const tMean = avg((x) => x!.tMean, NaN);
      out.push({ month: m, rainMm: avg((x) => x!.rainMm, NaN), tMean, tMin: avg((x) => x!.tMin, NaN), tMax: avg((x) => x!.tMax, NaN), et0Mm: avg((x) => x!.et0Mm, Number.isFinite(tMean) ? Math.max(15, 4 * tMean + 20) : 100) });
    }
    if (out.some((m) => !Number.isFinite(m.rainMm) || !Number.isFinite(m.tMean))) out = null;
  }
  normalCache.set(t, out);
  return out;
}

/** Season-average crop coefficient from the FAO-56 stage lengths. */
export function meanKc(c: CropProfile): number {
  const w = c.water;
  if (!w) return 0.85;
  const [a, b, m, d] = w.stages;
  const sum = a + b + m + d || 1;
  return (w.kc.ini * a + ((w.kc.ini + w.kc.mid) / 2) * b + w.kc.mid * m + ((w.kc.mid + w.kc.end) / 2) * d) / sum;
}

export function branchConf(t: FieldTelemetry, ids: BranchId[]): number {
  const s = ids.map((id) => t.branches[id]).filter((b) => b && b.status !== 'unavailable').map((b) => b.confidence.score);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0.2;
}

/** Deterministic 0..1 noise from a string seed (simulated demo history only). */
export function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export const doyOf = dayOfYear;

/** Effective irrigation regime for comparing strategies: the farmer's entry, else inferred from aridity and land-cover history. */
export function effectiveIrrigation(input: ModelInput): { mode: 'rainfed' | 'supplemental' | 'full'; inferred: boolean } {
  const gt = input.groundTruth.irrigation;
  if (gt) return { mode: gt, inferred: false };
  const n = climateNormals(input.telemetry);
  const annual = n ? n.reduce((a, m) => a + m.rainMm, 0) : null;
  const cropped = (input.telemetry.cropHistory ?? []).some((y) => !/grass|pasture|fallow|shrub|barren/i.test(y.crop));
  if (annual != null && annual < 350 && cropped) return { mode: 'full', inferred: true };
  return { mode: 'rainfed', inferred: false };
}
