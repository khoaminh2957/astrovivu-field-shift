/**
 * What each of the three characters says when its bubble is opened (docs/FARM.md §4): one plain
 * verdict and at most two short points, in a grower's words. The measurements behind them (NDVI,
 * m³/m³, the factor scores) are not in the note: they are one press away, in the character's
 * detail sheet, with their sources.
 *
 * Every sentence is built from a reading of the scene or from the advisory report. A missing
 * reading gives a sentence that says so; nothing is guessed.
 */
import type { AdvisoryReport, I18nText, ModelInput, RiskEvent } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { type FarmScene, type FarmVoice, type SkyKind, WET_DAY_MM, nextRisk, seriesOf } from './index';
import type { FarmPeriodSummary } from './period';

export interface FarmNote {
  who: FarmVoice;
  mood: 'calm' | 'glad' | 'worried';
  /** True when the character has something the grower should look at: its bubble is marked. */
  alert: boolean;
  headline: I18nText;
  /** At most two. */
  points: I18nText[];
  sourceIds: string[];
}

const n0 = (v: number): string => v.toFixed(0);
const dm = (t: string): string => `${Number(t.slice(8, 10))}/${Number(t.slice(5, 7))}`;
const two = (xs: (I18nText | null | false | undefined)[]): I18nText[] => xs.filter((x): x is I18nText => !!x).slice(0, 2);

const DAY_SKY: Record<SkyKind, I18nText> = {
  'heavy-rain': tx('Heavy rain today', 'Hôm nay mưa lớn'),
  rain: tx('A wet day', 'Hôm nay có mưa'),
  frost: tx('Frost risk tonight', 'Đêm nay có nguy cơ sương giá'),
  hot: tx('A very hot day', 'Hôm nay nắng nóng gay gắt'),
  cloudy: tx('An overcast day', 'Hôm nay trời nhiều mây'),
  clear: tx('Clear weather today', 'Hôm nay trời quang, nắng đẹp'),
  unknown: tx('No weather reading for today', 'Chưa có số liệu thời tiết hôm nay'),
};
const PERIOD_SKY_TEXT: Record<SkyKind, I18nText> = {
  'heavy-rain': tx('A period of heavy rain', 'Kỳ này mưa lớn nhiều'),
  rain: tx('A wet period', 'Kỳ này mưa nhiều'),
  frost: tx('A cold period with frost risk', 'Kỳ này lạnh, có nguy cơ sương giá'),
  hot: tx('A hot period', 'Kỳ này nắng nóng'),
  cloudy: tx('An overcast period', 'Kỳ này nhiều mây, ít nắng'),
  clear: tx('A dry, bright period', 'Kỳ này khô ráo, nhiều nắng'),
  unknown: tx('No weather reading for this period', 'Chưa có số liệu thời tiết của kỳ này'),
};
const moodOfSky = (k: SkyKind): FarmNote['mood'] => (k === 'heavy-rain' || k === 'frost' || k === 'hot' ? 'worried' : k === 'clear' ? 'glad' : 'calm');

function spaceNote(scene: FarmScene, summary: FarmPeriodSummary | null, risk: RiskEvent | null): FarmNote {
  const w = scene.weather;
  if (summary) {
    const s = summary;
    if (s.kind === 'unknown') return { who: 'space', mood: 'calm', alert: false, headline: PERIOD_SKY_TEXT.unknown, points: [], sourceIds: [] };
    const rain = s.rainMm == null ? null : tx(`${n0(s.rainMm)} mm of rain over ${s.wetDays} wet days`, `Mưa ${n0(s.rainMm)} mm trong ${s.wetDays} ngày có mưa`);
    const extreme =
      s.heavyRainDays > 0
        ? tx(`${s.heavyRainDays} days of heavy rain`, `${s.heavyRainDays} ngày mưa lớn`)
        : s.hotDays > 0
          ? tx(`${s.hotDays} days above 35 °C`, `${s.hotDays} ngày nóng trên 35 °C`)
          : s.frostDays > 0
            ? tx(`${s.frostDays} nights near freezing`, `${s.frostDays} đêm lạnh gần 0 °C`)
            : s.tMaxMeanC != null && s.tMinMeanC != null
              ? tx(`About ${n0(s.tMaxMeanC)} °C by day, ${n0(s.tMinMeanC)} °C at night`, `Ban ngày khoảng ${n0(s.tMaxMeanC)} °C, đêm ${n0(s.tMinMeanC)} °C`)
              : null;
    return { who: 'space', mood: moodOfSky(s.kind), alert: s.heavyRainDays > 0 || s.hotDays >= 5 || s.frostDays > 0, headline: PERIOD_SKY_TEXT[s.kind], points: two([rain, extreme]), sourceIds: s.sourceIds };
  }
  if (w.kind === 'unknown') return { who: 'space', mood: 'calm', alert: false, headline: DAY_SKY.unknown, points: [], sourceIds: [] };
  const temp = w.tMaxC != null && w.tMinC != null ? tx(`${n0(w.tMaxC)} °C by day, ${n0(w.tMinC)} °C at night`, `Ban ngày ${n0(w.tMaxC)} °C, đêm ${n0(w.tMinC)} °C`) : null;
  const week = w.rain7Mm == null ? null : w.rain7Mm < WET_DAY_MM ? tx('No rain in the last seven days', 'Bảy ngày qua không mưa') : tx(`${n0(w.rain7Mm)} mm of rain in the last seven days`, `Bảy ngày qua mưa ${n0(w.rain7Mm)} mm`);
  const ahead = risk ? tx(`Ahead: ${risk.title.en.toLowerCase()} from ${dm(risk.start)}`, `Sắp tới: ${risk.title.vi.toLowerCase()} từ ${dm(risk.start)}`) : null;
  return {
    who: 'space',
    mood: risk ? 'worried' : moodOfSky(w.kind),
    alert: !!risk || w.kind === 'heavy-rain' || w.kind === 'frost' || w.kind === 'hot',
    headline: DAY_SKY[w.kind],
    // A warning ahead is said before the week behind: it is what the grower can still act on.
    points: two([ahead, temp, week]),
    sourceIds: [...w.sourceIds, ...(risk ? [risk.sourceId] : [])],
  };
}

function cropNote(input: ModelInput, scene: FarmScene): FarmNote {
  const crop = getCrop(input.cropId);
  const c = scene.crop;
  if (!crop) {
    return { who: 'rice', mood: 'calm', alert: false, headline: tx('The field is bare in this period', 'Ruộng đang để trống trong kỳ này'), points: [], sourceIds: [] };
  }
  const name = tx(crop.names.en, crop.names.vi ?? crop.names.en);
  const resting = c.stage === 'fallow' || c.stage === 'pre-sowing' || c.stage === 'dormant' || c.stage == null;
  const health =
    c.ndviVsUsual === 'below'
      ? tx(`${name.en} is less green than in other years`, `${name.vi} đang kém xanh hơn mọi năm`)
      : c.ndviVsUsual === 'above'
        ? tx(`${name.en} is greener than in other years`, `${name.vi} đang xanh tốt hơn mọi năm`)
        : c.ndviVsUsual === 'usual'
          ? tx(`${name.en} is growing as in other years`, `${name.vi} đang lớn bình thường như mọi năm`)
          : tx(`${name.en} is growing`, `${name.vi} đang lớn`);
  const headline =
    c.harvested != null
      ? tx(`${name.en}: harvest time`, `${name.vi}: đang vào vụ thu hoạch`)
      : c.stage === 'dormant'
        ? tx(`${name.en} is resting this season`, `${name.vi} đang nghỉ trong mùa này`)
        : resting
          ? tx(`No ${name.en.toLowerCase()} on the field yet`, `Ruộng chưa có ${name.vi.toLowerCase()}`)
          : health;
  const stage = c.harvested != null ? tx(`About ${Math.round(c.harvested * 100)} % of the field is cut`, `Khoảng ${Math.round(c.harvested * 100)} % ruộng đã gặt`) : c.stageLabel && !resting ? tx(`Stage: ${c.stageLabel.en.toLowerCase()}`, `Giai đoạn: ${c.stageLabel.vi.toLowerCase()}`) : null;
  const toHarvest = c.daysToHarvest != null && c.daysToHarvest <= 60 ? tx(`About ${c.daysToHarvest} days to harvest`, `Còn khoảng ${c.daysToHarvest} ngày nữa thu hoạch`) : null;
  // Dry ground under a standing crop: a thing to go and look at, not a diagnosis of wilting.
  const dry = !resting && c.harvested == null && scene.soil.state === 'dry' ? tx('The ground is dry: watch for wilting', 'Đất đang khô: để ý cây có héo không') : null;
  const held = !resting && !dry && scene.limiting ? tx(`Held back most by: ${scene.limiting.en.toLowerCase()}`, `Đang bị kìm nhiều nhất bởi: ${scene.limiting.vi.toLowerCase()}`) : null;
  const noImage = !resting && c.ndvi == null ? tx('No recent satellite image of the crop', 'Chưa có ảnh vệ tinh gần đây của cây') : null;
  const worried = c.ndviVsUsual === 'below' || !!dry;
  return {
    who: 'rice',
    mood: worried ? 'worried' : c.harvested != null || c.ndviVsUsual === 'above' ? 'glad' : 'calm',
    alert: worried,
    headline,
    points: two([dry, stage, toHarvest, held, noImage]),
    sourceIds: c.ndviVsUsual != null ? [seriesOf(input.telemetry, 'ndvi')?.sourceId].filter((x): x is string => !!x) : [],
  };
}

function soilNote(input: ModelInput, scene: FarmScene, report: AdvisoryReport | null): FarmNote {
  const s = scene.soil;
  const crop = getCrop(input.cropId);
  const headline =
    s.state === 'dry'
      ? tx('The ground is drier than usual', 'Đất đang khô hơn thường lệ')
      : s.state === 'wet'
        ? tx('The ground is wetter than usual', 'Đất đang ẩm hơn thường lệ')
        : s.state === 'usual'
          ? tx('Soil moisture is normal for the season', 'Độ ẩm đất bình thường so với mùa này')
          : tx('No soil moisture reading yet', 'Chưa có số đo độ ẩm đất');
  const name = crop ? tx(crop.names.en.toLowerCase(), (crop.names.vi ?? crop.names.en).toLowerCase()) : null;
  const ph =
    s.ph == null
      ? null
      : s.phState === 'low'
        ? tx(`The soil is too acid for ${name?.en ?? 'the crop'} (pH ${s.ph.toFixed(1)})`, `Đất hơi chua so với ${name?.vi ?? 'cây trồng'} (pH ${s.ph.toFixed(1)})`)
        : s.phState === 'high'
          ? tx(`The soil is too alkaline for ${name?.en ?? 'the crop'} (pH ${s.ph.toFixed(1)})`, `Đất hơi kiềm so với ${name?.vi ?? 'cây trồng'} (pH ${s.ph.toFixed(1)})`)
          : s.phState === 'ok'
            ? tx(`Soil acidity suits ${name?.en ?? 'the crop'} (pH ${s.ph.toFixed(1)})`, `Độ chua của đất hợp với ${name?.vi ?? 'cây trồng'} (pH ${s.ph.toFixed(1)})`)
            : null;
  // The first thing the soil plan would do, when it finds something outside what the crop takes.
  const item = report?.soilPlan?.items.find((i) => i.status === 'outside') ?? null;
  const propose = item ? tx(`To improve: ${item.title.en}`, `Nên cải thiện: ${item.title.vi}`) : null;
  const worried = s.state === 'dry' || s.phState === 'low' || s.phState === 'high' || !!item;
  return {
    who: 'soil',
    mood: worried ? 'worried' : s.state === 'usual' && s.phState === 'ok' ? 'glad' : 'calm',
    alert: worried,
    headline,
    points: two([ph, propose]),
    sourceIds: s.sourceIds,
  };
}

/**
 * The three notes for a scene. `summary` is given when the stage shows a period, not today.
 * `report` lets the soil character name the first remedy of the soil plan; without it the note has none.
 */
export function farmNotes(input: ModelInput, scene: FarmScene, opts: { summary?: FarmPeriodSummary | null; report?: AdvisoryReport | null } = {}): Record<FarmVoice, FarmNote> {
  const risk = opts.summary ? null : nextRisk(input.telemetry, scene.weather.t);
  return {
    space: spaceNote(scene, opts.summary ?? null, risk),
    soil: soilNote(input, scene, opts.report ?? null),
    rice: cropNote(input, scene),
  };
}
