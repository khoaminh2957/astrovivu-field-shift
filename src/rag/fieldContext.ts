/**
 * Turns the locked parcel + telemetry + score at the cursor date into the compact `FieldContext`
 * handed to the assistant. Pure: no fetch, no clock. Each fact is a string that starts with the
 * value and unit and then says where it comes from, e.g.
 *   `sm_root: "0.21 m³/m³ (SMAP L4, 9 km pixel, 2026-11-10; 9% below normal; confidence medium)"`.
 * The leading number is what `parseFact` reads back for deterministic comparisons.
 */
import type {
  BranchTelemetry,
  FieldContext,
  FieldTelemetry,
  GroundTruth,
  ISODate,
  Parcel,
  ScoreTimeline,
  Series,
  SourceRef,
} from '@/contracts';
import { pick } from '@/contracts';
import { sampleAt, scoreAt } from '@/lib/series';
import { addDays, dayOfYear, diffDays } from '@/lib/time';

export interface FieldContextInput {
  parcel: Parcel;
  telemetry: FieldTelemetry | null;
  score: ScoreTimeline | null;
  cursor: ISODate;
  cropId: string | null;
  groundTruth?: GroundTruth;
}

const KEY_SERIES = ['sm_root', 'sm_surface', 'ndvi', 'evi', 'lst_day', 'esi', 'et', 'et0', 't2m', 't2m_max', 't2m_min', 'rh', 'par', 'wind'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmt(v: number): string {
  const a = Math.abs(v);
  return String(a >= 100 ? Math.round(v) : a >= 10 ? Number(v.toFixed(1)) : Number(v.toFixed(2)));
}

function pixel(src: SourceRef | undefined): string {
  if (!src?.resolutionM) return '';
  return src.resolutionM >= 1000 ? `${fmt(src.resolutionM / 1000)} km pixel` : `${Math.round(src.resolutionM)} m pixel`;
}

function srcLabel(src: SourceRef | undefined, sourceId: string): string {
  const name = src?.name ?? sourceId;
  const bits = [name, pixel(src)].filter(Boolean);
  if (src && src.provenance !== 'observed') bits.push(src.provenance);
  return bits.join(', ');
}

function anomalyText(series: Series, v: number, t: ISODate): string | null {
  if (!series.baseline?.length) return null;
  const d = dayOfYear(t);
  const b = series.baseline.reduce((best, p) => (Math.abs(p.doy - d) < Math.abs(best.doy - d) ? p : best), series.baseline[0]);
  if (!Number.isFinite(b.mean)) return null;
  const band = v < b.p10 ? 'below the 10th percentile' : v > b.p90 ? 'above the 90th percentile' : 'within the normal band';
  const diff = v - b.mean;
  const pct = b.mean === 0 ? Infinity : (diff / Math.abs(b.mean)) * 100;
  // A share of the normal means nothing for a temperature (4 °C against a normal of -0.06 °C is
  // "6750 % above") or for any normal close to zero: those are given as a difference in the unit.
  const asDifference = /°C/.test(series.unit) || Math.abs(pct) >= 300;
  const unit = series.unit ? ` ${series.unit}` : '';
  const how = asDifference
    ? Math.abs(diff) < 0.05
      ? 'about normal'
      : `${fmt(Math.abs(diff))}${unit} ${diff < 0 ? 'below' : 'above'} normal`
    : Math.abs(pct) < 1
      ? 'about normal'
      : `${Math.round(Math.abs(pct))}% ${pct < 0 ? 'below' : 'above'} normal`;
  return `${how} (${band}, normal ${fmt(b.mean)})`;
}

function allSeries(t: FieldTelemetry): Series[] {
  return Object.values(t.branches).flatMap((b: BranchTelemetry) => b.series);
}

function sumWindow(s: Series, end: ISODate, days: number): { total: number; n: number } {
  const start = addDays(end, -days + 1);
  let total = 0;
  let n = 0;
  for (const x of s.samples) if (x.t >= start && x.t <= end && x.v != null) {
    total += x.v;
    n++;
  }
  return { total, n };
}

export function buildFieldContext(input: FieldContextInput): FieldContext {
  const { parcel, telemetry, score, cursor, cropId, groundTruth: gt = {} } = input;
  const facts: Record<string, string> = {};
  const sources = telemetry?.sources ?? {};

  if (telemetry) {
    if (telemetry.mode !== 'live') facts.data_mode = telemetry.mode === 'mock' ? 'simulated telemetry (all sources unreachable or mock mode)' : 'cached demo telemetry';
    const series = allSeries(telemetry);
    for (const key of KEY_SERIES) {
      const s = series.find((x) => x.key === key);
      if (!s) continue;
      const at = sampleAt(s, cursor);
      if (!at.sample || at.sample.v == null) continue;
      const src = sources[s.sourceId];
      const extra: string[] = [];
      const anom = anomalyText(s, at.sample.v, at.sample.t);
      if (anom) extra.push(anom);
      if (at.stale) extra.push(`stale: ${at.ageDays} days old`);
      facts[key] = `${fmt(at.sample.v)} ${s.unit}`.trim() + ` (${srcLabel(src, s.sourceId)}, ${at.sample.t}${extra.length ? `; ${extra.join('; ')}` : ''})`;
    }
    // The observed series first; where it stops short of the cursor (CHIRPS is published weeks
    // late), the reanalysis series. The fact then names that series and says that it stands in
    // for the observed one, and up to which day the observed one goes.
    const rainSeries = ['rain', 'rain_era5'].map((key) => series.find((x) => x.key === key)).filter((x): x is Series => x != null);
    for (const days of [30, 90]) {
      for (const rain of rainSeries) {
        const w = sumWindow(rain, cursor, days);
        if (w.n < days * 0.7) continue;
        const observed = rain === rainSeries[0] ? null : rainSeries[0];
        const last = observed?.samples.filter((x) => x.v != null).at(-1)?.t;
        const standsIn = observed ? `; in place of ${sources[observed.sourceId]?.name ?? observed.sourceId}, the observed series${last ? `, which ends on ${last}` : ''}` : '';
        facts[`rain_${days}d`] = `${fmt(w.total)} mm over the ${days} days to ${cursor} (${srcLabel(sources[rain.sourceId], rain.sourceId)}${standsIn})`;
        break;
      }
    }
    // What the forecast holds from the cursor on: the coldest night, the hottest day, the rain.
    const ahead = (key: string) => {
      const s = series.find((x) => x.key === key);
      const days = (s?.samples ?? []).filter((x): x is { t: ISODate; v: number } => x.t >= cursor && x.v != null);
      return s && days.length ? { days, src: `${srcLabel(sources[s.sourceId], s.sourceId)}, ${days[0].t} to ${days[days.length - 1].t}` } : null;
    };
    const fcMin = ahead('fc_tmin');
    if (fcMin) {
      const low = fcMin.days.reduce((a, b) => (b.v < a.v ? b : a));
      facts.forecast_tmin = `${fmt(low.v)} °C lowest forecast minimum, on ${low.t} (${fcMin.src})`;
    }
    const fcMax = ahead('fc_tmax');
    if (fcMax) {
      const high = fcMax.days.reduce((a, b) => (b.v > a.v ? b : a));
      facts.forecast_tmax = `${fmt(high.v)} °C highest forecast maximum, on ${high.t} (${fcMax.src})`;
    }
    const fcRain = ahead('fc_rain');
    if (fcRain) {
      const wettest = fcRain.days.reduce((a, b) => (b.v > a.v ? b : a));
      facts.forecast_rain = `${fmt(fcRain.days.reduce((a, b) => a + b.v, 0))} mm forecast over ${fcRain.days.length} days, wettest day ${fmt(wettest.v)} mm on ${wettest.t} (${fcRain.src})`;
    }
    for (const b of Object.values(telemetry.branches)) {
      for (const f of b.facts) {
        if (f.value == null) continue;
        const src = sources[f.sourceId];
        // The data layer puts the lowest and the highest point of the parcel into the same pair for the elevation.
        const unc = f.uncertainty ? `; ${f.key === 'elevation_m' ? 'lowest and highest point of the parcel' : '5-95%'}: ${f.uncertainty[0]}-${f.uncertainty[1]}` : '';
        facts[f.key] = `${typeof f.value === 'number' ? fmt(f.value) : f.value}${f.unit ? ` ${f.unit}` : ''} (${srcLabel(src, f.sourceId)}${unc})`;
      }
      const lowConf = b.confidence.level === 'low' ? `low confidence: ${b.confidence.reasons.map((r) => pick(r, 'en')).join('; ')}` : '';
      const notes = (b.notes ?? []).map((n) => pick(n, 'en'));
      if (lowConf || notes.length) facts[`note_${b.id}`] = [lowConf, ...notes].filter(Boolean).join(' | ');
      for (const e of b.events ?? []) {
        if (e.end < cursor || diffDays(e.start, cursor) > 16) continue;
        facts[`risk_${e.kind}_${e.start}`] = `${pick(e.title, 'en')}: ${pick(e.detail, 'en')} (${e.start} to ${e.end}, severity ${e.severity}/3, ${srcLabel(sources[e.sourceId], e.sourceId)})`;
      }
    }
    // Climate normals from the multi-year history: annual and monthly.
    const hist = telemetry.climateHistory ?? [];
    if (hist.length >= 3) {
      const src = telemetry.climateSourceId ? srcLabel(sources[telemetry.climateSourceId], telemetry.climateSourceId) : 'climate history';
      const years = `${hist[0].year}-${hist[hist.length - 1].year}`;
      const monthT: (number | null)[] = [];
      const monthR: (number | null)[] = [];
      for (let m = 1; m <= 12; m++) {
        const ts = hist.map((y) => y.months.find((x) => x.month === m)?.tMean).filter((v): v is number => v != null);
        const rs = hist.map((y) => y.months.find((x) => x.month === m)?.rainMm).filter((v): v is number => v != null);
        monthT.push(ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null);
        monthR.push(rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null);
      }
      const tVals = monthT.filter((v): v is number => v != null);
      if (tVals.length === 12) {
        facts.climate_t_mean = `${fmt(tVals.reduce((a, b) => a + b, 0) / 12)} °C mean annual air temperature (${src}, ${years})`;
        facts.climate_monthly_t = `${monthT.map((v, i) => `${MONTH[i]} ${fmt(v!)}`).join(', ')} °C (monthly means, ${src}, ${years})`;
      }
      const rVals = monthR.filter((v): v is number => v != null);
      if (rVals.length === 12) {
        facts.climate_rain_annual = `${fmt(rVals.reduce((a, b) => a + b, 0))} mm mean annual rainfall (${src}, ${years})`;
        facts.climate_monthly_rain = `${monthR.map((v, i) => `${MONTH[i]} ${fmt(v!)}`).join(', ')} mm (monthly means, ${src}, ${years})`;
      }
    }
  }
  if (parcel.elevationM != null && facts.elevation_m == null) facts.elevation_m = `${Math.round(parcel.elevationM)} m (parcel elevation)`;

  // Ground truth wins: replace the estimate and keep the estimate visible once.
  const override = (key: string, value: string | number | undefined, unit = '') => {
    if (value == null) return;
    const prev = facts[key];
    facts[key] = `${value}${unit ? ` ${unit}` : ''} (measured by the farmer${prev ? `; satellite/model estimate was ${prev}` : ''})`;
  };
  override('ph', gt.ph);
  override('ec_dsm', gt.ecDsM, 'dS/m');
  override('texture_class', gt.texture);
  override('drainage_class', gt.drainage);
  override('depth_cm', gt.soilDepthCm, 'cm');
  if (gt.irrigation) facts.irrigation = `${gt.irrigation} (entered by the farmer${gt.waterSource ? `, source ${gt.waterSource}` : ''}${gt.waterReliability ? `, ${gt.waterReliability}` : ''})`;
  if (gt.sowingDate) facts.sowing_date = `${gt.sowingDate} (entered by the farmer)`;
  if (gt.variety) facts.variety = `${gt.variety} (entered by the farmer)`;
  if (gt.issues?.length) facts.issues = `${gt.issues.join(', ')} (reported by the farmer)`;
  if (gt.lastYieldTHa != null) facts.last_yield = `${gt.lastYieldTHa} t/ha (entered by the farmer)`;

  // Score at the cursor and month by month.
  let limitingFactor: string | undefined;
  let productivity: number | undefined;
  const snap = scoreAt(score, cursor);
  if (score && snap) {
    productivity = Math.round(snap.productivity);
    facts.score_now = `${productivity}/100 productivity on ${snap.t} (condition ${Math.round(snap.condition)}${snap.compatibility != null ? `, compatibility ${Math.round(snap.compatibility)}` : ''}; score confidence ${fmt(snap.confidence)})`;
    const lim = snap.factors.find((f) => f.key === snap.limiting);
    if (lim) {
      limitingFactor = `${pick(lim.label, 'en')} (score ${fmt(lim.score ?? 0)}; actual ${lim.actual ?? 'n/a'}${lim.unit ? ` ${lim.unit}` : ''}; ideal ${lim.ideal})`;
    }
    for (const f of snap.factors) {
      facts[`factor_${f.key}`] = `${f.score == null ? 'missing' : fmt(f.score)} (actual ${f.actual ?? 'n/a'}${f.unit ? ` ${f.unit}` : ''}; ideal ${f.ideal}; ${f.kind}${f.limiting ? '; limiting' : ''})`;
    }
    const s = score.summary;
    if (s.reliability) facts.reliability = `suitable in ${s.reliability.yearsOk} of ${s.reliability.yearsTotal} analysed years`;
    if (s.expectedYieldFraction != null) facts.expected_yield_fraction = `${Math.round(s.expectedYieldFraction * 100)}% of attainable yield`;
    // One snapshot per month (the 15th, or the last before it).
    const seenMonth = new Set<string>();
    for (const x of score.snapshots) {
      const ym = x.t.slice(0, 7);
      if (seenMonth.has(ym) || x.t > cursor) continue;
      const mid = scoreAt(score, `${ym}-15`);
      if (!mid || mid.t.slice(0, 7) !== ym) continue;
      seenMonth.add(ym);
      const l = mid.factors.find((f) => f.key === mid.limiting);
      facts[`score_${ym}`] = `${Math.round(mid.productivity)}/100${l ? `; limiting ${pick(l.label, 'en')} ${fmt(l.score ?? 0)}` : ''}`;
    }
  }

  return {
    parcelName: parcel.name,
    place: parcel.place?.label,
    location: parcel.centroid,
    areaHa: Number(parcel.areaHa.toFixed(2)),
    cropId,
    date: cursor,
    facts,
    limitingFactor,
    productivity,
  };
}

/** Leading number of a fact string ("5.6 (SoilGrids…)" -> 5.6); null when it does not start with one. */
export function parseFact(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^\s*(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Monthly values of a `climate_monthly_*` fact, Jan..Dec. */
export function parseMonthly(s: string | undefined): (number | null)[] | null {
  if (!s) return null;
  const vals = MONTH.map((m) => {
    const r = s.match(new RegExp(`${m} (-?\\d+(?:\\.\\d+)?)`));
    return r ? Number(r[1]) : null;
  });
  return vals.some((v) => v != null) ? vals : null;
}
