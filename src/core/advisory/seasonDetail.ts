/**
 * Per-season detail for the rotation calendar: what one block is there for, the numbers the
 * rotation engine already used for it, and one sentence built from those numbers.
 * Nothing is computed here that the strategy metrics do not also use; a value the engine has no
 * honest basis for is left undefined. Rules in docs/ADVISORY.md §2 "Per-season detail".
 */
import type { CropProfile, I18nText, RotationSeason, RotationSeasonDetail, SeasonEconomics } from '@/contracts';
import type { MonthNormal } from '@/lib/climate';
import { cropText, meanKc, monthEn, monthVi, monthsFrom, r0, r1, tx, wrapMonth } from './util';

/** Sum of a monthly normal over `len` months from `start`, wrapping over December; null when a month has no value. */
export function sumNormal(normals: readonly MonthNormal[], start: number, len: number, key: 'rainMm' | 'et0Mm'): number | null {
  let sum = 0;
  for (const m of monthsFrom(start, len)) {
    const v = normals[m - 1]?.[key];
    if (v == null) return null;
    sum += v;
  }
  return sum;
}

/** What the engine knows about one planned crop season. Depths and masses are per hectare of the area the crop occupies. */
export interface SeasonFacts {
  crop: CropProfile;
  start: number;
  len: number;
  /** Share of the field the crop occupies (1 unless it is an inter-row, companion or converted part). */
  share: number;
  interRow: boolean;
  /** True when the engine placed this legume for its nitrogen rather than for its margin. */
  forNitrogen: boolean;
  /** Fit used for the strategy metric; null when the scorer returned no windows for the crop. */
  suitability: number | null;
  /** Share of the analysed years in which the crop's needs were met in this slot. */
  reliability: number | null;
  /** True when `start` is the crop's best-scoring sowing month on this field. */
  bestMonth: boolean;
  /** Kc x normal ET0 over the season; null when ET0 or the crop's Kc curve is not on record. */
  etcMm: number | null;
  econ: SeasonEconomics | null;
  /** Indicative N credit; 0 for a crop that fixes none. */
  nitrogenKgHa: number;
  irrigation: 'rainfed' | 'supplemental' | 'full';
  /** The crop that follows this one in the sequence, when it is a different crop. */
  next?: I18nText;
  /** The main crop an inter-row cover grows under. */
  host?: I18nText;
}

const roleOf = (f: SeasonFacts): RotationSeasonDetail['role'] => (f.crop.category === 'cover' ? 'cover' : f.crop.lifeSpan !== 'annual' ? 'perennial' : f.forNitrogen ? 'legume' : 'cash');

const span = (start: number, len: number): I18nText => {
  const end = wrapMonth(start + len - 1);
  return len === 1 ? tx(monthEn(start), monthVi(start)) : tx(`${monthEn(start)}-${monthEn(end)}`, `${monthVi(start)} đến ${monthVi(end)}`);
};

/** Rain per month of the span against rain per month of the whole year (1 = an average month); null without normals. */
function rainRatio(normals: readonly MonthNormal[], rain: number | null, len: number): number | null {
  const annual = sumNormal(normals, 1, 12, 'rainMm');
  return rain != null && annual != null && annual > 0 ? rain / len / (annual / 12) : null;
}
/** Wording only: "wet months" get more rain than the average month, the "dry season" less than half of it. */
const wetterThanAverage = (normals: readonly MonthNormal[], rain: number | null, len: number) => (rainRatio(normals, rain, len) ?? 0) > 1;
const DRY_SEASON_RATIO = 0.5;

export function cropSeasonDetail(f: SeasonFacts, normals: readonly MonthNormal[], historyYears: number): RotationSeasonDetail {
  const role = roleOf(f);
  const rain = sumNormal(normals, f.start, f.len, 'rainMm');
  const d: RotationSeasonDetail = { role };
  if (f.suitability != null) d.suitability = f.suitability;
  // Same arithmetic as the strategy's evidence line, so the tooltip and the evidence list agree.
  if (f.reliability != null && historyYears > 0) d.metInYears = { met: Math.round(f.reliability * historyYears), of: historyYears };
  if (f.etcMm != null) d.waterNeedMm = r0(f.etcMm);
  if (rain != null) d.rainMm = r0(rain);
  if (f.econ) {
    // A cover crop is not harvested: its reference yield of 0 is not shown as an expected yield, its seed cost stays as a negative margin.
    if (role !== 'cover' || f.econ.yield.expectedTHa > 0) d.yieldTHa = f.econ.yield.expectedTHa;
    if (f.econ.areaHa > 0) d.marginUsdPerHa = Math.round(f.econ.marginUsd / f.econ.areaHa);
  }
  if (f.nitrogenKgHa > 0) d.nitrogenKgHa = f.nitrogenKgHa;
  d.reason = cropReason(f, role, d, normals);
  return d;
}

/** Months of the season whose normal rain is below Kc x normal ET0; `span` is set when they form one run. Null when a month has no value. */
function dryMonths(f: SeasonFacts, normals: readonly MonthNormal[]): { count: number; span: I18nText | null } | null {
  const kc = meanKc(f.crop);
  const dry = new Set<number>();
  for (const m of monthsFrom(f.start, f.len)) {
    const x = normals[m - 1];
    if (x?.rainMm == null || x.et0Mm == null) return null;
    if (x.rainMm < kc * x.et0Mm) dry.add(m);
  }
  const starts = [...dry].filter((m) => !dry.has(wrapMonth(m - 1)));
  return { count: dry.size, span: starts.length === 1 ? span(starts[0], dry.size) : null };
}

function cropReason(f: SeasonFacts, role: RotationSeasonDetail['role'], d: RotationSeasonDetail, normals: readonly MonthNormal[]): I18nText {
  const R = d.rainMm;
  const N = d.waterNeedMm;
  const s = d.suitability;
  const n = d.nitrogenKgHa;
  const mo = tx(monthEn(f.start), monthVi(f.start));
  const months = span(f.start, f.len);
  const both = R != null && N != null;

  if (role === 'cover') {
    const nEn = n ? `, and it leaves about ${n} kg N/ha where it grows (indicative)` : '';
    const nVi = n ? `, đồng thời để lại khoảng ${n} kg N/ha tại chỗ trồng (ước lượng)` : '';
    if (f.interRow) {
      const pct = Math.round(f.share * 100);
      const host = f.host ?? tx('the main crop', 'cây chính');
      const per = f.len === 12 ? tx(' a year', ' mỗi năm') : tx(` in ${months.en}`, ` trong ${months.vi}`);
      return tx(
        `Grown between the rows of ${host.en} on about ${pct} % of the area: the soil there stays covered${R != null ? ` under the ${R} mm of rain that normally falls${per.en}` : ''}${nEn}.`,
        `Trồng giữa các hàng ${host.vi} trên khoảng ${pct} % diện tích: đất ở đó luôn được che phủ${R != null ? ` dưới ${R} mm mưa thường rơi${per.vi}` : ''}${nVi}.`,
      );
    }
    const wet = wetterThanAverage(normals, R ?? null, f.len);
    const when = wet ? tx(`through the wet months (${months.en})`, `suốt các tháng mưa (${months.vi})`) : tx(`between cash crops (${months.en})`, `giữa các vụ chính (${months.vi})`);
    return tx(
      `Keeps the soil covered ${when.en}${R != null ? `: ${R} mm of rain normally falls on ground that would otherwise be bare` : ''}${nEn}.`,
      `Giữ đất được che phủ ${when.vi}${R != null ? `: thường có ${R} mm mưa rơi xuống mặt đất lẽ ra để trống` : ''}${nVi}.`,
    );
  }

  if (role === 'perennial') {
    const lead = f.len === 12 ? tx('Stands all year', 'Đứng quanh năm') : tx(`In the ground ${months.en}`, `Có mặt trên đồng ${months.vi}`);
    const per = f.len === 12 ? tx('in a year', 'mỗi năm') : tx('in these months', 'trong các tháng này');
    // An annual total hides the dry season, so the months whose normal rain is below the crop's use are named.
    const dry = both ? dryMonths(f, normals) : null;
    const irrigated = f.irrigation !== 'rainfed';
    const short =
      !dry || dry.count === 0
        ? tx('', '')
        : dry.count === f.len
          ? tx(`; in every month the rain is below what the crop uses${irrigated ? ', so it depends on irrigation' : ''}`, `; tháng nào lượng mưa cũng thấp hơn lượng nước cây dùng${irrigated ? ', nên cây phải dựa vào nước tưới' : ''}`)
          : tx(
              `; in ${dry.count} month${dry.count > 1 ? 's' : ''}${dry.span ? ` (${dry.span.en})` : ''} the rain is below what the crop uses${irrigated ? ', so they depend on irrigation' : ''}`,
              `; trong ${dry.count} tháng${dry.span ? ` (${dry.span.vi})` : ''} lượng mưa thấp hơn lượng nước cây dùng${irrigated ? ', nên phải dựa vào nước tưới' : ''}`,
            );
    const water = both
      ? tx(`: ${R} mm of rain normally falls ${per.en} against a crop water use of about ${N} mm${short.en}`, `: thường có ${R} mm mưa ${per.vi} so với lượng nước cây dùng khoảng ${N} mm${short.vi}`)
      : s != null
        ? tx(` (fit ${s}/100)`, ` (mức phù hợp ${s}/100)`)
        : tx('', '');
    const nEn = n ? `; it leaves about ${n} kg N/ha a year (indicative)` : '';
    const nVi = n ? `; để lại khoảng ${n} kg N/ha mỗi năm (ước lượng)` : '';
    return tx(`${lead.en}${water.en}${nEn}.`, `${lead.vi}${water.vi}${nVi}.`);
  }

  if (role === 'legume') {
    const next = f.next ? tx(`the next crop (${f.next.en})`, `vụ sau (${f.next.vi})`) : tx('the next crop', 'vụ sau');
    const water = both ? tx(`; ${R} mm of rain normally falls in its ${f.len}-month cycle and it needs about ${N} mm`, `; thường có ${R} mm mưa trong chu kỳ ${f.len} tháng và cây cần khoảng ${N} mm`) : tx('', '');
    return tx(`A legume sown in ${mo.en} that leaves about ${n ?? 0} kg N/ha (indicative) for ${next.en}${water.en}.`, `Cây họ đậu gieo ${mo.vi}, để lại khoảng ${n ?? 0} kg N/ha (ước lượng) cho ${next.vi}${water.vi}.`);
  }

  // Cash crop.
  if (both && R >= N) {
    return tx(`Sown in ${mo.en} so the ${f.len}-month cycle sits inside the rains: ${R} mm normally falls, the crop needs about ${N} mm.`, `Gieo ${mo.vi} để chu kỳ ${f.len} tháng nằm trọn trong mùa mưa: thường có ${R} mm mưa, cây cần khoảng ${N} mm.`);
  }
  const fit = s == null ? tx('', '') : f.bestMonth ? tx(`, its best-fitting month here (${s}/100)`, `, tháng phù hợp nhất với cây ở đây (${s}/100)`) : tx(` (fit ${s}/100)`, ` (mức phù hợp ${s}/100)`);
  if (!both) return tx(`Sown in ${mo.en}${fit.en}.`, `Gieo ${mo.vi}${fit.vi}.`);
  const rest =
    f.irrigation === 'full'
      ? tx('so irrigation supplies the rest', 'phần còn lại do nước tưới bù')
      : f.irrigation === 'supplemental'
        ? tx('so the crop also needs supplemental irrigation and water stored in the soil', 'nên cây cần thêm nước tưới bổ sung và nước trữ trong đất')
        : tx('so the crop relies on water stored in the soil', 'nên cây phải dựa vào nước trữ trong đất');
  return tx(
    `Sown in ${mo.en}${fit.en}: ${R} mm of rain normally falls in the ${f.len}-month cycle against a need of about ${N} mm, ${rest.en}.`,
    `Gieo ${mo.vi}${fit.vi}: thường có ${R} mm mưa trong chu kỳ ${f.len} tháng so với nhu cầu khoảng ${N} mm, ${rest.vi}.`,
  );
}

/** Below this monthly mean temperature the fallow sentence calls the months the cold season (wording only). */
const COLD_SEASON_C = 5;

/**
 * One fallow season per run of months no crop covers in a rotation year. `covered[y]` is the set of
 * months (1..12) with a crop in year y, the same sets the ground-cover metric is computed from.
 * `mainOf(y)` is the crop whose water use the dry-season sentence compares the rain with.
 */
export function fallowSeasons(covered: readonly ReadonlySet<number>[], mainOf: (year: number) => CropProfile | undefined, normals: readonly MonthNormal[]): RotationSeason[] {
  const out: RotationSeason[] = [];
  covered.forEach((ms, year) => {
    if (ms.size >= 12) return;
    const runs: [start: number, len: number][] = [];
    if (ms.size === 0) runs.push([1, 12]);
    else {
      for (let m = 1; m <= 12; m++) {
        if (ms.has(m) || !ms.has(wrapMonth(m - 1))) continue;
        let len = 1;
        while (!ms.has(wrapMonth(m + len))) len++;
        runs.push([m, len]);
      }
    }
    for (const [start, len] of runs) {
      const rain = sumNormal(normals, start, len, 'rainMm');
      const detail: RotationSeasonDetail = { role: 'fallow', reason: fallowReason(start, len, rain, mainOf(year), normals) };
      if (rain != null) detail.rainMm = r0(rain);
      out.push({ cropId: 'fallow', label: cropText('fallow'), startMonth: start, endMonth: wrapMonth(start + len - 1), year, detail });
    }
  });
  return out;
}

function fallowReason(start: number, len: number, rain: number | null, main: CropProfile | undefined, normals: readonly MonthNormal[]): I18nText {
  const months = span(start, len);
  if (rain == null) return tx(`No crop is planned in ${months.en}.`, `Chưa bố trí cây trồng trong ${months.vi}.`);
  const R = r0(rain);
  const temps = monthsFrom(start, len).map((m) => normals[m - 1]?.tMean);
  const coldest = temps.every((v): v is number => v != null) ? Math.min(...temps) : null;
  const cold = coldest != null && coldest < COLD_SEASON_C;
  // Where it freezes the record's precipitation is not all rain.
  const fall = cold ? tx('rain or snow', 'mưa hoặc tuyết') : tx('rain', 'mưa');
  if (len >= 12) return tx(`No crop in this year of the rotation: the field rests for the whole year; ${R} mm of ${fall.en} normally falls.`, `Năm này trong chu kỳ không trồng cây: đất nghỉ cả năm; thường có ${R} mm ${fall.vi}.`);
  if (cold) {
    return tx(
      `No crop in ${months.en}, the cold season: the monthly mean temperature falls to ${r1(coldest)} °C and ${R} mm of ${fall.en} normally falls.`,
      `Không trồng trong ${months.vi}, mùa lạnh: nhiệt độ trung bình tháng xuống tới ${r1(coldest)} °C và thường có ${R} mm ${fall.vi}.`,
    );
  }
  // What the year's main crop would use over these months (Kc x normal ET0); skipped when its Kc curve or ET0 is not on record.
  const et0 = sumNormal(normals, start, len, 'et0Mm');
  const need = main?.water && et0 != null ? r0(meanKc(main) * et0) : null;
  const these = len === 1 ? tx('that month', 'tháng này') : tx('these months', 'các tháng này');
  if (need != null && R < need) {
    const ratio = rainRatio(normals, rain, len);
    const drySeason = ratio != null && ratio < DRY_SEASON_RATIO;
    const name = cropText(main!.id);
    return tx(
      `Left fallow in ${months.en}${drySeason ? ', in the dry season' : ''}: ${R} mm of rain normally falls, against about ${need} mm that ${name.en} would use in ${these.en}.`,
      `Để đất nghỉ trong ${months.vi}${drySeason ? ', vào mùa khô' : ''}: thường chỉ có ${R} mm mưa, so với khoảng ${need} mm mà ${name.vi} sẽ cần trong ${these.vi}.`,
    );
  }
  return tx(`No crop is planned in ${months.en}; ${R} mm of rain normally falls in ${these.en}.`, `Chưa bố trí cây trồng trong ${months.vi}; thường có ${R} mm mưa trong ${these.vi}.`);
}
