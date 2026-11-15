/**
 * The living farm: what to draw for a field on a given day, what the three characters say about
 * it, and the trials a grower can run ("the same year, with this changed"). docs/FARM.md.
 *
 * Everything here is read from the telemetry and from the score of the day; nothing is invented.
 * A value that is missing stays null and the scene and the sentence say so. The classes of the sky
 * (`SkyKind`) are a way of drawing the day's readings, not a weather observation of their own.
 */
import type { BaselinePoint, CropProfile, FieldTelemetry, GroundTruth, I18nText, ISODate, ModelInput, RiskEvent, ScoreTimeline, Series, StageId, WhatIfResult } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { computeScoreTimeline, rankCrops, whatIf } from '@/core/scoring';
import { sampleAt, scoreAt } from '@/lib/series';
import { addDays, dayOfYear, diffDays } from '@/lib/time';

// Thresholds of the risk events (src/data/harmonize/risk.ts): the scene shows a day the way the risk branch would flag it.
export const HEAVY_RAIN_MM = 30;
export const WET_DAY_MM = 1;
export const HOT_TMAX_C = 35;
export const FROST_TMIN_C = 2;
/** A day is drawn overcast when its solar radiation is below this share of the brightest days around it. A drawing rule, not a cloud reading. */
export const OVERCAST_PAR_SHARE = 0.65;
/** Days an annual stays in its harvest stage (the scorer's rule: the cycle length plus 14 days). */
export const HARVEST_DAYS = 14;

export type SkyKind = 'clear' | 'cloudy' | 'rain' | 'heavy-rain' | 'hot' | 'frost' | 'unknown';

export interface FarmWeather {
  t: ISODate;
  kind: SkyKind;
  tMaxC: number | null;
  tMinC: number | null;
  rainMm: number | null;
  /** Rain of the seven days ending at `t`; null for a forecast day. */
  rain7Mm: number | null;
  rhPct: number | null;
  windMs: number | null;
  /** True for a day after today: the figures are a forecast. */
  forecast: boolean;
  /** Ids of the sources the figures of this day came from (`FieldTelemetry.sources`). */
  sourceIds: string[];
}

/** How the crop is drawn. */
export type CropLook = 'paddy' | 'cereal' | 'tall-cereal' | 'legume' | 'oilseed' | 'root' | 'leafy' | 'vine' | 'bush' | 'tree' | 'palm' | 'grass' | 'row' | 'none';

export interface FarmCrop {
  cropId: string | null;
  look: CropLook;
  stage: StageId | null;
  stageLabel: I18nText | null;
  /** Progress through the cycle, 0..1 (the scorer's). */
  progress: number;
  /** Height of the plants as drawn, 0..1. */
  growth: number;
  /** Ripening as drawn, 0..1 (the last quarter of the cycle). */
  ripeness: number;
  /** Greenness as drawn, 0..1, from the latest NDVI; null without one. */
  vigor: number | null;
  ndvi: number | null;
  ndviDate: ISODate | null;
  /** NDVI against its usual value for the time of year. */
  ndviVsUsual: 'below' | 'usual' | 'above' | null;
  /** Share of the field already cut, 0..1, while the crop is in its harvest stage; null otherwise. */
  harvested: number | null;
  /** True in the days before sowing and the first days after it. */
  sowing: boolean;
  /** Days until the harvest stage begins; null when not known or not in season. */
  daysToHarvest: number | null;
}

export interface FarmSoil {
  /** Root-zone soil moisture, m3/m3. */
  moisture: number | null;
  /** Against the usual range of the time of year (10th to 90th percentile), else of this year. */
  state: 'dry' | 'usual' | 'wet' | null;
  usual: [lo: number, hi: number] | null;
  ph: number | null;
  /** The grower's own pH, or the soil map's. */
  phFrom: 'grower' | 'map' | null;
  phUncertainty: [lo: number, hi: number] | null;
  /** pH against what the crop takes: [optimum low, optimum high]. */
  phNeed: [lo: number, hi: number] | null;
  phState: 'low' | 'ok' | 'high' | null;
  sourceIds: string[];
}

export interface FarmScene {
  t: ISODate;
  weather: FarmWeather;
  crop: FarmCrop;
  soil: FarmSoil;
  /** Productivity score of the day, 0..100. */
  score: number | null;
  offSeason: boolean;
  limiting: I18nText | null;
}

// ------------------------------------------------------------------------------------------------
// Reading the telemetry
// ------------------------------------------------------------------------------------------------

export function seriesOf(t: FieldTelemetry, key: string): Series | undefined {
  for (const b of Object.values(t.branches)) {
    const s = b.series.find((x) => x.key === key);
    if (s) return s;
  }
  return undefined;
}

/** The reading of the day, or null when the source has nothing recent enough to stand for it. */
function valueAt(t: FieldTelemetry, key: string, day: ISODate): { v: number; sourceId: string; t: ISODate } | null {
  const s = seriesOf(t, key);
  if (!s) return null;
  const at = sampleAt(s, day, t.sources[s.sourceId]?.latencyDays);
  return at.sample?.v != null && !at.stale ? { v: at.sample.v, sourceId: s.sourceId, t: at.sample.t } : null;
}

/** The exact sample of the day in a daily series. */
function exact(t: FieldTelemetry, key: string, day: ISODate): { v: number; sourceId: string } | null {
  const s = seriesOf(t, key);
  const hit = s?.samples.find((x) => x.t === day);
  return s && hit?.v != null ? { v: hit.v, sourceId: s.sourceId } : null;
}

function baselineOf(baseline: BaselinePoint[] | undefined, day: ISODate): BaselinePoint | null {
  if (!baseline?.length) return null;
  const doy = dayOfYear(day);
  let best = baseline[0];
  for (const p of baseline) if (Math.abs(p.doy - doy) < Math.abs(best.doy - doy)) best = p;
  return best;
}

const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const r1 = (v: number): number => Math.round(v * 10) / 10;

export function skyKind(w: Pick<FarmWeather, 'tMaxC' | 'tMinC' | 'rainMm'>, overcast = false): SkyKind {
  if (w.rainMm == null && w.tMaxC == null && w.tMinC == null) return 'unknown';
  if (w.rainMm != null && w.rainMm >= HEAVY_RAIN_MM) return 'heavy-rain';
  if (w.rainMm != null && w.rainMm >= WET_DAY_MM) return 'rain';
  if (w.tMinC != null && w.tMinC <= FROST_TMIN_C) return 'frost';
  if (w.tMaxC != null && w.tMaxC >= HOT_TMAX_C) return 'hot';
  return overcast ? 'cloudy' : 'clear';
}

/** Rain of a day: the gauge-and-satellite product when it has the day, else the reanalysis. */
function rainOf(t: FieldTelemetry, day: ISODate): { v: number; sourceId: string } | null {
  return exact(t, 'rain', day) ?? exact(t, 'rain_era5', day);
}

/** The weather of a day of the record (up to today) or of the forecast (after it). */
export function weatherAt(t: FieldTelemetry, day: ISODate): FarmWeather {
  const sources = new Set<string>();
  const take = (x: { v: number; sourceId: string } | null): number | null => {
    if (!x) return null;
    sources.add(x.sourceId);
    return x.v;
  };
  if (day > t.window.today) {
    const w = { tMaxC: take(exact(t, 'fc_tmax', day)), tMinC: take(exact(t, 'fc_tmin', day)), rainMm: take(exact(t, 'fc_rain', day)) };
    return { t: day, ...w, kind: skyKind(w), rain7Mm: null, rhPct: null, windMs: null, forecast: true, sourceIds: [...sources] };
  }
  const w = { tMaxC: take(valueAt(t, 't2m_max', day)), tMinC: take(valueAt(t, 't2m_min', day)), rainMm: take(rainOf(t, day)) };
  let rain7: number | null = null;
  for (let d = 0; d < 7; d++) {
    const r = rainOf(t, addDays(day, -d));
    if (r) rain7 = (rain7 ?? 0) + r.v;
  }
  // Overcast: the day's radiation against the brightest tenth of the month around it.
  const par = seriesOf(t, 'par');
  const today = par?.samples.find((x) => x.t === day)?.v ?? null;
  const around = par ? par.samples.filter((x) => x.v != null && Math.abs(diffDays(x.t, day)) <= 15).map((x) => x.v as number) : [];
  const overcast = today != null && around.length >= 10 && today < OVERCAST_PAR_SHARE * quantile(around, 0.9);
  if (overcast && par) sources.add(par.sourceId);
  return {
    t: day,
    ...w,
    kind: skyKind(w, overcast),
    rain7Mm: rain7 == null ? null : r1(rain7),
    rhPct: take(valueAt(t, 'rh', day)),
    windMs: take(valueAt(t, 'wind', day)),
    forecast: false,
    sourceIds: [...sources],
  };
}

/** Today and the days of the forecast, in order. */
export function forecastDays(t: FieldTelemetry): FarmWeather[] {
  const end = t.window.forecastEnd;
  const out: FarmWeather[] = [weatherAt(t, t.window.today)];
  if (!end) return out;
  for (let d = addDays(t.window.today, 1); d <= end; d = addDays(d, 1)) {
    const w = weatherAt(t, d);
    if (w.kind !== 'unknown') out.push(w);
  }
  return out;
}

/** The next weather warning that starts on or after `day` (or is under way), within the forecast. */
export function nextRisk(t: FieldTelemetry, day: ISODate): RiskEvent | null {
  const events = (t.branches.risk.events ?? []).filter((e) => e.severity > 0 && e.end >= day).sort((a, b) => a.start.localeCompare(b.start));
  return events[0] ?? null;
}

// ------------------------------------------------------------------------------------------------
// Crop and soil
// ------------------------------------------------------------------------------------------------

/** The silhouette a crop is drawn with: thirteen kinds of plant, chosen from the genus, the category and the life span. */
export function cropLook(crop: CropProfile | null | undefined): CropLook {
  if (!crop) return 'none';
  const perennial = crop.lifeSpan === 'perennial';
  if (crop.id.startsWith('oryza-')) return 'paddy';
  if (/^(cocos|elaeis|musa|areca|phoenix|ananas|carica)-/.test(crop.id)) return 'palm';
  if (/^(piper|vitis|passiflora|humulus|vanilla|actinidia)-/.test(crop.id)) return 'vine';
  if (/^(coffea|camellia|vaccinium|rubus|ribes)-/.test(crop.id)) return 'bush';
  if (/^saccharum-/.test(crop.id)) return 'tall-cereal';
  if (perennial && (crop.category === 'fruit' || crop.category === 'industrial' || crop.category === 'spice' || crop.category === 'oilseed' || crop.category === 'other')) return 'tree';
  if (crop.category === 'cereal') return /^(zea|sorghum|pennisetum)-/.test(crop.id) ? 'tall-cereal' : 'cereal';
  if (crop.category === 'pulse') return 'legume';
  if (crop.category === 'oilseed') return 'oilseed';
  if (crop.category === 'forage' || crop.category === 'cover') return 'grass';
  if (crop.category === 'root') return 'root';
  if (crop.category === 'vegetable' || crop.category === 'herb') return 'leafy';
  return 'row';
}

/** Share of the field cut so far: the days since the crop entered its harvest stage over the length of that stage. */
function harvestedShare(score: ScoreTimeline, day: ISODate): number | null {
  const snaps = score.snapshots;
  let i = snaps.findLastIndex((s) => s.t <= day);
  if (i < 0 || snaps[i].stage?.id !== 'harvest') return null;
  while (i > 0 && snaps[i - 1].stage?.id === 'harvest') i--;
  return clamp01((diffDays(day, snaps[i].t) + 1) / HARVEST_DAYS);
}

function cropAt(input: ModelInput, score: ScoreTimeline, day: ISODate): FarmCrop {
  const crop = getCrop(input.cropId);
  const snap = scoreAt(score, day);
  const stage = crop ? (snap?.stage ?? null) : null;
  const id = stage?.id ?? null;
  const perennial = crop?.lifeSpan === 'perennial';
  const progress = stage?.progress ?? 0;
  const standing = id != null && id !== 'fallow' && id !== 'pre-sowing';
  // An annual is at its full height from mid-season on; a perennial stands the whole year.
  const growth = !crop ? 0 : perennial ? 1 : !standing ? 0 : id === 'initial' || id === 'development' ? Math.min(0.95, 0.12 + progress / 0.5) : 1;
  const ripeness = !standing ? 0 : id === 'harvest' ? 1 : clamp01((progress - 0.75) / 0.25);

  const ndviSeries = seriesOf(input.telemetry, 'ndvi');
  const at = ndviSeries ? sampleAt(ndviSeries, day, input.telemetry.sources[ndviSeries.sourceId]?.latencyDays) : null;
  const ndvi = at?.sample?.v != null && !at.stale ? at.sample.v : null;
  const usual = ndvi != null ? baselineOf(ndviSeries?.baseline, day) : null;

  // Days left to the harvest stage, from the day in the season and the share of the cycle it stands for.
  const len = stage?.dayInSeason != null && progress > 0.02 ? stage.dayInSeason / progress : null;
  const daysToHarvest = !perennial && standing && id !== 'harvest' && len != null && stage?.dayInSeason != null ? Math.max(0, Math.round(len - stage.dayInSeason)) : null;

  return {
    cropId: crop?.id ?? null,
    look: cropLook(crop),
    stage: id,
    stageLabel: stage?.label ?? null,
    progress,
    growth,
    ripeness,
    vigor: ndvi == null ? null : clamp01((ndvi - 0.2) / 0.6),
    ndvi,
    ndviDate: ndvi != null ? (at?.sample?.t ?? null) : null,
    ndviVsUsual: ndvi == null || !usual ? null : ndvi < usual.p10 ? 'below' : ndvi > usual.p90 ? 'above' : 'usual',
    harvested: crop && !perennial ? harvestedShare(score, day) : null,
    sowing: !!crop && !perennial && (id === 'pre-sowing' || (id === 'initial' && progress < 0.06)),
    daysToHarvest,
  };
}

function soilAt(input: ModelInput, day: ISODate): FarmSoil {
  const t = input.telemetry;
  const sources = new Set<string>();
  const sm = seriesOf(t, 'sm_root');
  const reading = valueAt(t, 'sm_root', day);
  if (reading) sources.add(reading.sourceId);
  let usual: [number, number] | null = null;
  const base = baselineOf(sm?.baseline, day);
  if (base) usual = [base.p10, base.p90];
  else if (sm) {
    const all = sm.samples.filter((x) => x.v != null).map((x) => x.v as number);
    if (all.length >= 30) usual = [quantile(all, 0.2), quantile(all, 0.8)];
  }
  const state = !reading || !usual ? null : reading.v < usual[0] ? 'dry' : reading.v > usual[1] ? 'wet' : 'usual';

  const fact = t.branches.soil.facts.find((f) => f.key === 'ph');
  const mapPh = typeof fact?.value === 'number' ? fact.value : null;
  const ph = input.groundTruth.ph ?? mapPh;
  const phFrom = input.groundTruth.ph != null ? 'grower' : mapPh != null ? 'map' : null;
  if (phFrom === 'map' && fact) sources.add(fact.sourceId);
  const req = getCrop(input.cropId)?.req.ph;
  const phNeed: [number, number] | null = req ? [req[1], req[2]] : null;
  return {
    moisture: reading?.v ?? null,
    state,
    usual,
    ph,
    phFrom,
    phUncertainty: phFrom === 'map' ? (fact?.uncertainty ?? null) : null,
    phNeed,
    phState: ph == null || !phNeed ? null : ph < phNeed[0] ? 'low' : ph > phNeed[1] ? 'high' : 'ok',
    sourceIds: [...sources],
  };
}

/**
 * The field on a day. `weatherDay` draws the sky of another day over the same field (a forecast
 * day picked from the strip): the crop and the soil stay those of `day`.
 */
export function farmSceneAt(input: ModelInput, score: ScoreTimeline, day: ISODate, weatherDay: ISODate = day): FarmScene {
  const snap = scoreAt(score, day);
  const limiting = snap?.limiting ? (snap.factors.find((f) => f.key === snap.limiting)?.label ?? null) : null;
  return {
    t: day,
    weather: weatherAt(input.telemetry, weatherDay),
    crop: cropAt(input, score, day),
    soil: soilAt(input, day),
    score: snap ? Math.round(snap.productivity) : null,
    offSeason: !!snap?.offSeason,
    limiting,
  };
}

// ------------------------------------------------------------------------------------------------
// What the three characters say
// ------------------------------------------------------------------------------------------------

export type FarmVoice = 'space' | 'soil' | 'rice';

export interface FarmLine {
  who: FarmVoice;
  /** How the character feels about what it reports: drives its expression. */
  mood: 'calm' | 'glad' | 'worried';
  text: I18nText;
  /** Ids of the sources of the figures in the sentence; empty when it reports that there is none. */
  sourceIds: string[];
}

const n = (v: number, d = 0): string => v.toFixed(d);
const dm = (t: ISODate): string => `${Number(t.slice(8, 10))}/${Number(t.slice(5, 7))}`;

function spaceLine(scene: FarmScene, risk: RiskEvent | null): FarmLine {
  const w = scene.weather;
  if (w.kind === 'unknown') return { who: 'space', mood: 'calm', text: tx('I have no weather reading for this day.', 'Tôi chưa có số liệu thời tiết cho ngày này.'), sourceIds: [] };
  const temp = w.tMaxC != null && w.tMinC != null ? tx(`${n(w.tMaxC)} °C by day, ${n(w.tMinC)} °C at night`, `ban ngày ${n(w.tMaxC)} °C, ban đêm ${n(w.tMinC)} °C`) : null;
  const rain = w.rainMm == null ? null : w.rainMm < WET_DAY_MM ? tx('no rain', 'không mưa') : tx(`${n(w.rainMm, 1)} mm of rain`, `mưa ${n(w.rainMm, 1)} mm`);
  const lead: Record<Exclude<SkyKind, 'unknown'>, I18nText> = {
    'heavy-rain': tx('Heavy rain', 'Mưa lớn'),
    rain: tx('A wet day', 'Ngày có mưa'),
    frost: tx('Frost risk', 'Có nguy cơ sương giá'),
    hot: tx('A hot day', 'Ngày nắng nóng'),
    cloudy: tx('An overcast day', 'Ngày nhiều mây'),
    clear: tx('A clear day', 'Ngày quang đãng'),
  };
  const parts = [temp, rain].filter((x): x is I18nText => !!x);
  const week = w.rain7Mm != null ? tx(` ${n(w.rain7Mm)} mm fell in the last seven days.`, ` Bảy ngày qua mưa ${n(w.rain7Mm)} mm.`) : tx('', '');
  const ahead = risk && !w.forecast ? tx(` Ahead: ${risk.title.en.toLowerCase()} from ${dm(risk.start)}.`, ` Sắp tới: ${risk.title.vi.toLowerCase()} từ ${dm(risk.start)}.`) : tx('', '');
  const head = w.forecast ? tx(`Forecast for ${dm(w.t)}, `, `Dự báo ngày ${dm(w.t)}, `) : tx('', '');
  const k = lead[w.kind];
  return {
    who: 'space',
    mood: w.kind === 'heavy-rain' || w.kind === 'frost' || w.kind === 'hot' ? 'worried' : w.kind === 'clear' ? 'glad' : 'calm',
    text: tx(
      `${head.en}${head.en ? k.en.toLowerCase() : k.en}: ${parts.map((p) => p.en).join(', ')}.${week.en}${ahead.en}`,
      `${head.vi}${head.vi ? k.vi.toLowerCase() : k.vi}: ${parts.map((p) => p.vi).join(', ')}.${week.vi}${ahead.vi}`,
    ),
    sourceIds: [...w.sourceIds, ...(risk && !w.forecast ? [risk.sourceId] : [])],
  };
}

function soilLine(scene: FarmScene, crop: CropProfile | undefined): FarmLine {
  const s = scene.soil;
  const bits: I18nText[] = [];
  if (s.moisture != null) {
    const v = n(s.moisture, 2);
    bits.push(
      s.state === 'dry'
        ? tx(`The root zone is drier than usual for this time of year (${v} m³/m³).`, `Tầng rễ đang khô hơn thường lệ của thời điểm này (${v} m³/m³).`)
        : s.state === 'wet'
          ? tx(`The root zone is wetter than usual for this time of year (${v} m³/m³).`, `Tầng rễ đang ẩm hơn thường lệ của thời điểm này (${v} m³/m³).`)
          : tx(`Root-zone moisture is within its usual range (${v} m³/m³).`, `Độ ẩm tầng rễ nằm trong khoảng thường lệ (${v} m³/m³).`),
    );
  }
  if (s.ph != null) {
    const from = s.phFrom === 'grower' ? tx('your own value', 'số của bạn') : tx('from the soil map, not a sample of this field', 'theo bản đồ đất, không phải mẫu của ruộng này');
    const name = crop ? tx(crop.names.en.toLowerCase(), (crop.names.vi ?? crop.names.en).toLowerCase()) : null;
    const need = s.phNeed && name ? tx(`${name.en} does best at ${s.phNeed[0]} to ${s.phNeed[1]}`, `${name.vi} hợp nhất ở ${s.phNeed[0]} đến ${s.phNeed[1]}`) : null;
    const verdict = !need
      ? tx('', '')
      : s.phState === 'low'
        ? tx(`: too acid, ${need.en}.`, `: hơi chua, ${need.vi}.`)
        : s.phState === 'high'
          ? tx(`: too alkaline, ${need.en}.`, `: hơi kiềm, ${need.vi}.`)
          : tx(`: fine, ${need.en}.`, `: ổn, ${need.vi}.`);
    bits.push(tx(`Soil pH ${n(s.ph, 1)} (${from.en})${verdict.en || '.'}`, `pH đất ${n(s.ph, 1)} (${from.vi})${verdict.vi || '.'}`));
  }
  if (!bits.length) return { who: 'soil', mood: 'calm', text: tx('I have no soil reading for this field yet. A soil test would tell us.', 'Tôi chưa có số liệu đất của ruộng này. Một lần phân tích đất sẽ cho biết.'), sourceIds: [] };
  const worried = s.state === 'dry' || s.phState === 'low' || s.phState === 'high';
  return { who: 'soil', mood: worried ? 'worried' : s.state === 'usual' && s.phState === 'ok' ? 'glad' : 'calm', text: tx(bits.map((b) => b.en).join(' '), bits.map((b) => b.vi).join(' ')), sourceIds: s.sourceIds };
}

function riceLine(scene: FarmScene, crop: CropProfile | undefined, ndviSource: string | undefined): FarmLine {
  const c = scene.crop;
  if (!crop) return { who: 'rice', mood: 'calm', text: tx('No crop is chosen for this field yet. Pick one and I will show how it would grow here.', 'Ruộng này chưa chọn cây trồng. Chọn một cây, tôi sẽ cho thấy nó lớn lên ở đây ra sao.'), sourceIds: [] };
  const name = tx(crop.names.en, crop.names.vi ?? crop.names.en);
  const bits: I18nText[] = [];
  if (c.harvested != null) bits.push(tx(`${name.en}: harvest time, about ${Math.round(c.harvested * 100)} % of the field is cut.`, `${name.vi}: đang thu hoạch, khoảng ${Math.round(c.harvested * 100)} % ruộng đã gặt.`));
  else if (c.stageLabel) {
    const share = c.stage === 'fallow' || c.stage === 'pre-sowing' || c.stage === 'dormant' ? tx('', '') : tx(`, ${Math.round(c.progress * 100)} % of the cycle`, `, ${Math.round(c.progress * 100)} % chu kỳ`);
    bits.push(tx(`${name.en}: ${c.stageLabel.en.toLowerCase()}${share.en}.`, `${name.vi}: ${c.stageLabel.vi.toLowerCase()}${share.vi}.`));
    if (c.daysToHarvest != null && c.daysToHarvest <= 45) bits.push(tx(`About ${c.daysToHarvest} days to harvest.`, `Còn khoảng ${c.daysToHarvest} ngày nữa thu hoạch.`));
  }
  if (c.ndvi != null && c.ndviDate) {
    const vs =
      c.ndviVsUsual === 'below' ? tx(', below its usual level', ', thấp hơn thường lệ') : c.ndviVsUsual === 'above' ? tx(', above its usual level', ', cao hơn thường lệ') : c.ndviVsUsual === 'usual' ? tx(', as usual for the season', ', như thường lệ của mùa') : tx('', '');
    bits.push(tx(`Greenness (NDVI) ${n(c.ndvi, 2)} on ${dm(c.ndviDate)}${vs.en}.`, `Độ xanh (NDVI) ${n(c.ndvi, 2)} ngày ${dm(c.ndviDate)}${vs.vi}.`));
  } else bits.push(tx('No recent satellite image of the canopy.', 'Chưa có ảnh vệ tinh gần đây về tán cây.'));
  return {
    who: 'rice',
    mood: c.ndviVsUsual === 'below' ? 'worried' : c.harvested != null || c.ndviVsUsual === 'above' ? 'glad' : 'calm',
    text: tx(bits.map((b) => b.en).join(' '), bits.map((b) => b.vi).join(' ')),
    sourceIds: c.ndvi != null && ndviSource ? [ndviSource] : [],
  };
}

/** One sentence from each character about the scene. */
export function farmLines(input: ModelInput, scene: FarmScene): Record<FarmVoice, FarmLine> {
  const crop = getCrop(input.cropId);
  return {
    space: spaceLine(scene, nextRisk(input.telemetry, scene.weather.t)),
    soil: soilLine(scene, crop),
    rice: riceLine(scene, crop, seriesOf(input.telemetry, 'ndvi')?.sourceId),
  };
}

// ------------------------------------------------------------------------------------------------
// Trials: the same year, with one thing changed
// ------------------------------------------------------------------------------------------------

export interface FarmChange {
  cropId?: string | null;
  groundTruth?: Partial<GroundTruth>;
}

export interface FarmOption {
  id: string;
  /** The character that proposes it. */
  by: 'soil' | 'rice';
  kind: 'ph' | 'irrigation' | 'drainage' | 'sowing' | 'crop';
  label: I18nText;
  /** Season outcome before and after, as the model's what-if reports it (0..100). */
  before: number;
  after: number;
  delta: number;
  change: FarmChange;
  /** What a grower must know before reading the trial as advice. */
  caveat: I18nText;
}

const CAVEAT: Record<FarmOption['kind'], I18nText> = {
  ph: tx(
    'Lime or sulfur acts over months and the dose depends on a soil test: the trial shows the year as if the soil already had that pH.',
    'Vôi hay lưu huỳnh tác dụng trong nhiều tháng và liều lượng phải theo kết quả phân tích đất: bản thử cho thấy năm đó nếu đất đã ở mức pH ấy.',
  ),
  irrigation: tx('The trial assumes the water is there when the crop needs it; check your source first.', 'Bản thử giả định có đủ nước khi cây cần; hãy kiểm tra nguồn nước trước.'),
  drainage: tx('Drainage works are a field job to plan with someone local; the trial shows the year as if the field already drained well.', 'Làm thoát nước là việc cần bàn với người am hiểu tại chỗ; bản thử cho thấy năm đó nếu ruộng đã thoát nước tốt.'),
  sowing: tx('The trial moves the sowing date and keeps the same year of weather.', 'Bản thử dời ngày gieo và giữ nguyên thời tiết của năm đó.'),
  crop: tx('The trial grows the other crop through the same year of weather; markets and seed are not in it.', 'Bản thử trồng cây kia qua cùng năm thời tiết đó; chưa xét thị trường và giống.'),
};

/** The season outcome a what-if compares: expected share of the attainable yield, else the mean score. */
export function seasonOutcome(score: ScoreTimeline): number {
  const s = score.summary;
  return s.expectedYieldFraction == null ? Math.round(s.productivityMean) : Math.round(100 * s.expectedYieldFraction);
}

/** The model input of a trial. The grower's own entries are copied, never changed. */
export function withChange(input: ModelInput, change: FarmChange): ModelInput {
  return {
    ...input,
    ...(change.cropId !== undefined ? { cropId: change.cropId } : {}),
    groundTruth: { ...input.groundTruth, ...(change.groundTruth ?? {}) },
  };
}

const KIND: Record<string, FarmOption['kind']> = { irrigation: 'irrigation', ph: 'ph', drainage: 'drainage', sowing: 'sowing', crop: 'crop' };

/**
 * What the characters can propose for this field: the model's own what-if moves that raise the
 * season outcome, and the two best other crops of the ranking. Sorted by gain.
 */
export function farmOptions(input: ModelInput, base: ScoreTimeline, moves: WhatIfResult[] = whatIf(input)): FarmOption[] {
  const out: FarmOption[] = [];
  for (const m of moves) {
    const kind = KIND[m.changedFactor];
    if (!kind || !m.apply || m.delta <= 0) continue;
    out.push({
      id: `${kind}-${out.length}`,
      by: kind === 'crop' || kind === 'sowing' ? 'rice' : 'soil',
      kind,
      label: m.label,
      before: m.before,
      after: m.after,
      delta: m.delta,
      change: m.apply,
      caveat: CAVEAT[kind],
    });
  }
  // More crops than the one the what-if tries: the next of the ranking, scored the same way.
  if (input.cropId) {
    const before = seasonOutcome(base);
    const tried = new Set([input.cropId, ...out.filter((o) => o.kind === 'crop').map((o) => o.change.cropId)]);
    for (const r of rankCrops(input, { limit: 5 })) {
      if (tried.has(r.cropId) || out.filter((o) => o.kind === 'crop').length >= 3) continue;
      const crop = getCrop(r.cropId);
      if (!crop) continue;
      const change: FarmChange = { cropId: r.cropId, groundTruth: { sowingDate: undefined } };
      const after = seasonOutcome(computeScoreTimeline(withChange(input, change)));
      if (after <= before) continue;
      out.push({ id: `crop-${r.cropId}`, by: 'rice', kind: 'crop', label: tx(`Switch to ${crop.names.en}`, `Chuyển sang ${crop.names.vi ?? crop.names.en}`), before, after, delta: after - before, change, caveat: CAVEAT.crop });
    }
  }
  return out.sort((a, b) => b.delta - a.delta);
}

export interface FarmTrial {
  option: FarmOption;
  input: ModelInput;
  score: ScoreTimeline;
}

/** Runs a trial: the same telemetry, the option's change, a new score timeline. */
export function runTrial(input: ModelInput, option: FarmOption): FarmTrial {
  const next = withChange(input, option.change);
  return { option, input: next, score: computeScoreTimeline(next) };
}

export * from './period';
export * from './rotation';
export * from './notes';
