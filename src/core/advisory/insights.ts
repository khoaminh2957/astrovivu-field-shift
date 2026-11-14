/**
 * Automatic commentary (Anomaly Markers): what changed on the field, when, and why it matters to
 * the crop. Rules and thresholds are documented in docs/ADVISORY.md §1.
 */
import type { BranchId, CropProfile, I18nText, Insight, ModelInput, ScoreSnapshot, ScoreTimeline, Series } from '@/contracts';
import { getCrop } from '@/core/crops';
import { addDays, diffDays } from '@/lib/time';
import { baselineAt, climateNormals, cropText, dailyArray, doyOf, findSeries, r0, r1, resolutionM, sourceName, tx } from './util';

type Sev = Insight['severity'];
interface Cand extends Insight {
  rank: number;
}

const CADENCE_DAYS: Record<string, number> = { daily: 1, weekly: 7, '8-day': 8, '16-day': 16, monthly: 30, static: 365 };
const SEV_W: Record<Sev, number> = { alert: 3, watch: 2, info: 1 };

function scope(input: ModelInput, s: Series | undefined): I18nText {
  const res = resolutionM(input.telemetry, s?.sourceId);
  const name = sourceName(input.telemetry, s?.sourceId);
  if (res != null && res >= 1000) return tx(`across the area around the field (${name}, ~${r1(res / 1000)} km pixel)`, `trên vùng quanh thửa ruộng (${name}, ô lưới ~${r1(res / 1000)} km)`);
  return tx(`on the field (${name}${res ? `, ${res} m pixel` : ''})`, `trên thửa ruộng (${name}${res ? `, ô lưới ${res} m` : ''})`);
}

function stageWord(snap: ScoreSnapshot | undefined): I18nText {
  const st = snap?.stage;
  if (!st || st.id === 'fallow' || st.id === 'pre-sowing' || st.id === 'dormant') return tx('outside the growing season', 'ngoài vụ trồng');
  return tx(`during the ${st.label.en.toLowerCase()} stage`, `trong giai đoạn ${st.label.vi.toLowerCase()}`);
}
const isActive = (snap: ScoreSnapshot | undefined) => !!snap?.stage && snap.stage.dayInSeason != null && snap.stage.id !== 'harvest';

const sevOf = (absZ: number, bad: boolean): Sev => (!bad ? 'info' : absZ >= 2 ? 'alert' : absZ >= 1.5 ? 'watch' : 'info');

interface AnomalyRule {
  key: string;
  branch: BranchId;
  minDays: number;
  eps: number;
  /** +1 when high values are bad for the crop, -1 when low values are bad, 0 when both are. */
  bad: 1 | -1 | 0;
  low: (d: number, z: string, sc: I18nText, st: I18nText, crop: I18nText) => I18nText;
  high: (d: number, z: string, sc: I18nText, st: I18nText, crop: I18nText) => I18nText;
}

const RULES: AnomalyRule[] = [
  {
    key: 'ndvi',
    branch: 'vegetation',
    minDays: 24,
    eps: 0.02,
    bad: -1,
    low: (d, z, sc, st, c) =>
      tx(
        `Vegetation greenness (NDVI) stayed below its normal for this time of year for ${d} days (z ${z}) ${sc.en}, ${st.en}. For ${c.en} this can mean water or nutrient stress, pest or disease damage, or a late or thin stand: scout the field to find which.`,
        `Độ xanh thảm thực vật (NDVI) thấp hơn mức thường năm trong ${d} ngày (z ${z}) ${sc.vi}, ${st.vi}. Với ${c.vi}, điều này có thể do thiếu nước hoặc dinh dưỡng, sâu bệnh, hoặc cây mọc muộn hay thưa: cần thăm đồng để biết nguyên nhân.`,
      ),
    high: (d, z, sc, st, c) =>
      tx(
        `Vegetation was greener than normal for ${d} days (z ${z}) ${sc.en}, ${st.en}: vigorous ${c.en} growth, or weeds and cover growing in the field.`,
        `Thảm thực vật xanh hơn mức thường năm trong ${d} ngày (z ${z}) ${sc.vi}, ${st.vi}: ${c.vi} phát triển mạnh, hoặc cỏ dại và cây che phủ mọc trên ruộng.`,
      ),
  },
  {
    key: 'sm_root',
    branch: 'soilMoisture',
    minDays: 14,
    eps: 0.01,
    bad: 0,
    low: (d, z, sc, st, c) =>
      tx(
        `Root-zone soil moisture was drier than normal for ${d} days (z ${z}) ${sc.en}, ${st.en}. A dry root zone limits water uptake by ${c.en}; check the soil by hand before irrigating.`,
        `Ẩm độ đất vùng rễ khô hơn mức thường năm trong ${d} ngày (z ${z}) ${sc.vi}, ${st.vi}. Vùng rễ khô hạn chế khả năng hút nước của ${c.vi}; kiểm tra đất bằng tay trước khi tưới.`,
      ),
    high: (d, z, sc, st, c) =>
      tx(
        `Root-zone soil moisture was wetter than normal for ${d} days (z ${z}) ${sc.en}, ${st.en}. Prolonged wet soil raises waterlogging and root-disease risk for ${c.en}; check drainage.`,
        `Ẩm độ đất vùng rễ ẩm hơn mức thường năm trong ${d} ngày (z ${z}) ${sc.vi}, ${st.vi}. Đất ẩm kéo dài làm tăng nguy cơ úng và bệnh rễ cho ${c.vi}; kiểm tra thoát nước.`,
      ),
  },
  {
    key: 'lst_day',
    branch: 'thermal',
    minDays: 16,
    eps: 0.6,
    bad: 1,
    low: (d, z, sc, st) =>
      tx(`Daytime land surface temperature was cooler than normal for ${d} days (z ${z}) ${sc.en}, ${st.en}; usually cloudier or wetter weather.`, `Nhiệt độ bề mặt đất ban ngày mát hơn mức thường năm trong ${d} ngày (z ${z}) ${sc.vi}, ${st.vi}; thường do trời nhiều mây hoặc ẩm hơn.`),
    high: (d, z, sc, st, c) =>
      tx(
        `Daytime land surface temperature was hotter than normal for ${d} days (z ${z}) ${sc.en}, ${st.en}. A hot surface often means plants are transpiring less: a sign of water or heat stress for ${c.en}.`,
        `Nhiệt độ bề mặt đất ban ngày nóng hơn mức thường năm trong ${d} ngày (z ${z}) ${sc.vi}, ${st.vi}. Bề mặt nóng thường cho thấy cây thoát hơi nước ít đi: dấu hiệu ${c.vi} bị stress nước hoặc nóng.`,
      ),
  },
];

function anomalyInsights(input: ModelInput, snapAt: (t: string) => ScoreSnapshot | undefined, crop: I18nText, out: Cand[]) {
  for (const rule of RULES) {
    const s = findSeries(input.telemetry, rule.key);
    if (!s?.baseline?.length) continue;
    const cad = CADENCE_DAYS[s.cadence] ?? 1;
    const sc = scope(input, s);
    let run: { t: string; z: number }[] = [];
    let sign = 0;
    const flush = () => {
      if (!run.length) return;
      const span = diffDays(run[run.length - 1].t, run[0].t) + cad;
      if (span >= rule.minDays) {
        const zMean = run.reduce((a, r) => a + r.z, 0) / run.length;
        const bad = rule.bad === 0 || Math.sign(zMean) === rule.bad;
        const st = stageWord(snapAt(run[0].t));
        const zs = (zMean > 0 ? '+' : '') + r1(zMean);
        const sev = sevOf(Math.abs(zMean), bad && (rule.key !== 'ndvi' || isActive(snapAt(run[0].t))));
        out.push({ t: run[0].t, branch: rule.branch, severity: sev, metricKey: rule.key, z: r1(zMean), text: (zMean < 0 ? rule.low : rule.high)(span, zs, sc, st, crop), rank: SEV_W[sev] + Math.min(3, Math.abs(zMean)) / 3 + Math.min(1, span / 60) });
      }
      run = [];
    };
    for (const p of s.samples) {
      if (p.v == null || p.q === 'poor') {
        flush();
        continue;
      }
      const b = baselineAt(s.baseline, doyOf(p.t));
      if (!b) {
        flush();
        continue;
      }
      const sd = Math.max((b.p90 - b.p10) / 2.563, rule.eps);
      const z = (p.v - b.mean) / sd;
      const sg = Math.abs(z) >= 1 ? Math.sign(z) : 0;
      if (sg === 0 || (sign !== 0 && sg !== sign)) flush();
      if (sg !== 0) run.push({ t: p.t, z });
      sign = sg;
    }
    flush();
  }
}

function rainInsights(input: ModelInput, snapAt: (t: string) => ScoreSnapshot | undefined, crop: I18nText, out: Cand[]) {
  const t = input.telemetry;
  const s = findSeries(t, 'rain_era5') ?? findSeries(t, 'rain');
  const { start, end } = t.window;
  const n = diffDays(end, start) + 1;
  if (s?.baseline?.length) {
    const daily = dailyArray(t, [s.key], start, n);
    const sc = scope(input, s);
    let last: { kind: string; i: number } | null = null;
    for (let i = 29; i < n; i += 10) {
      let obs = 0;
      let norm = 0;
      let ok = 0;
      for (let k = i - 29; k <= i; k++) {
        const b = baselineAt(s.baseline, doyOf(addDays(start, k)));
        if (!b || Number.isNaN(daily[k])) continue;
        obs += daily[k];
        norm += b.mean;
        ok++;
      }
      if (ok < 25 || norm < 30) continue;
      const ratio = obs / norm;
      const kind = ratio < 0.5 ? 'dry' : ratio > 1.8 ? 'wet' : '';
      if (!kind) continue;
      if (last && last.kind === kind && i - last.i <= 30) continue;
      last = { kind, i };
      const at = addDays(start, i - 29);
      const st = stageWord(snapAt(at));
      const sev: Sev = kind === 'dry' ? (ratio < 0.25 && norm >= 60 ? 'alert' : 'watch') : ratio > 2.5 ? 'watch' : 'info';
      out.push({
        t: at,
        branch: 'rainfall',
        severity: sev,
        metricKey: 'rain30',
        text:
          kind === 'dry'
            ? tx(`Only ${r0(obs)} mm of rain in 30 days against a normal of ${r0(norm)} mm (${r0(ratio * 100)} %) ${sc.en}, ${st.en}. ${crop.en} relies on stored soil water or irrigation until rain returns.`, `Chỉ có ${r0(obs)} mm mưa trong 30 ngày so với mức thường năm ${r0(norm)} mm (${r0(ratio * 100)} %) ${sc.vi}, ${st.vi}. ${crop.vi} phải dựa vào nước trữ trong đất hoặc tưới cho đến khi có mưa lại.`)
            : tx(`${r0(obs)} mm of rain in 30 days, ${r0(ratio * 100)} % of the normal ${r0(norm)} mm ${sc.en}, ${st.en}. Watch for waterlogging, nutrient leaching and leaf-disease pressure.`, `${r0(obs)} mm mưa trong 30 ngày, bằng ${r0(ratio * 100)} % mức thường năm ${r0(norm)} mm ${sc.vi}, ${st.vi}. Chú ý úng, rửa trôi dinh dưỡng và áp lực bệnh lá.`),
        rank: SEV_W[sev] + Math.min(1, Math.abs(Math.log(ratio))),
      });
    }
  }
  // Dry spells: consecutive days under 1 mm, judged against how wet those days normally are.
  const rain = dailyArray(t, ['rain', 'rain_era5'], start, n);
  const bl = (findSeries(t, 'rain_era5') ?? findSeries(t, 'rain'))?.baseline;
  const rs = findSeries(t, 'rain') ?? s;
  let runStart = -1;
  const flush = (endI: number) => {
    const len = endI - runStart;
    if (runStart >= 0 && len >= 15) {
      const at = addDays(start, runStart);
      let norm = 0;
      for (let k = runStart; k < endI; k++) norm += baselineAt(bl, doyOf(addDays(start, k)))?.mean ?? 0;
      const unusual = norm >= 1.5 * len;
      const active = isActive(snapAt(at)) || isActive(snapAt(addDays(start, endI - 1)));
      if (unusual || active) {
        const sev: Sev = unusual ? (len >= 25 && active ? 'alert' : 'watch') : 'info';
        out.push({
          t: at,
          branch: 'rainfall',
          severity: sev,
          metricKey: 'dryspell',
          text: unusual
            ? tx(`Dry spell: ${len} days with less than 1 mm of rain (${sourceName(t, rs?.sourceId)}), when about ${r0(norm)} mm would normally fall. ${active ? `${crop.en} was in season: soil water ran down.` : ''}`.trim(), `Đợt khô hạn: ${len} ngày mưa dưới 1 mm (${sourceName(t, rs?.sourceId)}), trong khi bình thường có khoảng ${r0(norm)} mm. ${active ? `${crop.vi} đang trong vụ: nước trong đất cạn dần.` : ''}`.trim())
            : tx(`${len} rainless days (normal for this dry season) while ${crop.en} was in season: the crop depends on stored soil water or irrigation.`, `${len} ngày không mưa (bình thường với mùa khô này) khi ${crop.vi} đang trong vụ: cây phụ thuộc vào nước trữ trong đất hoặc tưới.`),
          rank: SEV_W[sev] + Math.min(1, len / 40),
        });
      }
    }
    runStart = -1;
  };
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(rain[i]) && rain[i] < 1) {
      if (runStart < 0) runStart = i;
    } else flush(i);
  }
  flush(n);
}

function tempInsights(input: ModelInput, c: CropProfile | undefined, snapAt: (t: string) => ScoreSnapshot | undefined, crop: I18nText, out: Cand[]) {
  const t = input.telemetry;
  const { start, end } = t.window;
  const n = diffDays(end, start) + 1;
  const tmax = dailyArray(t, ['t2m_max'], start, n);
  const tmin = dailyArray(t, ['t2m_min'], start, n);
  const src = sourceName(t, findSeries(t, 't2m_max')?.sourceId);
  const heat = c ? c.req.tempC[3] : 35;
  const cold = c ? c.req.tempC[0] : null;
  const kill = c?.req.killTempC ?? 0;
  const scan = (test: (i: number) => boolean, minLen: number, emit: (i0: number, len: number, peak: number) => void, val: Float64Array, max: boolean) => {
    let s0 = -1;
    for (let i = 0; i <= n; i++) {
      const ok = i < n && !Number.isNaN(val[i]) && test(i);
      if (ok && s0 < 0) s0 = i;
      if (!ok && s0 >= 0) {
        if (i - s0 >= minLen) {
          let peak = val[s0];
          for (let k = s0; k < i; k++) peak = max ? Math.max(peak, val[k]) : Math.min(peak, val[k]);
          emit(s0, i - s0, peak);
        }
        s0 = -1;
      }
    }
  };
  const act = (i: number) => !c || isActive(snapAt(addDays(start, i)));
  // Perennials rest through a normal cold season: judge frost against the resting kill
  // temperature and skip cold spells in months that are normally below the growth minimum.
  const normals = climateNormals(t);
  const dormant = (i: number) => {
    if (c?.lifeSpan !== 'perennial' || !normals) return false;
    const m = Number(addDays(start, i).slice(5, 7));
    return normals[m - 1].tMean < c.req.tempC[1];
  };
  const killAt = (i: number) => (dormant(i) ? (c?.req.killTempRestC ?? kill - 10) : kill);
  scan(
    (i) => tmax[i] > heat && act(i),
    3,
    (i0, len, peak) => {
      const sev: Sev = len >= 5 || peak > heat + 3 ? 'alert' : 'watch';
      out.push({ t: addDays(start, i0), branch: 'agromet', severity: sev, metricKey: 'heat', text: tx(`Heat spell: ${len} days with maximum air temperature above ${r1(heat)} °C (peak ${r1(peak)} °C, ${src}, area average). ${c ? `Above the upper limit tolerated by ${crop.en}; flowering and grain or fruit set are the most exposed stages.` : ''}`.trim(), `Đợt nắng nóng: ${len} ngày nhiệt độ tối cao trên ${r1(heat)} °C (cao nhất ${r1(peak)} °C, ${src}, trung bình vùng). ${c ? `Vượt ngưỡng chịu đựng của ${crop.vi}; ra hoa và đậu hạt, đậu quả là giai đoạn dễ bị ảnh hưởng nhất.` : ''}`.trim()), rank: SEV_W[sev] + Math.min(1, len / 10) });
    },
    tmax,
    true,
  );
  scan(
    (i) => tmin[i] <= killAt(i) && act(i),
    1,
    (i0, len, peak) => {
      out.push({ t: addDays(start, i0), branch: 'agromet', severity: c ? 'alert' : 'watch', metricKey: 'frost', text: tx(`Frost: minimum air temperature reached ${r1(peak)} °C on ${len} day${len > 1 ? 's' : ''} (${src}, area average; low-lying parts of the field can be colder). ${c ? `At or below the ${r1(killAt(i0))} °C that damages ${crop.en}${dormant(i0) ? " even while dormant" : " in active growth"}.` : ''}`.trim(), `Sương giá: nhiệt độ tối thấp xuống ${r1(peak)} °C trong ${len} ngày (${src}, trung bình vùng; chỗ trũng trong ruộng có thể lạnh hơn). ${c ? `Bằng hoặc dưới ngưỡng ${r1(killAt(i0))} °C gây hại ${crop.vi}${dormant(i0) ? " kể cả khi nghỉ" : " đang sinh trưởng"}.` : ''}`.trim()), rank: 3 + Math.min(1, len / 5) });
    },
    tmin,
    false,
  );
  if (cold != null)
    scan(
      (i) => tmin[i] < cold && tmin[i] > killAt(i) && act(i) && !dormant(i),
      3,
      (i0, len, peak) => {
        out.push({ t: addDays(start, i0), branch: 'agromet', severity: 'watch', metricKey: 'cold', text: tx(`Cold spell: ${len} nights below ${r1(cold)} °C (lowest ${r1(peak)} °C, ${src}). Growth of ${crop.en} slows or stops below this temperature.`, `Đợt lạnh: ${len} đêm dưới ${r1(cold)} °C (thấp nhất ${r1(peak)} °C, ${src}). ${crop.vi} chậm hoặc ngừng sinh trưởng dưới nhiệt độ này.`), rank: 2 + Math.min(1, len / 10) });
      },
      tmin,
      false,
    );
}

const STAGE_WHY: Record<string, I18nText> = {
  initial: tx('Establishment: keep the seedbed moist and control weeds early.', 'Giai đoạn đầu: giữ ẩm luống gieo và làm cỏ sớm.'),
  development: tx('Canopy development: nutrient demand rises quickly.', 'Phát triển tán: nhu cầu dinh dưỡng tăng nhanh.'),
  'mid-season': tx('Mid-season: the stage most sensitive to water stress (FAO-33).', 'Giữa vụ: giai đoạn nhạy cảm nhất với thiếu nước (FAO-33).'),
  'late-season': tx('Late season: water demand falls; plan the harvest.', 'Cuối vụ: nhu cầu nước giảm; chuẩn bị thu hoạch.'),
  harvest: tx('Harvest window.', 'Thời điểm thu hoạch.'),
};

function stageInsights(input: ModelInput, score: ScoreTimeline, crop: I18nText, out: Cand[]) {
  if (!score.cropId) return;
  const assumed = !input.groundTruth.sowingDate;
  let prev: string | null = null;
  for (const s of score.snapshots) {
    const id = s.stage?.id ?? null;
    if (id && prev && id !== prev && STAGE_WHY[id]) {
      out.push({ t: s.t, branch: 'score', severity: 'info', metricKey: `stage:${id}`, text: tx(`${crop.en}: ${s.stage!.label.en} stage begins (modelled from the ${assumed ? 'assumed best sowing month' : 'sowing date you entered'}). ${STAGE_WHY[id].en}`, `${crop.vi}: bắt đầu giai đoạn ${s.stage!.label.vi.toLowerCase()} (mô hình theo ${assumed ? 'tháng gieo tốt nhất giả định' : 'ngày gieo bạn nhập'}). ${STAGE_WHY[id].vi}`), rank: 1.2 });
    }
    prev = id;
  }
}

function swingInsights(score: ScoreTimeline, out: Cand[]) {
  const sn = score.snapshots;
  let lastI = -99;
  for (let i = 14; i < sn.length; i++) {
    const a = sn[i - 14];
    const b = sn[i];
    const d = b.productivity - a.productivity;
    if (Math.abs(d) < 12 || i - lastI < 21) continue;
    if (score.cropId && !isActive(a) && !isActive(b)) continue;
    lastI = i;
    let key = '';
    let label: I18nText | null = null;
    let best = 0;
    for (const f of b.factors) {
      const g = a.factors.find((x) => x.key === f.key);
      if (f.score == null || g?.score == null) continue;
      const ch = (f.score - g.score) * Math.sign(d);
      if (ch > best) (best = ch), (key = f.key), (label = f.label);
    }
    const why = label ? tx(`, driven mostly by ${label.en.toLowerCase()}`, `, chủ yếu do ${label.vi.toLowerCase()}`) : tx('', '');
    const sev: Sev = d <= -20 ? 'watch' : 'info';
    out.push({ t: b.t, branch: 'score', severity: sev, metricKey: `swing:${key || 'score'}`, text: d < 0 ? tx(`Productivity score fell ${-d} points in two weeks (${a.productivity} → ${b.productivity})${why.en}.`, `Điểm năng suất giảm ${-d} điểm trong hai tuần (${a.productivity} → ${b.productivity})${why.vi}.`) : tx(`Productivity score rose ${d} points in two weeks (${a.productivity} → ${b.productivity})${why.en}.`, `Điểm năng suất tăng ${d} điểm trong hai tuần (${a.productivity} → ${b.productivity})${why.vi}.`), rank: SEV_W[sev] + Math.min(1, Math.abs(d) / 40) });
  }
}

function forecastInsights(input: ModelInput, out: Cand[]) {
  const risk = input.telemetry.branches.risk;
  const kinds = new Set<string>();
  for (const e of risk?.events ?? []) {
    if (e.severity === 0) continue;
    const sev: Sev = e.severity >= 3 ? 'alert' : 'watch';
    kinds.add(e.kind);
    out.push({ t: e.start, branch: 'risk', severity: sev, metricKey: `fc:${e.kind}`, text: tx(`Forecast: ${e.title.en}. ${e.detail.en}`, `Dự báo: ${e.title.vi}. ${e.detail.vi}`), rank: SEV_W[sev] + 0.8 });
  }
  const fr = findSeries(input.telemetry, 'fc_rain');
  if (fr && !kinds.has('heavy-rain')) {
    const big = fr.samples.find((p) => p.v != null && p.v >= 50);
    if (big) out.push({ t: big.t, branch: 'risk', severity: 'watch', metricKey: 'fc:heavy-rain', text: tx(`Forecast: ${r0(big.v!)} mm of rain in one day (${sourceName(input.telemetry, fr.sourceId)}). Clear drains and postpone fertiliser or spraying before it.`, `Dự báo: ${r0(big.v!)} mm mưa trong một ngày (${sourceName(input.telemetry, fr.sourceId)}). Khơi thông rãnh thoát nước và hoãn bón phân hoặc phun trước đó.`), rank: 2.6 });
  }
}

const SUSC: Record<string, number> = { initial: 0.7, development: 1, 'mid-season': 1, 'late-season': 0.8 };

function pestInsights(input: ModelInput, snapAt: (t: string) => ScoreSnapshot | undefined, crop: I18nText, out: Cand[]) {
  if (!input.cropId) return;
  const t = input.telemetry;
  const { start, end } = t.window;
  const n = diffDays(end, start) + 1;
  const tm = dailyArray(t, ['t2m'], start, n);
  const rh = dailyArray(t, ['rh'], start, n);
  const rain = dailyArray(t, ['rain', 'rain_era5'], start, n);
  const src = sourceName(t, findSeries(t, 'rh')?.sourceId);
  const last: Record<string, number> = { fungal: -99, insect: -99 };
  for (let i = 0; i + 7 <= n; i += 7) {
    const st = snapAt(addDays(start, i))?.stage;
    const susc = st ? (SUSC[st.id] ?? 0) : 0;
    if (!susc) continue;
    let humid = 0;
    let warmDry = 0;
    let valid = 0;
    for (let k = i; k < i + 7; k++) {
      if (Number.isNaN(tm[k]) || Number.isNaN(rh[k])) continue;
      valid++;
      if ((rh[k] >= 85 && tm[k] >= 15 && tm[k] <= 30) || (rh[k] >= 75 && rain[k] >= 2 && tm[k] >= 15)) humid++;
      if (tm[k] >= 25 && rh[k] < 70) warmDry++;
    }
    if (valid < 5) continue;
    const fungal = (humid / valid) * susc;
    const insect = (warmDry / valid) * susc;
    const at = addDays(start, i);
    const stw = stageWord(snapAt(at));
    if (fungal >= 0.7 && i - last.fungal >= 28) {
      last.fungal = i;
      out.push({ t: at, branch: 'agromet', severity: 'watch', metricKey: 'pressure:disease', text: tx(`Disease pressure index high: ${humid} of ${valid} days humid and mild ${stw.en} (${src}, area weather). Such weather favours fungal and bacterial leaf diseases of ${crop.en} in general. This is a weather-based pressure index, not a diagnosis: scout the field before any treatment.`, `Chỉ số áp lực bệnh cao: ${humid}/${valid} ngày ẩm và ôn hòa ${stw.vi} (${src}, thời tiết vùng). Thời tiết như vậy thuận lợi cho bệnh nấm và vi khuẩn trên lá ${crop.vi} nói chung. Đây là chỉ số áp lực theo thời tiết, không phải chẩn đoán: thăm đồng trước khi xử lý.`), rank: 2.1 });
    }
    if (insect >= 0.8 && i - last.insect >= 28) {
      last.insect = i;
      out.push({ t: at, branch: 'agromet', severity: 'watch', metricKey: 'pressure:insect', text: tx(`Insect pressure index high: ${warmDry} of ${valid} days warm and dry ${stw.en} (${src}). Warm, dry spells speed up the life cycle of sucking insects and mites in general. A weather-based pressure index, not a diagnosis: scout and count before acting.`, `Chỉ số áp lực côn trùng cao: ${warmDry}/${valid} ngày nóng và khô ${stw.vi} (${src}). Thời tiết nóng khô làm vòng đời côn trùng chích hút và nhện hại nhanh hơn nói chung. Chỉ số theo thời tiết, không phải chẩn đoán: thăm đồng và đếm mật độ trước khi xử lý.`), rank: 2 });
    }
  }
}

const MAX_PER_MONTH = 4;
const MAX_TOTAL = 36;

/** Rank, de-duplicate and spread the candidates along the timeline, then sort by date. */
export function finalize(cands: Cand[]): Insight[] {
  cands.sort((a, b) => b.rank - a.rank);
  const kept: Cand[] = [];
  const perMonth = new Map<string, number>();
  for (const c of cands) {
    if (kept.some((k) => k.metricKey === c.metricKey && Math.abs(diffDays(k.t, c.t)) < 10)) continue;
    const m = c.t.slice(0, 7);
    const cnt = perMonth.get(m) ?? 0;
    if (cnt >= MAX_PER_MONTH && c.severity !== 'alert') continue;
    perMonth.set(m, cnt + 1);
    kept.push(c);
    if (kept.length >= MAX_TOTAL) break;
  }
  kept.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : b.rank - a.rank));
  return kept.map(({ rank: _r, ...i }) => i);
}

export function computeInsights(input: ModelInput, score: ScoreTimeline): Insight[] {
  const c = getCrop(input.cropId);
  const crop = c ? cropText(c.id) : tx('the crop', 'cây trồng');
  const byT = new Map(score.snapshots.map((s) => [s.t, s]));
  const snapAt = (t: string) => byT.get(t);
  const out: Cand[] = [];
  anomalyInsights(input, snapAt, crop, out);
  rainInsights(input, snapAt, crop, out);
  tempInsights(input, c, snapAt, crop, out);
  stageInsights(input, score, crop, out);
  swingInsights(score, out);
  forecastInsights(input, out);
  pestInsights(input, snapAt, crop, out);
  return finalize(out);
}
