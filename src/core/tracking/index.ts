/**
 * Long-term tracking (State 6): season history, journal, soil tests, alerts, plan vs actual.
 * Demo fields get a deterministic simulated history driven by their real climate record and
 * land-cover history, always flagged `simulated: true`. Alerts come from the real insights.
 * A user's own parcel gets no invented history. See docs/ADVISORY.md §5.
 */
import type { AlertItem, CropProfile, I18nText, JournalEntry, ModelInput, SeasonRecord, SoilTest, TrackingData } from '@/contracts';
import { annualPlan, buildAdvisoryReport } from '@/core/advisory';
import { computeInsights } from '@/core/advisory/insights';
import { cropText, factNum, findSeries, hash01, monthsFrom, r1, tx } from '@/core/advisory/util';
import { getCrop } from '@/core/crops';
import { referenceEconomics } from '@/core/economics';
import { computeScoreTimeline, trapezoid } from '@/core/scoring';
import { BRANCH_TITLES } from '@/lib/series';
import { addDays } from '@/lib/time';

const pad = (n: number) => String(n).padStart(2, '0');
const SIM_LAB = 'Simulated laboratory (demo data)';

function alertsFrom(input: ModelInput, score: ReturnType<typeof computeScoreTimeline>): AlertItem[] {
  return computeInsights(input, score)
    .filter((i) => i.severity !== 'info')
    .slice(-12)
    .reverse()
    .map((i, k) => ({ id: `alert-${i.t}-${i.metricKey ?? k}`, t: i.t, severity: i.severity, title: i.branch === 'score' ? tx('Productivity score', 'Điểm năng suất') : BRANCH_TITLES[i.branch], body: i.text, ...(i.branch !== 'score' ? { branch: i.branch } : {}) }));
}

/** Climate fit of one season in one real year: min of temperature and water fit, from `climateHistory`. */
function yearFit(input: ModelInput, c: CropProfile, year: number, start: number, len: number): { fit: number; rain: number | null } {
  const h = input.telemetry.climateHistory ?? [];
  let rain = 0;
  let temp = 0;
  let n = 0;
  monthsFrom(start, len).forEach((m, i) => {
    const y = h.find((r) => r.year === year + (start + i > 12 ? 1 : 0)) ?? h.find((r) => r.year === year);
    const mc = y?.months.find((x) => x.month === m);
    if (mc?.rainMm != null && mc.tMean != null) (rain += mc.rainMm), (temp += mc.tMean), n++;
  });
  if (!n) return { fit: 0.8, rain: null };
  const irr = input.groundTruth.irrigation ?? 'rainfed';
  const scale = c.lifeSpan === 'annual' ? 1 : 12 / len;
  const water = irr === 'full' ? 1 : Math.min(1, trapezoid(rain * scale, c.req.rainMm) + (irr === 'supplemental' ? 0.3 : 0));
  return { fit: Math.max(0.35, Math.min(1, Math.min(trapezoid(temp / n, c.req.tempC), water))), rain: Math.round(rain) };
}

function soilTests(input: ModelInput, year: number): SoilTest[] {
  const t = input.telemetry;
  const ph = input.groundTruth.ph ?? factNum(t, 'ph') ?? 6.5;
  const om = input.groundTruth.organicMatterPct ?? factNum(t, 'om_pct') ?? (factNum(t, 'soc_gkg') != null ? (factNum(t, 'soc_gkg')! * 1.724) / 10 : 2.5);
  const cec = factNum(t, 'cec_cmolkg') ?? 12;
  const ec = input.groundTruth.ecDsM ?? factNum(t, 'ec_dsm') ?? 0.2;
  const alkaline = ph >= 7.5;
  const rate = (v: number, lo: number, hi: number): 'low' | 'optimal' | 'high' => (v < lo ? 'low' : v > hi ? 'high' : 'optimal');
  // Typical interpretation bands: Mehlich-3 K and Mg, DTPA micronutrients, KCl nitrate; see docs/ADVISORY.md §5.
  const make = (yr: number, k: number): SoilTest => {
    const j = (key: string, spread: number) => 1 + (hash01(`${input.parcel.id}-${yr}-${key}`) - 0.5) * 2 * spread;
    const row = (key: string, en: string, vi: string, value: number, unit: string, lo: number, hi: number) => ({ key, label: tx(en, vi), value: r1(value), unit, rating: rate(value, lo, hi) });
    return {
      t: `${yr}-03-15`,
      lab: SIM_LAB,
      simulated: true,
      values: [
        row('om', 'Organic matter', 'Chất hữu cơ', om * j('om', 0.08) * (1 + 0.02 * k), '%', 2, 5),
        row('ph', 'pH (water)', 'pH (nước)', ph + (hash01(`${input.parcel.id}-${yr}-ph`) - 0.5) * 0.2, '', 5.5, 7.5),
        row('k', 'Potassium (K)', 'Kali (K)', (60 + 6 * cec) * j('k', 0.15), 'mg/kg', 100, 200),
        row('no3n', 'Nitrate-N', 'Đạm nitrat (N-NO3)', 14 * j('n', 0.4), 'mg/kg', 10, 30),
        row('cec', 'CEC', 'CEC', cec * j('cec', 0.05), 'cmol(+)/kg', 10, 30),
        row('cu', 'Copper (Cu)', 'Đồng (Cu)', (alkaline ? 0.8 : 1.8) * j('cu', 0.3), 'mg/kg', 0.2, 5),
        row('fe', 'Iron (Fe)', 'Sắt (Fe)', (alkaline ? 4 : 45) * j('fe', 0.3), 'mg/kg', 4.5, 100),
        row('mg', 'Magnesium (Mg)', 'Magiê (Mg)', (30 + 12 * cec) * j('mg', 0.15), 'mg/kg', 50, 300),
        row('mn', 'Manganese (Mn)', 'Mangan (Mn)', (alkaline ? 2.5 : 25) * j('mn', 0.3), 'mg/kg', 1, 50),
        row('na', 'Sodium (Na)', 'Natri (Na)', (20 + 180 * ec) * j('na', 0.2), 'mg/kg', 0, 230),
        row('s', 'Sulfur (S)', 'Lưu huỳnh (S)', 11 * j('s', 0.3), 'mg/kg', 10, 40),
        row('zn', 'Zinc (Zn)', 'Kẽm (Zn)', (alkaline ? 0.7 : 1.6) * j('zn', 0.3), 'mg/kg', 0.8, 10),
      ],
    };
  };
  return [make(year - 3, 0), make(year - 1, 1)];
}

const CDL_IDS: [RegExp, string][] = [
  [/corn/i, 'zea-mays'],
  [/soy/i, 'glycine-max'],
  [/alfalfa/i, 'medicago-sativa'],
  [/wheat/i, 'triticum-aestivum'],
];

export function buildTracking(input: ModelInput): TrackingData {
  const score = computeScoreTimeline(input);
  const alerts = alertsFrom(input, score);
  const base: TrackingData = { parcelId: input.parcel.id, simulated: false, seasons: [], journal: [], soilTests: [], alerts, planVsActual: [], ndviByYear: [] };
  if (input.parcel.source !== 'sample') return base;

  const t = input.telemetry;
  const report = buildAdvisoryReport(input, score);
  const current = report.rotations.find((r) => r.kind === 'current');
  const thisYear = Number(input.today.slice(0, 4));
  const years = (t.climateHistory ?? []).map((y) => y.year).filter((y) => y < thisYear).slice(-5);
  const ndviS = findSeries(t, 'ndvi');
  const ndviPeakNow = ndviS ? Math.max(...ndviS.samples.map((s) => s.v ?? 0)) : null;
  const area = input.parcel.areaHa;
  const seasons: SeasonRecord[] = [];
  const journal: JournalEntry[] = [];
  const yearFactor = new Map<number, number>();
  for (const y of years) {
    const hist = t.cropHistory?.find((h) => h.year === y);
    const histId = hist ? CDL_IDS.find(([re]) => re.test(hist.crop))?.[1] : undefined;
    const rotYears = current?.years ?? 1;
    const plan = histId ? [{ cropId: histId, startMonth: current?.seasons.find((s) => s.cropId === histId)?.startMonth ?? 5, endMonth: current?.seasons.find((s) => s.cropId === histId)?.endMonth ?? 10 }] : (current?.seasons ?? []).filter((s) => (s.year ?? 0) === y % rotYears);
    const fits: number[] = [];
    for (const s of plan) {
      const c = getCrop(s.cropId);
      if (!c) continue;
      const len = ((s.endMonth - s.startMonth + 12) % 12) + 1;
      const { fit, rain } = yearFit(input, c, y, s.startMonth, len);
      fits.push(fit);
      const ref = referenceEconomics(c.id, input.parcel);
      const noise = 1 + (hash01(`${input.parcel.id}-${y}-${c.id}-${s.startMonth}`) - 0.5) * 0.12;
      const yieldTHa = ref?.refYieldTHa ? r1(ref.refYieldTHa * fit * 0.9 * noise) : undefined;
      const start = `${y}-${pad(s.startMonth)}-01`;
      const end = addDays(`${s.startMonth + len - 1 > 12 ? y + 1 : y}-${pad(((s.startMonth + len - 2) % 12) + 1)}-01`, 27);
      const id = `sim-${y}-${c.id}-${s.startMonth}`;
      const name = cropText(c.id);
      seasons.push({
        id,
        label: tx(`${name.en} ${y}`, `${name.vi} ${y}`),
        cropId: c.id,
        start,
        end,
        ...(yieldTHa != null ? { yieldTHa } : {}),
        ...(yieldTHa != null && ref?.priceUsdPerT ? { revenueUsd: Math.round(yieldTHa * ref.priceUsdPerT * area) } : {}),
        ...(ref?.costUsdPerHa ? { costUsd: Math.round(ref.costUsdPerHa * area * noise) } : {}),
        ...(ndviPeakNow ? { ndviPeak: Math.round(Math.min(0.95, ndviPeakNow * (0.85 + 0.15 * fit) * noise) * 100) / 100 } : {}),
        ...(rain != null ? { rainMm: rain } : {}),
        simulated: true,
      });
      const op = (d: number, kind: JournalEntry['kind'], title: I18nText, body?: I18nText) => journal.push({ id: `${id}-${kind}-${d}`, t: addDays(start, d), kind, title, ...(body ? { body } : {}), simulated: true });
      if (c.lifeSpan === 'annual') op(0, 'operation', tx(`Sowed ${name.en}`, `Gieo ${name.vi}`));
      op(30, 'operation', tx(`Fertiliser applied to ${name.en}`, `Bón phân cho ${name.vi}`), tx('Split application as planned.', 'Bón chia lần theo kế hoạch.'));
      op(55, 'scouting', tx('Field scouting', 'Thăm đồng'), fit < 0.6 ? tx('Uneven growth in drier patches; plants under water stress.', 'Cây phát triển không đều ở chỗ khô; cây thiếu nước.') : tx('Even stand, no significant pest or disease found.', 'Cây đồng đều, không phát hiện sâu bệnh đáng kể.'));
      if (yieldTHa != null) journal.push({ id: `${id}-harvest`, t: end, kind: 'harvest', title: tx(`Harvested ${name.en}: ${yieldTHa} t/ha`, `Thu hoạch ${name.vi}: ${yieldTHa} t/ha`), simulated: true });
    }
    if (fits.length) yearFactor.set(y, fits.reduce((a, b) => a + b, 0) / fits.length);
  }
  const tests = soilTests(input, thisYear);
  for (const st of tests) journal.push({ id: `soil-${st.t}`, t: st.t, kind: 'soil-test', title: tx('Soil test results received', 'Nhận kết quả phân tích đất'), body: tx(`${st.lab}: pH ${st.values.find((v) => v.key === 'ph')?.value}, organic matter ${st.values.find((v) => v.key === 'om')?.value} %.`, `${st.lab}: pH ${st.values.find((v) => v.key === 'ph')?.value}, chất hữu cơ ${st.values.find((v) => v.key === 'om')?.value} %.`), simulated: true });
  for (const a of alerts.slice(0, 6)) journal.push({ id: `j-${a.id}`, t: a.t, kind: 'alert', title: a.title, body: a.body, simulated: false });
  journal.sort((a, b) => (a.t < b.t ? 1 : -1));

  // Plan against actual for the current calendar year; past months carry simulated actuals.
  const plan = current ? annualPlan(input, current) : report.annualPlan;
  const nowM = Number(input.today.slice(5, 7));
  const planVsActual = (plan?.months ?? [])
    .slice()
    .sort((a, b) => a.month - b.month)
    .map((m) => {
      const j = 1 + (hash01(`${input.parcel.id}-pva-${m.month}`) - 0.5) * 0.2;
      const past = m.month < nowM;
      return { month: m.month, plannedCostUsd: m.costUsd, actualCostUsd: past ? Math.round(m.costUsd * j) : null, plannedRevenueUsd: m.revenueUsd, actualRevenueUsd: past ? Math.round(m.revenueUsd * (2 - j)) : null };
    });

  const ndviByYear: TrackingData['ndviByYear'] = [];
  if (ndviS) {
    ndviByYear.push({ year: thisYear, samples: ndviS.samples, simulated: false });
    const avg = [...yearFactor.values()].reduce((a, b) => a + b, 0) / Math.max(1, yearFactor.size) || 0.8;
    for (const y of years.slice(-3).reverse()) {
      const k = thisYear - y;
      const f = (yearFactor.get(y) ?? avg) / avg;
      ndviByYear.push({ year: y, simulated: true, samples: ndviS.samples.map((s) => ({ t: `${Number(s.t.slice(0, 4)) - k}${s.t.slice(4)}`.replace('-02-29', '-02-28'), v: s.v == null ? null : Math.round(Math.max(0, Math.min(1, s.v * (0.9 + 0.1 * f) + (hash01(`${input.parcel.id}-${y}-${s.t}`) - 0.5) * 0.04)) * 1000) / 1000, q: 'filled' as const })) });
    }
  }
  return { ...base, simulated: true, seasons: seasons.sort((a, b) => (a.start < b.start ? 1 : -1)), journal, soilTests: tests, planVsActual, ndviByYear };
}
