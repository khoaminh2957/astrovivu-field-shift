/**
 * Action advisories: irrigation schedule, pH plan, ranked advisories and the annual plan.
 * Rules and sources in docs/ADVISORY.md §3-4.
 */
import type { Advisory, AnnualPlan, CropProfile, EvidenceItem, I18nText, IrrigationEvent, IrrigationPlan, ModelInput, MonthPlan, PhPlan, RotationStrategy, ScoreTimeline, TextureClass, WhatIfResult } from '@/contracts';
import { getCrop } from '@/core/crops';
import { whatIf, windowMonths } from '@/core/scoring';
import { addDays, diffDays } from '@/lib/time';
import { baselineAt, branchConf, climateNormals, cropText, dailyArray, doyOf, findFact, findSeries, factNum, monthEn, monthVi, monthsFrom, r0, r1, sourceName, tx, wrapMonth } from './util';

const AWC: Record<TextureClass, number> = { heavy: 0.16, medium: 0.15, light: 0.09, organic: 0.2 };

function texture(input: ModelInput): TextureClass {
  const v = input.groundTruth.texture ?? findFact(input.telemetry, 'texture_class')?.value;
  return v === 'heavy' || v === 'light' || v === 'organic' ? v : 'medium';
}

function kcFor(c: CropProfile, stage: ScoreTimeline['snapshots'][number]['stage']): number {
  const kc = c.water?.kc ?? { ini: 0.5, mid: 1.05, end: 0.7 };
  const [a, b, m] = c.water?.stages ?? [0.15, 0.25, 0.4, 0.2];
  if (!stage) return 0;
  const f = stage.progress;
  switch (stage.id) {
    case 'initial':
      return kc.ini;
    case 'development':
      return kc.ini + ((kc.mid - kc.ini) * Math.max(0, f - a)) / b;
    case 'mid-season':
      return kc.mid;
    case 'late-season':
      return kc.mid + ((kc.end - kc.mid) * Math.max(0, f - a - b - m)) / Math.max(0.05, 1 - a - b - m);
    case 'fallow':
    case 'pre-sowing':
      // Tree crops keep transpiring between cycles; annual fields are bare.
      return c.lifeSpan === 'perennial' ? kc.end : 0;
    default:
      return 0;
  }
}

/** FAO-56 single-layer root-zone water balance over the telemetry year plus the forecast days. */
export function irrigationPlan(input: ModelInput, score: ScoreTimeline): IrrigationPlan | undefined {
  const c = getCrop(input.cropId);
  if (!c || !score.snapshots.length) return undefined;
  const t = input.telemetry;
  const start = t.window.start;
  const end = t.window.forecastEnd ?? t.window.end;
  const n = diffDays(end, start) + 1;
  const today = t.window.end;
  const rainObs = dailyArray(t, ['rain', 'rain_era5'], start, n);
  const rainFc = dailyArray(t, ['fc_rain'], start, n);
  const et0Obs = dailyArray(t, ['et0'], start, n);
  const et0S = findSeries(t, 'et0');
  const snaps = new Map(score.snapshots.map((s) => [s.t, s]));
  const lastSnap = score.snapshots[score.snapshots.length - 1];
  const awc = factNum(t, 'awc_cmcm') ?? AWC[texture(input)];
  const zr = c.water?.rootDepthM ?? 1;
  const p = c.water?.depletionFraction ?? 0.5;
  const taw = 1000 * awc * zr;
  const raw = p * taw;
  const rice = c.rotation?.pestGroup === 'rice';
  let dr = 0;
  let smart = 0;
  let fixed = 0;
  const events: IrrigationEvent[] = [];
  const kcMid = c.water?.kc.mid ?? 1.05;
  let et0Mean = 0;
  let et0N = 0;
  for (let i = 0; i < n; i++) if (!Number.isNaN(et0Obs[i])) (et0Mean += et0Obs[i]), et0N++;
  et0Mean = et0N ? et0Mean / et0N : 4;
  const interval = Math.max(3, Math.min(14, Math.round(raw / Math.max(0.5, kcMid * et0Mean))));
  let lastFixed = -99;
  let rain7 = 0;
  for (let i = 0; i < n; i++) {
    const d = addDays(start, i);
    const future = d > today;
    const rain = future ? (Number.isNaN(rainFc[i]) ? 0 : rainFc[i]) : Number.isNaN(rainObs[i]) ? 0 : rainObs[i];
    const et0 = !future && !Number.isNaN(et0Obs[i]) ? et0Obs[i] : (baselineAt(et0S?.baseline, doyOf(d))?.mean ?? et0Mean);
    const snap = snaps.get(d) ?? (future ? lastSnap : undefined);
    const kc = kcFor(c, snap?.stage ?? null);
    rain7 = rain7 * (6 / 7) + rain;
    const pe = rain >= 2 ? 0.8 * rain : 0;
    dr = Math.min(taw, Math.max(0, dr - pe + kc * et0));
    if (kc <= 0) {
      dr = Math.max(0, dr - pe);
      continue;
    }
    // The fixed schedule is a calendar routine run in dry weeks only (a farmer skips it when it rains).
    if (i - lastFixed >= interval && rain7 < 5) (fixed += raw), (lastFixed = i);
    if (dr > raw) {
      const mm = r0(dr);
      smart += mm;
      events.push({
        t: d,
        mm,
        reason: future
          ? tx(`Forecast: the root zone is expected to pass the ${r0(raw)} mm readily available water of ${c.names.en} (${r0(taw)} mm total).`, `Dự báo: vùng rễ sẽ vượt mức ${r0(raw)} mm nước dễ hữu dụng của ${c.names.vi ?? c.names.en} (tổng ${r0(taw)} mm).`)
          : tx(`Root zone depleted by ${mm} mm, past the ${r0(raw)} mm the crop can use without stress; about ${r0(rain7)} mm of rain in the previous week.`, `Vùng rễ thiếu ${mm} mm, vượt mức ${r0(raw)} mm cây dùng được không bị stress; tuần trước mưa khoảng ${r0(rain7)} mm.`),
      });
      dr = 0;
    }
  }
  const rs = sourceName(t, findSeries(t, 'rain')?.sourceId);
  const es = sourceName(t, et0S?.sourceId);
  return {
    events,
    totalMm: r0(smart),
    savedVsFixedMm: r0(Math.max(0, fixed - smart)),
    method: rice
      ? tx(`Water balance with alternate wetting and drying (AWD) thresholds: re-flood when the field-tube water level drops about 15 cm below the soil surface. Amounts are net millimetres; add field losses.`, `Cân bằng nước theo ngưỡng tưới ướt khô xen kẽ (AWD): cho nước vào lại khi mực nước trong ống quan sát xuống khoảng 15 cm dưới mặt đất. Lượng tưới là mm thực; cộng thêm hao hụt.`)
      : tx(`FAO-56 root-zone water balance: Kc ${c.water?.kc.ini ?? 0.5}/${kcMid}/${c.water?.kc.end ?? 0.7}, depletion fraction p = ${p}, root depth ${zr} m, ${r0(taw)} mm available water. Irrigate the net depletion when it passes ${r0(raw)} mm. Amounts are net; add 15-30 % for system losses.`, `Cân bằng nước vùng rễ FAO-56: Kc ${c.water?.kc.ini ?? 0.5}/${kcMid}/${c.water?.kc.end ?? 0.7}, hệ số cạn kiệt p = ${p}, độ sâu rễ ${zr} m, ${r0(taw)} mm nước hữu dụng. Tưới bù lượng thiếu khi vượt ${r0(raw)} mm. Lượng tưới là thực; cộng 15-30 % hao hụt hệ thống.`),
    basis: tx(`Replayed over the last 12 months with observed rain (${rs}) and reference ET (${es}), then the ${t.window.forecastEnd ? diffDays(t.window.forecastEnd, today) : 0}-day forecast. Rain and ET are area values (km-scale pixels), and the growth stages are modelled; check soil moisture in the field before each irrigation. Compared with a fixed schedule of ${r0(raw)} mm every ${interval} days in dry weeks of the season.${input.groundTruth.irrigation === 'rainfed' ? ' You marked the field rainfed: this shows what an irrigation schedule would look like.' : ''}`, `Mô phỏng lại 12 tháng qua với mưa quan trắc (${rs}) và bốc thoát hơi tham chiếu (${es}), cộng dự báo ${t.window.forecastEnd ? diffDays(t.window.forecastEnd, today) : 0} ngày. Mưa và ET là giá trị vùng (ô lưới cấp km), giai đoạn sinh trưởng là mô hình; kiểm tra ẩm độ đất ngoài đồng trước mỗi lần tưới. So với lịch cố định ${r0(raw)} mm mỗi ${interval} ngày trong vụ.${input.groundTruth.irrigation === 'rainfed' ? ' Bạn đánh dấu ruộng nhờ nước mưa: đây là lịch tưới tham khảo nếu có nước.' : ''}`),
  };
}

/**
 * Indicative amendment rates per pH unit in the top ~20 cm, t/ha. Lime as CaCO3 equivalent,
 * sulfur as elemental S. Typical ranges in extension liming tables; the buffer-pH test sets the real rate.
 */
const LIME: Record<TextureClass, [number, number] | null> = { light: [1.5, 3], medium: [3, 5], heavy: [5, 8], organic: null };
const SULFUR: Record<TextureClass, [number, number] | null> = { light: [0.4, 0.8], medium: [0.8, 1.5], heavy: [1.5, 2.5], organic: null };

export function phPlan(input: ModelInput): PhPlan | undefined {
  const c = getCrop(input.cropId);
  const t = input.telemetry;
  const measured = input.groundTruth.ph;
  const current = measured ?? factNum(t, 'ph');
  if (!c || current == null || c.flags?.includes('ph-missing')) return undefined;
  const [, lo, hi] = c.req.ph;
  const tex = texture(input);
  const soilSrc = sourceName(t, t.branches.soil?.sources[0]);
  const caveats: I18nText[] = [tx('Indicative only: confirm with a laboratory soil test (pH and buffer pH) before buying any amendment.', 'Chỉ mang tính tham khảo: cần phân tích đất (pH và pH đệm) tại phòng thí nghiệm trước khi mua chất cải tạo.')];
  if (measured == null) caveats.push(tx(`The current pH is a map estimate (${soilSrc}), not a measurement on this field.`, `pH hiện tại là ước tính từ bản đồ (${soilSrc}), không phải đo trên thửa ruộng này.`));
  if (current < lo) {
    const target = r1(Math.min(hi, lo + 0.3));
    const per = LIME[tex];
    const delta = Math.min(1.5, target - current);
    caveats.push(tx('Apply lime 1-3 months before sowing and work it into the soil; split rates above 4 t/ha over two seasons.', 'Bón vôi 1-3 tháng trước khi gieo và trộn vào đất; chia làm hai vụ nếu trên 4 t/ha.'));
    return { current, target, amendment: 'lime', rateTHa: per ? [r1(per[0] * delta), r1(per[1] * delta)] : null, basis: tx(`${c.names.en} grows best at pH ${lo}-${hi}. Rate range for a ${tex} soil from typical extension liming tables (t CaCO3 equivalent per ha per pH unit, top ~20 cm).`, `${c.names.vi ?? c.names.en} phát triển tốt nhất ở pH ${lo}-${hi}. Khoảng liều cho đất ${tex} theo bảng bón vôi khuyến nông thông dụng (t CaCO3 tương đương/ha cho mỗi đơn vị pH, lớp đất ~20 cm).`), caveats };
  }
  if (current > hi) {
    const target = r1(Math.max(lo, hi - 0.3));
    // Calcareous soils buffer acid: sulfur rates are unpredictable and rarely economic.
    const calcareous = current >= 7.5;
    const per = calcareous ? null : SULFUR[tex];
    const delta = Math.min(1, current - target);
    if (calcareous) caveats.push(tx(`At pH ${current} the soil is probably calcareous (free lime): lowering pH is slow and rarely economic. Prefer tolerant crops and acidifying fertilisers; a carbonate test is needed.`, `Ở pH ${current} đất có thể chứa vôi tự do: hạ pH chậm và hiếm khi kinh tế. Ưu tiên cây chịu được và phân có tính axit; cần kiểm tra cacbonat.`));
    return { current, target, amendment: 'sulfur', rateTHa: per ? [r1(per[0] * delta), r1(per[1] * delta)] : null, basis: tx(`${c.names.en} grows best at pH ${lo}-${hi}. ${per ? `Elemental sulfur range for a ${tex} soil from typical extension tables (t S per ha per pH unit).` : 'No rate is given: it cannot be estimated responsibly without a lab test.'}`, `${c.names.vi ?? c.names.en} phát triển tốt nhất ở pH ${lo}-${hi}. ${per ? `Khoảng liều lưu huỳnh nguyên tố cho đất ${tex} theo bảng khuyến nông thông dụng (t S/ha cho mỗi đơn vị pH).` : 'Không đưa liều: không thể ước tính có trách nhiệm khi chưa phân tích đất.'}`), caveats };
  }
  return { current, target: current, amendment: 'none', rateTHa: null, basis: tx(`pH ${current} is inside the ${lo}-${hi} range ${c.names.en} prefers: no amendment needed.`, `pH ${current} nằm trong khoảng ${lo}-${hi} mà ${c.names.vi ?? c.names.en} ưa thích: không cần cải tạo.`), caveats };
}

// ------------------------------------------------------------------------------------------------
// Ranked advisories
// ------------------------------------------------------------------------------------------------

export function advisories(input: ModelInput, score: ScoreTimeline, irr: IrrigationPlan | undefined, ph: PhPlan | undefined, rotations: RotationStrategy[]): Advisory[] {
  const out: Advisory[] = [];
  const t = input.telemetry;
  const c = getCrop(input.cropId);
  const cn = c ? cropText(c.id) : tx('the crop', 'cây trồng');
  const wi: WhatIfResult[] = c ? whatIf(input) : [];
  const delta = (k: string) => wi.filter((w) => w.changedFactor === k).reduce<number | undefined>((a, w) => (a == null || w.delta > a ? w.delta : a), undefined);
  const today = t.window.end;
  const soilSrc = t.branches.soil?.sources[0];

  if (c && irr && irr.events.length) {
    const next = irr.events.filter((e) => e.t > today);
    const recent = irr.events.filter((e) => e.t <= today && diffDays(today, e.t) <= 30);
    const d = (input.groundTruth.irrigation ?? 'rainfed') === 'rainfed' ? delta('irrigation') : undefined;
    out.push({
      id: 'irrigation',
      kind: 'irrigation',
      priority: next.some((e) => diffDays(e.t, today) <= 7) || (d ?? 0) >= 10 ? 1 : 2,
      title: tx(`Irrigate ${cn.en} by soil water, not by the calendar`, `Tưới ${cn.vi} theo nước trong đất, không theo lịch`),
      summary: tx(`The water balance called for ${irr.events.length} irrigations (${irr.totalMm} mm) over the last year, about ${irr.savedVsFixedMm} mm less than a fixed schedule.${next.length ? ` ${next.length} expected in the forecast window.` : ' None needed in the forecast window.'}`, `Cân bằng nước cần ${irr.events.length} lần tưới (${irr.totalMm} mm) trong năm qua, ít hơn khoảng ${irr.savedVsFixedMm} mm so với lịch cố định.${next.length ? ` Dự kiến ${next.length} lần trong thời gian dự báo.` : ' Không cần tưới trong thời gian dự báo.'}`),
      actions: [
        ...next.slice(0, 3).map((e) => ({ when: tx(e.t, e.t), what: tx('Irrigate if a hand check confirms dry soil at root depth', 'Tưới nếu kiểm tra bằng tay xác nhận đất khô ở độ sâu rễ'), amount: `${e.mm} mm` })),
        ...(next.length ? [] : [{ when: tx('Next 2 weeks', '2 tuần tới'), what: tx('No irrigation needed per the forecast; re-check after any hot, dry week', 'Theo dự báo không cần tưới; kiểm tra lại sau tuần nóng, khô') }]),
        { when: tx('Every irrigation', 'Mỗi lần tưới'), what: tx('Apply the net depletion plus system losses; record the amount in the field journal', 'Tưới bù lượng thiếu cộng hao hụt hệ thống; ghi lượng tưới vào nhật ký đồng ruộng') },
      ],
      impact: { waterSavedMm: irr.savedVsFixedMm, ...(d != null ? { scoreDelta: d } : {}) },
      evidence: [
        { label: tx('Irrigations in the last 30 days (model)', 'Số lần tưới 30 ngày qua (mô hình)'), value: `${recent.length} (${recent.reduce((a, e) => a + e.mm, 0)} mm)`, sourceId: findSeries(t, 'rain')?.sourceId, branch: 'rainfall' },
        { label: tx('Reference evapotranspiration', 'Bốc thoát hơi tham chiếu'), value: sourceName(t, findSeries(t, 'et0')?.sourceId), sourceId: findSeries(t, 'et0')?.sourceId, branch: 'agromet' },
      ],
      confidence: r1(0.5 * branchConf(t, ['rainfall', 'agromet']) + 0.2),
      caveats: [tx('Rain and evapotranspiration are km-scale area values; the stage calendar is modelled.', 'Mưa và bốc thoát hơi là giá trị vùng cấp km; lịch giai đoạn là mô hình.')],
      needsLocalReview: false,
    });
  }

  if (c && ph && ph.amendment !== 'none') {
    out.push({
      id: 'ph',
      kind: 'ph',
      priority: (delta('ph') ?? 0) >= 10 ? 1 : 2,
      title: ph.amendment === 'lime' ? tx(`Raise soil pH from ${ph.current} toward ${ph.target}`, `Nâng pH đất từ ${ph.current} lên khoảng ${ph.target}`) : tx(`Soil pH ${ph.current} is above the range for ${cn.en}`, `pH đất ${ph.current} cao hơn khoảng thích hợp của ${cn.vi}`),
      summary: ph.basis,
      actions: [
        { when: tx('Before the next season', 'Trước vụ tới'), what: tx('Take a composite soil sample (15-20 cores, 0-20 cm) for pH and buffer pH', 'Lấy mẫu đất hỗn hợp (15-20 mũi khoan, 0-20 cm) để phân tích pH và pH đệm') },
        ...(ph.rateTHa ? [{ when: tx('1-3 months before sowing', '1-3 tháng trước gieo'), what: ph.amendment === 'lime' ? tx('Spread agricultural lime and incorporate it', 'Rải vôi nông nghiệp và trộn vào đất') : tx('Apply elemental sulfur and incorporate it', 'Bón lưu huỳnh nguyên tố và trộn vào đất'), amount: `${ph.rateTHa[0]}-${ph.rateTHa[1]} t/ha (indicative)` }] : [{ when: tx('After the soil test', 'Sau khi phân tích đất'), what: tx('Decide with an agronomist whether amending is worthwhile or a tolerant crop is better', 'Cùng chuyên gia quyết định có nên cải tạo hay chọn cây chịu được') }]),
      ],
      impact: delta('ph') != null ? { scoreDelta: delta('ph') } : {},
      evidence: [{ label: tx('Soil pH', 'pH đất'), value: String(ph.current), sourceId: input.groundTruth.ph != null ? undefined : soilSrc, branch: 'soil' }],
      confidence: input.groundTruth.ph != null ? 0.8 : r1(0.6 * branchConf(t, ['soil'])),
      caveats: ph.caveats,
      needsLocalReview: true,
    });
  }

  const sow = wi.find((w) => w.changedFactor === 'sowing');
  if (c && sow && sow.delta >= 3) {
    out.push({
      id: 'sowing',
      kind: 'sowing',
      priority: sow.delta >= 10 ? 1 : 2,
      title: sow.label,
      summary: tx(`Moving the sowing date raises the expected season outcome of ${cn.en} from ${sow.before} to ${sow.after}.`, `Dời thời vụ gieo nâng kết quả vụ dự kiến của ${cn.vi} từ ${sow.before} lên ${sow.after}.`),
      actions: [{ when: sow.label, what: tx('Prepare land and seed for the new window', 'Chuẩn bị đất và giống cho thời vụ mới') }],
      impact: { scoreDelta: sow.delta },
      evidence: [{ label: tx('Climate record used', 'Chuỗi khí hậu sử dụng'), value: `${t.climateHistory?.length ?? 0} years`, sourceId: t.climateSourceId, branch: 'agromet' }],
      confidence: r1(0.4 + 0.4 * branchConf(t, ['agromet'])),
      caveats: [tx('Based on monthly climate averages over a coarse grid; check local frost and flood calendars.', 'Dựa trên khí hậu trung bình tháng trên ô lưới thô; kiểm tra lịch sương giá và lũ địa phương.')],
      needsLocalReview: true,
    });
  }

  const dr = wi.find((w) => w.changedFactor === 'drainage');
  if (c && dr && dr.delta > 0) {
    out.push({ id: 'drainage', kind: 'drainage', priority: dr.delta >= 10 ? 1 : 2, title: tx('Improve field drainage', 'Cải thiện thoát nước'), summary: tx(`Better drainage raises the expected outcome from ${dr.before} to ${dr.after}.`, `Thoát nước tốt hơn nâng kết quả dự kiến từ ${dr.before} lên ${dr.after}.`), actions: [{ when: tx('Before the rainy season', 'Trước mùa mưa'), what: tx('Open field drains or raise beds', 'Đào rãnh thoát nước hoặc lên liếp') }], impact: { scoreDelta: dr.delta }, evidence: [{ label: tx('Drainage class', 'Cấp thoát nước'), value: String(findFact(t, 'drainage_class')?.value ?? input.groundTruth.drainage ?? '?'), sourceId: soilSrc, branch: 'soil' }], confidence: 0.5, caveats: [tx('Drainage class is a map value; walk the field after heavy rain.', 'Cấp thoát nước lấy từ bản đồ; hãy kiểm tra ruộng sau mưa lớn.')], needsLocalReview: true });
  }

  const cur = rotations.find((r) => r.kind === 'current');
  const best = rotations.filter((r) => r.kind !== 'current').sort((a, b) => b.score - a.score)[0];
  if (cur && best && best.score > cur.score) {
    out.push({
      id: `rotation-${best.id}`,
      kind: 'rotation',
      priority: best.score - cur.score >= 10 ? 1 : 2,
      title: tx(`Consider the ${best.name.en.toLowerCase()}`, `Cân nhắc ${best.name.vi.toLowerCase()}`),
      summary: tx(`It scores ${best.score} against ${cur.score} for the current practice under your priorities. ${best.why[0]?.en ?? ''}`, `Phương án đạt ${best.score} so với ${cur.score} của cách làm hiện tại theo ưu tiên của bạn. ${best.why[0]?.vi ?? ''}`),
      actions: best.seasons.filter((s) => (s.year ?? 0) === 0 && s.cropId !== 'fallow').map((s) => ({ when: tx(`${monthEn(s.startMonth)}-${monthEn(s.endMonth)}`, `${monthVi(s.startMonth)}-${monthVi(s.endMonth)}`), what: s.label })),
      impact: { marginDeltaUsdPerHa: best.metrics.marginUsdPerHaYr - cur.metrics.marginUsdPerHaYr, waterSavedMm: Math.max(0, cur.metrics.waterUseMm - best.metrics.waterUseMm) },
      evidence: best.evidence.slice(0, 3),
      confidence: r1(0.3 + 0.4 * branchConf(t, ['agromet', 'soil'])),
      caveats: best.gaps.slice(0, 2),
      needsLocalReview: true,
    });
  }

  const kinds = new Set<string>();
  for (const e of t.branches.risk?.events ?? []) {
    if (e.end < today || e.severity === 0 || kinds.has(e.kind)) continue;
    kinds.add(e.kind);
    const act: Record<string, I18nText> = {
      frost: tx('Harvest ripe produce, irrigate the evening before (moist soil holds heat) and cover sensitive seedlings', 'Thu hoạch sản phẩm đã chín, tưới vào chiều tối hôm trước (đất ẩm giữ nhiệt) và che phủ cây con nhạy cảm'),
      heat: tx('Irrigate early in the morning and avoid field operations at midday', 'Tưới vào sáng sớm và tránh làm việc ngoài đồng buổi trưa'),
      'heavy-rain': tx('Clear drains and postpone fertiliser application until after the rain', 'Khơi thông rãnh và hoãn bón phân đến sau mưa'),
      'dry-spell': tx('Check soil moisture and plan irrigation', 'Kiểm tra ẩm độ đất và lên kế hoạch tưới'),
      flood: tx('Move equipment and inputs to high ground; open outlets', 'Di chuyển máy móc và vật tư lên chỗ cao; mở cửa thoát nước'),
      wind: tx('Stake or tie tall plants and secure covers', 'Cắm cọc hoặc buộc cây cao và cố định tấm che'),
    };
    out.push({ id: `risk-${e.id}`, kind: 'risk', priority: e.severity >= 2 ? 1 : 2, title: e.title, summary: e.detail, actions: [{ when: tx(`Before ${e.start}`, `Trước ${e.start}`), what: act[e.kind] ?? tx('Scout the field and prepare', 'Thăm đồng và chuẩn bị') }], impact: {}, evidence: [{ label: tx('Forecast', 'Dự báo'), value: `${e.start} → ${e.end}`, sourceId: e.sourceId, branch: 'risk' }], confidence: r1(branchConf(t, ['risk'])), caveats: [tx('Forecasts more than a few days ahead are uncertain; the grid cell is several km wide.', 'Dự báo xa hơn vài ngày có độ bất định; ô lưới rộng vài km.')], needsLocalReview: false });
  }

  const om = factNum(t, 'om_pct') ?? (factNum(t, 'soc_gkg') != null ? (factNum(t, 'soc_gkg')! * 1.724) / 10 : null);
  if (om != null && om < 2) {
    out.push({ id: 'fertility-om', kind: 'fertility', priority: 3, title: tx(`Build soil organic matter (about ${r1(om)} %)`, `Tăng chất hữu cơ trong đất (khoảng ${r1(om)} %)`), summary: tx('Low organic matter lowers water holding and nutrient supply. Residue retention, manure or compost and cover crops raise it slowly over years.', 'Chất hữu cơ thấp làm giảm khả năng giữ nước và cung cấp dinh dưỡng. Giữ lại tàn dư, bón phân chuồng hoặc phân ủ và trồng cây che phủ giúp tăng dần qua nhiều năm.'), actions: [{ when: tx('Every harvest', 'Mỗi lần thu hoạch'), what: tx('Leave crop residue on the field instead of burning it', 'Để lại tàn dư cây trồng thay vì đốt') }, { when: tx('Between seasons', 'Giữa các vụ'), what: tx('Sow a cover crop or apply well-rotted manure or compost', 'Gieo cây che phủ hoặc bón phân chuồng hoai mục, phân ủ'), amount: '5-10 t/ha (indicative)' }], impact: {}, evidence: [{ label: tx('Organic matter', 'Chất hữu cơ'), value: `${r1(om)} %`, sourceId: soilSrc, branch: 'soil' }], confidence: r1(0.6 * branchConf(t, ['soil'])), caveats: [tx('Map estimate, not a field measurement.', 'Ước tính từ bản đồ, không phải đo tại ruộng.')], needsLocalReview: false });
  }
  const slope = factNum(t, 'slope_deg');
  const cover = cur?.metrics.groundCoverPct ?? 100;
  if (slope != null && slope >= 8 && cover < 80) {
    out.push({ id: 'erosion', kind: 'erosion', priority: 2, title: tx(`Protect the ${r1(slope)}° slope from erosion`, `Chống xói mòn trên dốc ${r1(slope)}°`), summary: tx(`The soil is bare about ${100 - cover} % of the year on a ${r1(slope)}° slope.`, `Đất để trống khoảng ${100 - cover} % thời gian trên dốc ${r1(slope)}°.`), actions: [{ when: tx('Next land preparation', 'Lần làm đất tới'), what: tx('Plant along the contour and keep a cover crop or mulch between seasons', 'Trồng theo đường đồng mức và giữ cây che phủ hoặc phủ gốc giữa các vụ') }], impact: {}, evidence: [{ label: tx('Slope', 'Độ dốc'), value: `${r1(slope)}°`, sourceId: t.branches.terrain?.sources[0], branch: 'terrain' }], confidence: 0.6, caveats: [tx('Slope from a 30 m elevation model; the field may be steeper in parts.', 'Độ dốc từ mô hình độ cao 30 m; một số phần ruộng có thể dốc hơn.')], needsLocalReview: true });
  }

  return out.sort((a, b) => a.priority - b.priority || Math.abs(b.impact.scoreDelta ?? 0) - Math.abs(a.impact.scoreDelta ?? 0));
}

// ------------------------------------------------------------------------------------------------
// Annual plan
// ------------------------------------------------------------------------------------------------

export function annualPlan(input: ModelInput, s: RotationStrategy): AnnualPlan {
  const first = Number(input.today.slice(5, 7));
  const order = monthsFrom(first, 12);
  const months = new Map<number, MonthPlan>(order.map((m) => [m, { month: m, tasks: [], costUsd: 0, revenueUsd: 0, cashUsd: 0 }]));
  const n = climateNormals(input.telemetry);
  const used = new Set<number>();
  const add = (m: number, task: I18nText | null, cost = 0, rev = 0) => {
    const mp = months.get(wrapMonth(m))!;
    if (task && !mp.tasks.some((x) => x.en === task.en)) mp.tasks.push(task);
    mp.costUsd += cost;
    mp.revenueUsd += rev;
  };
  for (const season of s.seasons.filter((x) => (x.year ?? 0) === 0)) {
    const c = getCrop(season.cropId);
    if (!c) continue;
    const ei = s.economics.seasons.findIndex((e, i) => !used.has(i) && e.cropId === season.cropId);
    const e = ei >= 0 ? s.economics.seasons[ei] : undefined;
    if (ei >= 0) used.add(ei);
    const cost = e?.costUsd ?? 0;
    const rev = e?.revenueUsd ?? 0;
    const nm = season.label;
    const len = ((season.endMonth - season.startMonth + 12) % 12) + 1;
    const grow = monthsFrom(season.startMonth, len);
    if (c.lifeSpan !== 'annual' && len === 12) {
      const harvest = c.category === 'forage' ? grow.filter((m) => !n || n[m - 1].tMean >= 10) : [wrapMonth(season.startMonth + windowMonths(c) - 1)];
      const hv = harvest.length ? harvest : [season.endMonth];
      for (const m of grow) add(m, tx(`${nm.en}: field care, scouting`, `${nm.vi}: chăm sóc, thăm đồng`), cost / 12, 0);
      for (const m of hv) add(m, tx(`${nm.en}: harvest and sale`, `${nm.vi}: thu hoạch và bán`), 0, rev / hv.length);
      continue;
    }
    add(season.startMonth - 1, tx(`${nm.en}: land preparation, seed`, `${nm.vi}: làm đất, chuẩn bị giống`), 0.3 * cost);
    add(season.startMonth, tx(`${nm.en}: sowing`, `${nm.vi}: gieo trồng`));
    const mid = grow.slice(0, -1);
    for (const m of mid) add(m, tx(`${nm.en}: fertilise, weed, scout`, `${nm.vi}: bón phân, làm cỏ, thăm đồng`), (0.5 * cost) / Math.max(1, mid.length));
    add(season.endMonth, rev > 0 ? tx(`${nm.en}: harvest and sale`, `${nm.vi}: thu hoạch và bán`) : tx(`${nm.en}: terminate and leave as mulch`, `${nm.vi}: kết thúc và để làm lớp phủ`), 0.2 * cost, rev);
  }
  let cash = 0;
  const list = order.map((m) => {
    const mp = months.get(m)!;
    mp.costUsd = r0(mp.costUsd);
    mp.revenueUsd = r0(mp.revenueUsd);
    cash += mp.revenueUsd - mp.costUsd;
    mp.cashUsd = r0(cash);
    if (!mp.tasks.length) mp.tasks.push(tx('No field operations planned', 'Không có công việc đồng ruộng'));
    return mp;
  });
  const revenueUsd = list.reduce((a, m) => a + m.revenueUsd, 0);
  const costUsd = list.reduce((a, m) => a + m.costUsd, 0);
  return {
    strategyId: s.id,
    months: list,
    totals: { revenueUsd, costUsd, marginUsd: revenueUsd - costUsd, marginPct: revenueUsd > 0 ? r1((100 * (revenueUsd - costUsd)) / revenueUsd) : 0 },
    assumptions: [
      tx(`First year of the "${s.name.en}" strategy, starting ${monthEn(first)}, on ${r1(input.parcel.areaHa)} ha.`, `Năm đầu của phương án "${s.name.vi}", bắt đầu ${monthVi(first)}, trên ${r1(input.parcel.areaHa)} ha.`),
      tx('Yields, prices and costs are reference values unless you entered your own.', 'Năng suất, giá và chi phí là giá trị tham chiếu trừ khi bạn nhập số liệu riêng.'),
      tx('Operating costs: 30 % before sowing, 50 % spread over the season, 20 % at harvest; revenue in the harvest month. Land, family labour and overheads are excluded.', 'Chi phí vận hành: 30 % trước gieo, 50 % rải trong vụ, 20 % khi thu hoạch; doanh thu vào tháng thu hoạch. Không tính đất, công lao động gia đình và chi phí chung.'),
    ],
  };
}
