/** Weather-driven branches: agromet, soil moisture, rainfall, risk; plus climateHistory. */
import type { I18nText, Sample, Series, YearClimate } from '@/contracts';
import { tx } from '@/contracts';
import { climateServ } from '../adapters/climateserv';
import { forecastDaily } from '../adapters/openmeteo';
import { ornlHasDates, ornlSubset } from '../adapters/ornl';
import { appeearsAvailable, smapL4Point } from '../adapters/appeears';
import { isNode } from '../env';
import { doyBaseline, rainAnomaly } from '../harmonize/baseline';
import { monthlyClimate } from '../harmonize/monthly';
import { thresholdEvents } from '../harmonize/risk';
import { fractionToPct, lapseAdjust, round } from '../harmonize/units';
import { errText, latestDate, makeSeries, within } from '../build';
import { SOURCES } from '../sources';
import { HISTORY_YEARS, type LiveContext } from './context';

const mapV = (s: Sample[], f: (v: number) => number | null, digits = 2): Sample[] =>
  s.map((x) => ({ t: x.t, v: x.v == null ? null : round(f(x.v), digits), ...(x.q ? { q: x.q } : {}) }));

const note = (en: string, vi: string): I18nText => tx(en, vi);

// ---------------------------------------------------------------------------------------------
// agromet

export async function agromet(ctx: LiveContext): Promise<void> {
  const elev = await ctx.elevationWithin();
  const [pw, era] = await Promise.allSettled([ctx.powerWindow(), ctx.era5History()]);
  const notes: I18nText[] = [];
  const series: Series[] = [];
  const build = (baseline?: Awaited<ReturnType<LiveContext['powerBaseline']>>) => {
    series.length = 0;
    notes.length = 0;
    if (pw.status === 'fulfilled') {
      const p = pw.value;
      const lapse = (v: number) => lapseAdjust(v, p.cellElevationM, elev);
      const base = (k: string, f: (v: number) => number | null = (v) => v) =>
        baseline ? doyBaseline(mapV(baseline.series[k] ?? [], f), { step: 3, digits: 2 }) : undefined;
      series.push(
        makeSeries('t2m_max', 'agromet', SOURCES.power.id, '°C', 'daily', mapV(p.series.T2M_MAX, lapse), { baseline: base('T2M_MAX', lapse), range: [-10, 45] }),
        makeSeries('t2m_min', 'agromet', SOURCES.power.id, '°C', 'daily', mapV(p.series.T2M_MIN, lapse), { baseline: base('T2M_MIN', lapse), range: [-20, 35] }),
        makeSeries('t2m', 'agromet', SOURCES.power.id, '°C', 'daily', mapV(p.series.T2M, lapse), { baseline: base('T2M', lapse), range: [-15, 40] }),
        makeSeries('rh', 'agromet', SOURCES.power.id, '%', 'daily', p.series.RH2M, { baseline: base('RH2M'), range: [0, 100] }),
        makeSeries('wind', 'agromet', SOURCES.power.id, 'm/s', 'daily', p.series.WS2M, { baseline: base('WS2M'), range: [0, 12] }),
      );
      // PAR (MJ/m²/day, verified unit) lags ~2.5 months; later days are estimated from POWER
      // shortwave × the PAR/SW ratio observed at this point, flagged `filled`.
      const par = p.series.ALLSKY_SFC_PAR_TOT;
      const sw = new Map(p.series.ALLSKY_SFC_SW_DWN.map((s) => [s.t, s.v]));
      const ratios = par.filter((s) => s.v != null && (sw.get(s.t) ?? 0) > 1).map((s) => s.v! / sw.get(s.t)!);
      ratios.sort((a, b) => a - b);
      const ratio = ratios.length >= 20 ? ratios[Math.floor(ratios.length / 2)] : 0.48;
      const lastPar = latestDate(par);
      const parSamples: Sample[] = par.map((s) => {
        if (s.v != null) return s;
        const w = sw.get(s.t);
        return lastPar && s.t > lastPar && w != null ? { t: s.t, v: round(w * ratio, 2), q: 'filled' as const } : s;
      });
      if (lastPar && parSamples.some((s) => s.q === 'filled'))
        notes.push(
          note(
            `PAR observed to ${lastPar}; later days estimated as ${ratio.toFixed(2)} × POWER shortwave (marked filled).`,
            `PAR có số đo đến ${lastPar}; các ngày sau ước tính bằng ${ratio.toFixed(2)} × bức xạ sóng ngắn POWER (đánh dấu ước tính).`,
          ),
        );
      series.unshift(
        makeSeries('par', 'agromet', SOURCES.powerSolar.id, 'MJ/m²/day', 'daily', parSamples, { primary: true, baseline: base('ALLSKY_SFC_PAR_TOT'), range: [0, 14] }),
      );
      if (elev != null && p.cellElevationM != null && Math.abs(elev - p.cellElevationM) > 50)
        notes.push(
          note(
            `Air temperatures lapse-rate corrected from the POWER cell mean (${Math.round(p.cellElevationM)} m) to the parcel (${Math.round(elev)} m).`,
            `Nhiệt độ không khí hiệu chỉnh theo độ cao từ ô POWER (${Math.round(p.cellElevationM)} m) về thửa (${Math.round(elev)} m).`,
          ),
        );
    } else {
      notes.push(note(`NASA POWER unavailable (${errText(pw.reason)}); temperatures from ERA5.`, `NASA POWER không phản hồi; nhiệt độ lấy từ ERA5.`));
      if (era.status === 'fulfilled') {
        const e = era.value;
        const lapse = (v: number) => lapseAdjust(v, e.elevationM, elev);
        const hist = (k: string) => doyBaseline(mapV(e.series[k], lapse).filter((s) => s.t < ctx.start), { step: 3, digits: 2 });
        series.push(
          makeSeries('t2m_max', 'agromet', SOURCES.era5.id, '°C', 'daily', mapV(within(e.series.temperature_2m_max, ctx.start, ctx.end), lapse), { primary: true, baseline: hist('temperature_2m_max') }),
          makeSeries('t2m_min', 'agromet', SOURCES.era5.id, '°C', 'daily', mapV(within(e.series.temperature_2m_min, ctx.start, ctx.end), lapse), { baseline: hist('temperature_2m_min') }),
          makeSeries('t2m', 'agromet', SOURCES.era5.id, '°C', 'daily', mapV(within(e.series.temperature_2m_mean, ctx.start, ctx.end), lapse), { baseline: hist('temperature_2m_mean') }),
        );
      }
    }
    if (era.status === 'fulfilled') {
      const e = era.value.series.et0_fao_evapotranspiration;
      series.push(
        makeSeries('et0', 'agromet', SOURCES.era5.id, 'mm/day', 'daily', within(e, ctx.start, ctx.end), {
          baseline: doyBaseline(e.filter((s) => s.t < ctx.start), { step: 3, digits: 2 }),
          range: [0, 9],
        }),
      );
    } else notes.push(note('ERA5 reference ET unavailable.', 'Không có ET tham chiếu ERA5.'));
  };
  build();
  ctx.emit(ctx.branch('agromet', { series: [...series], facts: [], notes: [...notes], expected: 7 }));
  if (pw.status !== 'fulfilled') return;
  try {
    const b = await ctx.powerBaseline();
    build(b);
    ctx.emit(ctx.branch('agromet', { series: [...series], facts: [], notes, expected: 7 }));
  } catch (e) {
    notes.push(note(`POWER baseline years unavailable (${errText(e)}).`, 'Không tải được các năm nền của POWER.'));
    ctx.emit(ctx.branch('agromet', { series: [...series], facts: [], notes, expected: 7 }));
  }
}

// ---------------------------------------------------------------------------------------------
// soil moisture

/** ERA5-Land root zone 0-100 cm as the thickness-weighted mean of its three layers. */
export function rootZone(l1: Sample[], l2: Sample[], l3: Sample[]): Sample[] {
  const m2 = new Map(l2.map((s) => [s.t, s.v]));
  const m3 = new Map(l3.map((s) => [s.t, s.v]));
  return l1.map((s) => {
    const a = s.v;
    const b = m2.get(s.t);
    const c = m3.get(s.t);
    return { t: s.t, v: a == null || b == null || c == null ? null : round((7 * a + 21 * b + 72 * c) / 100, 3) };
  });
}

export async function soilMoisture(ctx: LiveContext): Promise<void> {
  const [era, pw] = await Promise.allSettled([ctx.era5History(), ctx.powerWindow()]);
  const notes: I18nText[] = [];
  let series: Series[] = [];
  if (era.status === 'fulfilled') {
    const e = era.value.series;
    const surf = e.soil_moisture_0_to_7cm_mean;
    const root = rootZone(surf, e.soil_moisture_7_to_28cm_mean, e.soil_moisture_28_to_100cm_mean);
    const bl = (s: Sample[]) => doyBaseline(s.filter((x) => x.t < ctx.start), { step: 3, digits: 3 });
    series.push(
      makeSeries('sm_surface', 'soilMoisture', SOURCES.era5Land.id, 'm³/m³', 'daily', within(surf, ctx.start, ctx.end), { baseline: bl(surf), range: [0, 0.6] }),
      makeSeries('sm_root', 'soilMoisture', SOURCES.era5Land.id, 'm³/m³', 'daily', within(root, ctx.start, ctx.end), { primary: true, baseline: bl(root), range: [0, 0.6] }),
    );
  } else notes.push(note(`ERA5-Land soil moisture unavailable (${errText(era.reason)}).`, 'Không có độ ẩm đất ERA5-Land.'));
  if (pw.status === 'fulfilled') {
    const p = pw.value.series;
    const asPct = (s: Sample[]) => mapV(s, (v) => fractionToPct(v), 1);
    const haveEra = series.length > 0;
    series.push(
      makeSeries(haveEra ? 'gwet_top' : 'sm_surface', 'soilMoisture', SOURCES.powerSoil.id, '% sat', 'daily', asPct(p.GWETTOP), { range: [0, 100] }),
      makeSeries(haveEra ? 'gwet_root' : 'sm_root', 'soilMoisture', SOURCES.powerSoil.id, '% sat', 'daily', asPct(p.GWETROOT), { range: [0, 100], primary: !haveEra }),
    );
    if (!haveEra) notes.push(note('Soil moisture from NASA POWER model wetness (% of saturation), not volumetric.', 'Độ ẩm đất từ mô hình NASA POWER (% bão hòa), không phải thể tích.'));
  }
  notes.push(
    note(
      'Soil moisture is a regional model estimate (9-55 km), shown as departure from its own 20-year normal.',
      'Độ ẩm đất là ước tính vùng (9-55 km), nên đọc theo độ lệch so với bình thường 20 năm của chính nó.',
    ),
  );
  ctx.emit(ctx.branch('soilMoisture', { series, facts: [], notes: [...notes], expected: 2 }));

  // SMAP: AppEEARS L4 with a token (Node only), else ORNL L3 subset where ORNL serves it.
  const smapNotes: I18nText[] = [];
  let smap: { surface: Sample[]; root: Sample[]; sourceId: string } | null = null;
  if (isNode && appeearsAvailable()) {
    try {
      const r = await smapL4Point(ctx.parcel.centroid, ctx.start, ctx.end, ctx.signal);
      if (r.surface.some((s) => s.v != null)) smap = { ...r, sourceId: SOURCES.smapL4.id };
    } catch (e) {
      smapNotes.push(note(`SMAP L4 via AppEEARS failed (${errText(e)}).`, 'Lấy SMAP L4 qua AppEEARS thất bại.'));
    }
  }
  if (!smap) {
    const d = await ornlHasDates('SPL3SMP_E', ctx.parcel.centroid[0], ctx.parcel.centroid[1], ctx.signal);
    if (d.ok && d.last && d.last >= ctx.start) {
      try {
        const from = ctx.opts.full ? ctx.start : ctx.end.slice(0, 8) + '01';
        const r = await ornlSubset('SPL3SMP_E', 'soil_moisture', ctx.parcel, from, ctx.end, {
          periodDays: 1,
          resolutionM: 9000,
          decode: (v) => (v >= 0 && v <= 1 ? v : null),
          signal: ctx.signal,
        });
        if (r.samples.some((s) => s.v != null)) smap = { surface: r.samples, root: [], sourceId: SOURCES.smapL3.id };
      } catch (e) {
        smapNotes.push(note(`SMAP L3 subset failed (${errText(e)}).`, 'Lấy SMAP L3 thất bại.'));
      }
    } else {
      smapNotes.push(
        note(
          'SMAP is not served at this point by the key-free ORNL subset API; ERA5-Land stands in. SMAP L4 needs an Earthdata token (cache script).',
          'API ORNL không có SMAP tại điểm này; dùng ERA5-Land thay thế. SMAP L4 cần token Earthdata (script tạo cache).',
        ),
      );
    }
  }
  if (smap) {
    // SMAP takes the canonical keys; the ERA5-Land series it replaces stay as `*_era5`.
    const hasRoot = smap.root.some((s) => s.v != null);
    const replaced = new Set(hasRoot ? ['sm_surface', 'sm_root'] : ['sm_surface']);
    series = series.map((s) => (replaced.has(s.key) ? { ...s, key: `${s.key}_era5`, primary: undefined } : s));
    series.unshift(makeSeries('sm_surface', 'soilMoisture', smap.sourceId, 'm³/m³', 'daily', smap.surface, { range: [0, 0.6] }));
    if (hasRoot) {
      series = series.map((s) => ({ ...s, primary: undefined }));
      series.unshift(makeSeries('sm_root', 'soilMoisture', smap.sourceId, 'm³/m³', 'daily', smap.root, { range: [0, 0.6], primary: true }));
    }
  }
  ctx.emit(ctx.branch('soilMoisture', { series, facts: [], notes: [...notes, ...smapNotes], expected: 2, primarySource: smap?.sourceId }));
}

// ---------------------------------------------------------------------------------------------
// rainfall

export async function rainfall(ctx: LiveContext): Promise<void> {
  const notes: I18nText[] = [
    note(
      'GPM IMERG has no working key-free point service (ClimateSERV 26/91 empty, POWER IMERG_PRECTOT fill), so CHIRPS and ERA5 are used.',
      'GPM IMERG chưa có dịch vụ điểm miễn phí hoạt động (ClimateSERV 26/91 rỗng, POWER IMERG_PRECTOT trống), nên dùng CHIRPS và ERA5.',
    ),
  ];
  let era5Rain: Series | null = null;
  let anom: Series | null = null;
  try {
    const e = await ctx.era5History();
    const rain = e.series.precipitation_sum;
    era5Rain = makeSeries('rain', 'rainfall', SOURCES.era5.id, 'mm/day', 'daily', within(rain, ctx.start, ctx.end), {
      primary: true,
      baseline: doyBaseline(rain.filter((s) => s.t < ctx.start), { step: 3, digits: 2, halfWindow: 15 }),
      range: [0, 80],
    });
    const a = rainAnomaly(rain, ctx.start, ctx.end);
    anom = makeSeries('rain_anom', 'rainfall', SOURCES.era5.id, '%', 'daily', a.samples, { baseline: a.baseline, range: [0, 300] });
    notes.push(
      note(
        `30-day anomaly compares ERA5 with ERA5's own ${HISTORY_YEARS}-year normal at this point.`,
        `Dị thường 30 ngày so ERA5 với chuẩn ${HISTORY_YEARS} năm của chính ERA5 tại điểm này.`,
      ),
    );
    ctx.emit(ctx.branch('rainfall', { series: [era5Rain, anom], facts: [], notes: [...notes, note('CHIRPS loading; ERA5 shown meanwhile.', 'Đang tải CHIRPS; tạm hiển thị ERA5.')], expected: 2 }));
  } catch (e) {
    notes.push(note(`ERA5 rainfall unavailable (${errText(e)}).`, 'Không có mưa ERA5.'));
  }
  try {
    const ch = await climateServ(0, ctx.parcel.centroid, ctx.start, ctx.end, ctx.signal);
    if (ch.filter((s) => s.v != null).length < 30) throw new Error('CHIRPS returned too few days');
    const last = latestDate(ch);
    const series: Series[] = [makeSeries('rain', 'rainfall', SOURCES.chirps.id, 'mm/day', 'daily', ch, { primary: true, range: [0, 80] })];
    if (anom) series.push(anom);
    if (era5Rain) series.push({ ...era5Rain, key: 'rain_era5', label: { en: 'Daily rainfall (ERA5, to today)', vi: 'Mưa ngày (ERA5, đến hôm nay)' }, primary: undefined });
    notes.push(
      note(
        `CHIRPS (satellite + stations, 5 km) is published to ${last}; ERA5 covers the days since.`,
        `CHIRPS (vệ tinh + trạm, 5 km) có đến ${last}; ERA5 phủ các ngày sau đó.`,
      ),
    );
    ctx.emit(ctx.branch('rainfall', { series, facts: [], notes, expected: 2 }));
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    notes.push(note(`CHIRPS via ClimateSERV unavailable (${errText(e)}); ERA5 rainfall used.`, 'Không lấy được CHIRPS qua ClimateSERV; dùng mưa ERA5.'));
    ctx.emit(ctx.branch('rainfall', { series: [era5Rain, anom].filter((s): s is Series => !!s), facts: [], notes, expected: 2 }));
  }
}

// ---------------------------------------------------------------------------------------------
// risk

export async function risk(ctx: LiveContext): Promise<void> {
  const notes: I18nText[] = [];
  try {
    const vars = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max'];
    const [fc, elev] = await Promise.all([forecastDaily(ctx.parcel.centroid, vars, 16, ctx.signal), ctx.elevationWithin(2500)]);
    const lapse = (v: number) => lapseAdjust(v, fc.elevationM, elev);
    const tmax = mapV(fc.series.temperature_2m_max, lapse, 1);
    const tmin = mapV(fc.series.temperature_2m_min, lapse, 1);
    const rain = fc.series.precipitation_sum;
    const days = tmax.map((s, i) => ({ t: s.t, tMax: s.v, tMin: tmin[i]?.v ?? null, rain: rain[i]?.v ?? null, windMaxKmh: fc.series.wind_speed_10m_max[i]?.v ?? null }));
    const events = thresholdEvents(days, SOURCES.forecast.id);
    notes.push(
      note(
        'Generic weather thresholds only; crop-stage pest and disease risk is added by the advisory engine.',
        'Chỉ là ngưỡng thời tiết chung; rủi ro sâu bệnh theo giai đoạn cây trồng do bộ tư vấn bổ sung.',
      ),
    );
    ctx.emit(
      ctx.branch('risk', {
        series: [
          makeSeries('fc_tmax', 'risk', SOURCES.forecast.id, '°C', 'daily', tmax, { primary: true, range: [-10, 45] }),
          makeSeries('fc_tmin', 'risk', SOURCES.forecast.id, '°C', 'daily', tmin, { range: [-20, 35] }),
          makeSeries('fc_rain', 'risk', SOURCES.forecast.id, 'mm/day', 'daily', rain, { range: [0, 80] }),
        ],
        facts: [],
        events,
        notes,
        expected: 3,
      }),
    );
  } catch (e) {
    if (ctx.signal?.aborted) throw e;
    ctx.emit(ctx.branch('risk', { series: [], facts: [], notes: [note(`Forecast unavailable (${errText(e)}).`, 'Không tải được dự báo.')], expected: 3 }));
  }
}

// ---------------------------------------------------------------------------------------------
// climate history

export async function climateHistory(ctx: LiveContext): Promise<YearClimate[] | null> {
  try {
    const e = await ctx.era5History();
    const elev = await ctx.elevationWithin();
    const lapse = (v: number | null) => lapseAdjust(v, e.elevationM, elev);
    const s = e.series;
    const days = s.precipitation_sum.map((r, i) => ({
      t: r.t,
      rain: r.v,
      tMean: lapse(s.temperature_2m_mean[i]?.v ?? null),
      tMin: lapse(s.temperature_2m_min[i]?.v ?? null),
      tMax: lapse(s.temperature_2m_max[i]?.v ?? null),
      et0: s.et0_fao_evapotranspiration[i]?.v ?? null,
    }));
    return monthlyClimate(days, ctx.thisYear - HISTORY_YEARS, ctx.thisYear - 1);
  } catch {
    return null;
  }
}
