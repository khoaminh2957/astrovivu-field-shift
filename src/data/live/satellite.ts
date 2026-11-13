/** Satellite branches from the ORNL DAAC subsets: vegetation (MOD13Q1 / VNP13A1) and thermal. */
import type { I18nText, Sample, Series } from '@/contracts';
import { tx } from '@/contracts';
import { addDays } from '@/lib/time';
import { climateServ } from '../adapters/climateserv';
import { ornlSubset } from '../adapters/ornl';
import { doyBaseline } from '../harmonize/baseline';
import { modisEtToMmDay, modisLstToC, modisVi, round } from '../harmonize/units';
import { footprintFit } from '../harmonize/zonal';
import { errText, latestDate, makeSeries } from '../build';
import { SOURCES } from '../sources';
import type { LiveContext } from './context';

/** Years of MODIS history for baselines; cache script only (each year is ~6 slow requests). */
export const MODIS_BASELINE_YEARS = 5;

function pixelNote(ctx: LiveContext, resolutionM: number, product: string, pixels: number): I18nText | null {
  const fit = footprintFit(ctx.parcel.areaHa, resolutionM);
  if (pixels > 1) return tx(`${product}: mean of ${pixels} pixels inside the parcel.`, `${product}: trung bình ${pixels} điểm ảnh trong thửa.`);
  if (fit < 1)
    return tx(
      `${product}: the parcel is smaller than one ${resolutionM} m pixel, so the value mixes in the surroundings.`,
      `${product}: thửa nhỏ hơn một điểm ảnh ${resolutionM} m nên giá trị lẫn cả vùng xung quanh.`,
    );
  return null;
}

async function viPair(ctx: LiveContext, product: 'MOD13Q1' | 'VNP13A1', start: string, end: string) {
  const bands = product === 'MOD13Q1' ? ['250m_16_days_NDVI', '250m_16_days_EVI'] : ['500_m_16_days_NDVI', '500_m_16_days_EVI'];
  const resolutionM = product === 'MOD13Q1' ? 250 : 500;
  const opts = { periodDays: 16, decode: modisVi, signal: ctx.signal, resolutionM, concurrency: 2 };
  const [ndvi, evi] = await Promise.allSettled(bands.map((b) => ornlSubset(product, b, ctx.parcel, start, end, opts)));
  if (ndvi.status === 'rejected') throw ndvi.reason;
  return { ndvi: ndvi.value, evi: evi.status === 'fulfilled' ? evi.value : null, resolutionM };
}

export async function vegetation(ctx: LiveContext): Promise<void> {
  const notes: I18nText[] = [];
  let got: Awaited<ReturnType<typeof viPair>> | null = null;
  let src: typeof SOURCES.mod13q1 | typeof SOURCES.vnp13a1 = SOURCES.mod13q1;
  try {
    got = await viPair(ctx, 'MOD13Q1', ctx.start, ctx.end);
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    notes.push(tx(`MODIS MOD13Q1 unavailable (${errText(e)}); trying VIIRS VNP13A1.`, 'Không lấy được MODIS MOD13Q1; chuyển sang VIIRS VNP13A1.'));
    try {
      got = await viPair(ctx, 'VNP13A1', ctx.start, ctx.end);
      src = SOURCES.vnp13a1;
    } catch (e2) {
      if (ctx.signal?.aborted) throw e2;
      notes.push(tx(`VIIRS VNP13A1 unavailable too (${errText(e2)}).`, 'VIIRS VNP13A1 cũng không phản hồi.'));
    }
  }
  if (!got) {
    ctx.emit(ctx.branch('vegetation', { series: [], facts: [], notes, expected: 2 }));
    return;
  }
  const pn = pixelNote(ctx, got.resolutionM, src.id === SOURCES.mod13q1.id ? 'MOD13Q1' : 'VNP13A1', got.ndvi.pixels);
  if (pn) notes.push(pn);
  if (got.ndvi.failedChunks) notes.push(tx(`${got.ndvi.failedChunks} request(s) failed; some composites are missing.`, `${got.ndvi.failedChunks} yêu cầu lỗi; thiếu một số kỳ ảnh.`));
  const mk = (ndvi: Sample[], evi: Sample[] | null, bn?: Sample[], be?: Sample[]): Series[] => {
    const out = [
      makeSeries('ndvi', 'vegetation', src.id, '', '16-day', ndvi, {
        primary: true,
        range: [0, 1],
        baseline: bn ? doyBaseline(bn, { halfWindow: 8, step: 4, minCount: 3 }) : undefined,
      }),
    ];
    if (evi) out.push(makeSeries('evi', 'vegetation', src.id, '', '16-day', evi, { range: [0, 1], baseline: be ? doyBaseline(be, { halfWindow: 8, step: 4, minCount: 3 }) : undefined }));
    return out;
  };
  ctx.emit(ctx.branch('vegetation', { series: mk(got.ndvi.samples, got.evi?.samples ?? null), facts: [], notes: [...notes], expected: 2 }));
  if (!ctx.opts.full || src.id !== SOURCES.mod13q1.id) return;
  try {
    const b = await viPair(ctx, 'MOD13Q1', addDays(ctx.start, -365 * MODIS_BASELINE_YEARS), addDays(ctx.start, -1));
    notes.push(tx(`Normal band from ${MODIS_BASELINE_YEARS} prior years of MOD13Q1.`, `Dải bình thường từ ${MODIS_BASELINE_YEARS} năm MOD13Q1 trước đó.`));
    ctx.emit(ctx.branch('vegetation', { series: mk(got.ndvi.samples, got.evi?.samples ?? null, b.ndvi.samples, b.evi?.samples), facts: [], notes, expected: 2 }));
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    notes.push(tx(`MODIS baseline years unavailable (${errText(e)}).`, 'Không tải được các năm nền MODIS.'));
  }
}

export async function thermal(ctx: LiveContext): Promise<void> {
  const notes: I18nText[] = [];
  const series: Series[] = [];
  const lstOpts = { periodDays: 8, decode: modisLstToC, signal: ctx.signal, resolutionM: 1000, concurrency: 2 };
  const round1 = (s: Sample[]) => s.map((x) => ({ t: x.t, v: round(x.v, 1) }));
  const lstP = ornlSubset('MOD11A2', 'LST_Day_1km', ctx.parcel, ctx.start, ctx.end, lstOpts);
  const esiP = climateServ(29, ctx.parcel.centroid, ctx.start, ctx.end, ctx.signal);
  const [lst, esi] = await Promise.allSettled([lstP, esiP]);
  if (lst.status === 'fulfilled') {
    series.push(makeSeries('lst_day', 'thermal', SOURCES.mod11a2.id, '°C', '8-day', round1(lst.value.samples), { primary: true, range: [0, 60] }));
    const pn = pixelNote(ctx, 1000, 'MOD11A2', lst.value.pixels);
    if (pn) notes.push(pn);
  } else {
    if (ctx.signal?.aborted) throw lst.reason;
    notes.push(tx(`MODIS land surface temperature unavailable (${errText(lst.reason)}).`, 'Không lấy được nhiệt độ bề mặt MODIS.'));
  }
  if (esi.status === 'fulfilled' && esi.value.some((s) => s.v != null)) {
    series.push(makeSeries('esi', 'thermal', SOURCES.esi.id, 'σ', 'weekly', esi.value, { range: [-3, 3] }));
    const last = latestDate(esi.value);
    if (last && last < addDays(ctx.end, -30)) notes.push(tx(`ESI is published only to ${last}.`, `ESI chỉ có đến ${last}.`));
  } else {
    notes.push(
      tx(
        'Evaporative Stress Index: ClimateSERV has published no values since July 2025, so none fall in this window.',
        'Chỉ số stress bốc thoát hơi: ClimateSERV không có giá trị mới từ tháng 7/2025, nên không có trong khoảng này.',
      ),
    );
  }
  ctx.emit(ctx.branch('thermal', { series: [...series], facts: [], notes: [...notes], expected: 2, primarySource: SOURCES.mod11a2.id }));
  if (!ctx.opts.full) return;
  // Cache script extras: night LST, MOD16 ET and a 5-year LST baseline.
  const [night, et, base] = await Promise.allSettled([
    ornlSubset('MOD11A2', 'LST_Night_1km', ctx.parcel, ctx.start, ctx.end, lstOpts),
    ornlSubset('MOD16A2', 'ET_500m', ctx.parcel, ctx.start, ctx.end, { periodDays: 8, decode: (v) => modisEtToMmDay(v), signal: ctx.signal, resolutionM: 500 }),
    ornlSubset('MOD11A2', 'LST_Day_1km', ctx.parcel, addDays(ctx.start, -365 * MODIS_BASELINE_YEARS), addDays(ctx.start, -1), lstOpts),
  ]);
  if (base.status === 'fulfilled') {
    const i = series.findIndex((s) => s.key === 'lst_day');
    if (i >= 0) series[i] = { ...series[i], baseline: doyBaseline(base.value.samples, { halfWindow: 4, step: 4, minCount: 3, digits: 1 }) };
  }
  if (night.status === 'fulfilled') series.push(makeSeries('lst_night', 'thermal', SOURCES.mod11a2.id, '°C', '8-day', round1(night.value.samples), { range: [-10, 40] }));
  if (et.status === 'fulfilled') series.push(makeSeries('et', 'thermal', SOURCES.mod16a2.id, 'mm/day', '8-day', et.value.samples.map((x) => ({ t: x.t, v: round(x.v, 2) })), { range: [0, 8] }));
  else notes.push(tx(`MODIS ET unavailable (${errText(et.reason)}).`, 'Không lấy được ET MODIS.'));
  ctx.emit(ctx.branch('thermal', { series, facts: [], notes, expected: 2, primarySource: SOURCES.mod11a2.id }));
}
