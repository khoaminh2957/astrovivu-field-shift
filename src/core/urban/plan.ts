/**
 * Whole-balcony container plan & succession sowing schedule (`docs/ADVISORY.md §4.7`).
 *
 * Pure, deterministic planner (`planBalcony`) that:
 *   1. Divides `areaM2` equally across the user's selected crops (in the user's order), computing
 *      plant counts from each crop's sourced `spacingCm` (`plantAreaM2 = (spacingCm / 100)²`) and
 *      moving any crop without `spacingCm` (or without a suitable sowing month) to `unplaced`.
 *   2. Schedules succession batches for single-harvest crops (`harvestType === 'once'`) spaced by
 *      `round(firstHarvestDays / batches)` days so `firstHarvest` dates are evenly spaced and every
 *      batch's sowing month satisfies `sowFit >= MARGINAL_FIT` (preferring `sowFit >= SOW_FIT` and
 *      flagging `marginal: true` when `MARGINAL_FIT <= sowFit < SOW_FIT`).
 *   3. Aggregates daily irrigation (`waterLitresPerDay: [min, max]`) for each calendar month across
 *      all plants actively growing in that month using `potWater` (`D6, #19`), and emits balcony
 *      sun-hour warnings using `sunHoursByMonth` (`D5, #18`) when `site.facingDeg` is provided.
 */
import type { CropProfile, I18nText, ISODate, UrbanClimate, UrbanPlan, UrbanPlanBatch, UrbanPlanBed, UrbanSite } from '@/contracts';
import { tx } from '@/contracts';
import { monthEn, monthVi } from '@/core/advisory/util';
import { getCrop, listUrbanCrops } from '@/core/crops';
import { addDays } from '@/lib/time';
import { MARGINAL_FIT, SOW_FIT } from './calendar';
import { windowFit } from './climateFit';
import { sunHoursByMonth } from './sun';
import { canopyFromPot, potWater } from './water';

/** Maximum number of succession batches for a single-harvest (`once`) crop on a balcony. */
export const MAX_SUCCESSION_BATCHES = 3;

/** Minimum interval in days between successive sowings of a `once` crop. */
export const MIN_BATCH_INTERVAL_DAYS = 7;

export interface PlanBalconyInput {
  site: UrbanSite;
  climate: UrbanClimate;
  cropIds: string[];
  areaM2: number;
  start: ISODate;
  horizonMonths?: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

function monthOfIso(iso: ISODate): number {
  return Number(iso.slice(5, 7));
}

function nextMonthStartIso(iso: ISODate, monthsAhead: number): ISODate {
  const y0 = Number(iso.slice(0, 4));
  const m0 = Number(iso.slice(5, 7)) - 1;
  const total = y0 * 12 + m0 + monthsAhead;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
}

function activeCalendarMonths(sow: ISODate, lastHarvest: ISODate): Set<number> {
  const out = new Set<number>();
  const y0 = Number(sow.slice(0, 4));
  const m0 = Number(sow.slice(5, 7)) - 1;
  const y1 = Number(lastHarvest.slice(0, 4));
  const m1 = Number(lastHarvest.slice(5, 7)) - 1;
  const startIdx = y0 * 12 + m0;
  const endIdx = Math.max(startIdx, y1 * 12 + m1);
  for (let idx = startIdx; idx <= endIdx && idx - startIdx < 12; idx++) {
    out.add(((idx % 12) + 12) % 12 + 1);
  }
  return out;
}

/**
 * Canopy / spacing area (m²) of a single plant used to compute per-plant `potWater`.
 * When `site.potDiameterCm` is given, uses the circular pot area; otherwise uses `(spacingCm / 100)²`.
 */
export function plantCanopyM2(crop: CropProfile, site: UrbanSite): number {
  if (site.potDiameterCm != null && site.potDiameterCm > 0) {
    return canopyFromPot(site.potDiameterCm);
  }
  const spacingCm = crop.urban?.spacingCm;
  if (spacingCm != null && spacingCm > 0) {
    return (spacingCm / 100) * (spacingCm / 100);
  }
  return 0;
}

function resolveHarvestType(crop: CropProfile): 'once' | 'cut-and-come-again' | 'repeated-fruit' {
  const u = crop.urban;
  if (u?.harvestType) return u.harvestType;
  if (u?.tags.includes('cut-and-come-again')) return 'cut-and-come-again';
  if (u?.tags.includes('fruit') || crop.category === 'fruit') return 'repeated-fruit';
  return 'once';
}

function resolveHarvestWindowDays(crop: CropProfile): [number, number] {
  const u = crop.urban;
  const base = u?.firstHarvestDays ?? crop.cycleDays;
  const dMin = Math.max(1, Math.round(base[0]));
  const dMax = Math.max(dMin, Math.round(base[1]));
  return [dMin, dMax];
}

function scheduleBatches(
  crop: CropProfile,
  plants: number,
  fits: number[],
  candidateDates: ISODate[],
): UrbanPlanBatch[] {
  const harvestType = resolveHarvestType(crop);
  const [dMin, dMax] = resolveHarvestWindowDays(crop);

  if (harvestType === 'once' && plants >= 2) {
    const maxB = Math.min(plants, MAX_SUCCESSION_BATCHES);
    for (let B = maxB; B >= 2; B--) {
      const stepDays = Math.max(MIN_BATCH_INTERVAL_DAYS, Math.round(dMin / B));
      // First try anchors where every batch falls in a good sowing month (sowFit >= SOW_FIT).
      for (const threshold of [SOW_FIT, MARGINAL_FIT]) {
        for (const anchor of candidateDates) {
          const sowDates = Array.from({ length: B }, (_, k) => addDays(anchor, k * stepDays));
          if (sowDates.every((d) => (fits[monthOfIso(d) - 1] ?? 0) >= threshold)) {
            const baseCount = Math.floor(plants / B);
            const rem = plants % B;
            return sowDates.map((sow, k) => {
              const fit = fits[monthOfIso(sow) - 1] ?? 0;
              return {
                sow,
                firstHarvest: addDays(sow, dMin),
                lastHarvest: addDays(sow, dMax),
                plants: baseCount + (k < rem ? 1 : 0),
                marginal: fit < SOW_FIT,
              };
            });
          }
        }
      }
    }
  }

  // Single batch (`cut-and-come-again`, `repeated-fruit`, `plants === 1`, or narrow season window).
  const anchor =
    candidateDates.find((d) => (fits[monthOfIso(d) - 1] ?? 0) >= SOW_FIT) ??
    candidateDates.find((d) => (fits[monthOfIso(d) - 1] ?? 0) >= MARGINAL_FIT)!;
  const fit = fits[monthOfIso(anchor) - 1] ?? 0;
  const lastOffset = harvestType === 'once' ? dMax : Math.max(dMax, dMin + 30);
  return [
    {
      sow: anchor,
      firstHarvest: addDays(anchor, dMin),
      lastHarvest: addDays(anchor, lastOffset),
      plants,
      marginal: fit < SOW_FIT,
    },
  ];
}

export function planBalcony(input: PlanBalconyInput): UrbanPlan {
  const { site, climate, cropIds, start } = input;
  const areaM2 = Math.max(0, r4(input.areaM2));
  const horizonMonths = Math.max(1, Math.min(12, Math.round(input.horizonMonths ?? 12)));
  const candidateDates: ISODate[] = [
    start,
    ...Array.from({ length: horizonMonths - 1 }, (_, i) => nextMonthStartIso(start, i + 1)),
  ];

  const urbanById = new Map<string, CropProfile>();
  for (const c of listUrbanCrops()) urbanById.set(c.id, c);

  const seen = new Set<string>();
  const uniqueIds: string[] = [];
  for (const id of cropIds) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  const unplaced: { cropId: string; reason: I18nText }[] = [];
  const notes: I18nText[] = [];
  const eligible: { crop: CropProfile; fits: number[]; spacingCm: number }[] = [];

  for (const id of uniqueIds) {
    const crop = urbanById.get(id) ?? getCrop(id);
    if (!crop || !crop.urban?.suitable) {
      unplaced.push({
        cropId: id,
        reason: tx(
          'Crop is not in the urban container catalogue.',
          'Cây không nằm trong danh mục trồng chậu đô thị.',
        ),
      });
      continue;
    }
    const spacingCm = crop.urban.spacingCm;
    if (spacingCm == null || !(spacingCm > 0)) {
      unplaced.push({
        cropId: id,
        reason: tx(
          'Missing sourced plant spacing (spacingCm in data/crops/atlas/urban.csv); area cannot be allocated without guessing.',
          'Thiếu khoảng cách cây có nguồn (spacingCm trong data/crops/atlas/urban.csv); không thể chia diện tích mà không đoán.',
        ),
      });
      continue;
    }
    const fits = Array.from({ length: 12 }, (_, i) => windowFit(crop, climate, i + 1).fit);
    const hasSuitableMonth = candidateDates.some((d) => (fits[monthOfIso(d) - 1] ?? 0) >= MARGINAL_FIT);
    if (!hasSuitableMonth) {
      unplaced.push({
        cropId: id,
        reason: tx(
          `No month in the ${horizonMonths}-month planning window reaches the minimum sowing suitability (sowFit >= ${MARGINAL_FIT}).`,
          `Không có tháng nào trong ${horizonMonths} tháng kế hoạch đạt ngưỡng phù hợp gieo tối thiểu (sowFit >= ${MARGINAL_FIT}).`,
        ),
      });
      continue;
    }
    eligible.push({ crop, fits, spacingCm });
  }

  const beds: UrbanPlanBed[] = [];
  const bedCrops = new Map<string, CropProfile>();
  const shareM2 = eligible.length > 0 ? areaM2 / eligible.length : 0;

  const monthlySun =
    site.facingDeg != null
      ? sunHoursByMonth(site.location[1], site.facingDeg, {
          horizonDeg: site.horizonDeg,
          overhangDeg: site.overhangDeg,
        })
      : null;

  for (const { crop, fits, spacingCm } of eligible) {
    const plantAreaM2 = (spacingCm / 100) * (spacingCm / 100);
    const plants = Math.floor((shareM2 + 1e-9) / plantAreaM2);
    if (plants < 1) {
      unplaced.push({
        cropId: crop.id,
        reason: tx(
          `Equal area share (${shareM2.toFixed(2)} m²) is smaller than one plant's spacing square (${plantAreaM2.toFixed(3)} m² for ${spacingCm} cm spacing).`,
          `Phần diện tích chia đều (${shareM2.toFixed(2)} m²) nhỏ hơn diện tích một gốc (${plantAreaM2.toFixed(3)} m² với khoảng cách ${spacingCm} cm).`,
        ),
      });
      continue;
    }

    const bedAreaM2 = r4(plants * plantAreaM2);
    const batches = scheduleBatches(crop, plants, fits, candidateDates);
    const name = tx(crop.names.en, crop.names.vi ?? crop.names.en);
    beds.push({
      cropId: crop.id,
      name,
      plants,
      areaM2: bedAreaM2,
      batches,
    });
    bedCrops.set(crop.id, crop);

    // Note skipped months (< MARGINAL_FIT) and marginal batches
    const skippedMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => (fits[m - 1] ?? 0) < MARGINAL_FIT);
    if (skippedMonths.length > 0) {
      notes.push(
        tx(
          `${crop.names.en}: skipped sowing in ${skippedMonths.map(monthEn).join(', ')} because climate fit is below ${MARGINAL_FIT}.`,
          `${name.vi}: bỏ qua gieo vào ${skippedMonths.map(monthVi).join(', ')} vì độ phù hợp khí hậu dưới ${MARGINAL_FIT}.`,
        ),
      );
    }
    if (batches.some((b) => b.marginal)) {
      notes.push(
        tx(
          `${crop.names.en}: one or more batches are scheduled in a marginal month (${MARGINAL_FIT} <= sowFit < ${SOW_FIT}); protect pots from temperature extremes.`,
          `${name.vi}: có lứa gieo vào tháng cận biên (${MARGINAL_FIT} <= sowFit < ${SOW_FIT}); cần che chắn chậu khi thời tiết khắc nghiệt.`,
        ),
      );
    }
    if (monthlySun) {
      const needSun = crop.urban?.sunHoursMin ?? (crop.urban?.light === 'full' ? 6 : crop.urban?.light === 'partial' ? 3 : 1);
      for (const b of batches) {
        const m = monthOfIso(b.sow);
        const haveSun = monthlySun[m - 1] ?? 0;
        if (haveSun < needSun) {
          const hStr = haveSun.toFixed(1).replace(/\.0$/, '');
          notes.push(
            tx(
              `Light warning for ${crop.names.en} in ${monthEn(m)}: balcony receives ~${hStr} h direct sun under clear skies, below the crop's minimum ${needSun} h.`,
              `Cảnh báo ánh sáng cho ${name.vi} vào ${monthVi(m)}: ban công chỉ có ~${hStr} giờ nắng trực tiếp khi trời quang, thấp hơn mức tối thiểu ${needSun} giờ của cây.`,
            ),
          );
        }
      }
    }
  }

  const usedM2 = r4(beds.reduce((sum, b) => sum + b.areaM2, 0));
  const unusedM2 = Math.max(0, r4(areaM2 - usedM2));
  if (beds.length > 0) {
    notes.unshift(
      tx(
        `Equal-share layout across ${beds.length} crop(s): ${usedM2.toFixed(2)} m² planted of ${areaM2.toFixed(2)} m² (${unusedM2.toFixed(2)} m² remainder after whole-plant rounding).`,
        `Chia đều diện tích cho ${beds.length} cây: đã xếp ${usedM2.toFixed(2)} m² trên tổng ${areaM2.toFixed(2)} m² (dư ${unusedM2.toFixed(2)} m² sau khi làm tròn xuống số gốc nguyên).`,
      ),
    );
  }

  // Precompute per-plant monthly potWater for each placed crop
  const perPlantWater = new Map<string, ReturnType<typeof potWater>>();
  for (const [id, crop] of bedCrops.entries()) {
    const canopyM2 = plantCanopyM2(crop, site);
    perPlantWater.set(id, canopyM2 > 0 ? potWater(crop, climate, { canopyM2 }) : []);
  }

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const tasks: I18nText[] = [];
    let minWater = 0;
    let maxWater = 0;
    let anyActive = false;

    for (const bed of beds) {
      let activePlantsInMonth = 0;
      for (const batch of bed.batches) {
        const sowM = monthOfIso(batch.sow);
        const firstHarvM = monthOfIso(batch.firstHarvest);
        if (sowM === m) {
          tasks.push(
            tx(
              `Sow ${batch.plants} ${bed.name.en} on ${batch.sow}${batch.marginal ? ' (marginal month)' : ''}`,
              `Gieo ${batch.plants} gốc ${bed.name.vi} ngày ${batch.sow}${batch.marginal ? ' (tháng cận biên)' : ''}`,
            ),
          );
        }
        if (firstHarvM === m) {
          tasks.push(
            tx(
              `Harvest ${bed.name.en} (${batch.firstHarvest} to ${batch.lastHarvest})`,
              `Thu hoạch ${bed.name.vi} (${batch.firstHarvest} đến ${batch.lastHarvest})`,
            ),
          );
        }
        const activeSet = activeCalendarMonths(batch.sow, batch.lastHarvest);
        if (activeSet.has(m)) {
          activePlantsInMonth += batch.plants;
        }
      }
      if (activePlantsInMonth > 0) {
        anyActive = true;
        const pw = perPlantWater.get(bed.cropId);
        const pm = pw?.find((x) => x.month === m);
        if (pm) {
          minWater += activePlantsInMonth * pm.litresMin;
          maxWater += activePlantsInMonth * pm.litresMax;
        }
      }
    }

    return {
      month: m,
      tasks,
      ...(anyActive ? { waterLitresPerDay: [r2(minWater), r2(maxWater)] as [number, number] } : { waterLitresPerDay: [0, 0] as [number, number] }),
    };
  });

  return {
    start,
    areaM2,
    usedM2,
    beds,
    months,
    unplaced,
    notes,
  };
}
