/**
 * Monthly sowing-window climate suitability for the Urban Grower Companion (`docs/ADVISORY.md §4.4`).
 *
 * Evaluates a sowing month across the crop's container growing window (`min(windowMonths(c), 6)` months)
 * by decomposing suitability into four interpretable components:
 *   - `mean`: EcoCrop trapezoid on monthly mean temperature `tMean` (`c.req.tempC`).
 *   - `cold`: night-frost and chilling check on monthly mean daily minimum `tMin` against `killTempC`
 *     (with the Ramirez-Villegas et al. 2013 `KILL_MARGIN_C = 4 °C` buffer because the coldest night of
 *     a month lies below the monthly mean minimum) and against `c.req.tempC[0]` (`T_absMin`).
 *   - `heat`: afternoon heat-stress check on monthly mean daily maximum `tMax` above `c.req.tempC[3]` (`T_absMax`).
 *   - `photo`: soft photoperiod factor (`PHOTOPERIOD_MIN = 0.7` floor) comparing mid-month astronomical
 *     day length `dayLengthHours(latDeg, doy)` (FAO-56 Eq. 24, 25, 34) with `c.req.photoperiod`
 *     (`short` < 12 h, `neutral` 12–14 h, `long` > 14 h).
 *
 * Relative humidity (`rh`) is carried on `UrbanClimateMonth` for display/water context only and is not
 * scored here because FAO EcoCrop / `data/crops/atlas/columns.csv` has no crop humidity threshold column.
 */
import type { CropProfile, I18nText, UrbanClimate } from '@/contracts';
import { tx } from '@/contracts';
import { monthsFrom } from '@/core/advisory/util';
import { dayLengthHours, trapezoid, windowMonths } from '@/core/scoring';
import { MID_DOY } from './sun';

/**
 * Ramirez-Villegas et al. (2013, Agric. For. Meteorol. 170:67–78): because `tMin` is the monthly mean
 * of daily minimum temperatures, a month with `tMin <= killTempC + 4 °C` typically contains a killing night.
 */
export const KILL_MARGIN_C = 4;

/** Chilling ramp below `tempC[0]` (`T_absMin`, °C) for monthly mean daily minimum `tMin`. */
export const COLD_MARGIN_C = 4;

/** Heat-stress ramp above `tempC[3]` (`T_absMax`, °C) for monthly mean daily maximum `tMax`. */
export const HEAT_MARGIN_C = 6;

/** Soft floor when no month in the window matches the crop's EcoCrop photoperiod class (matches `GATE.photoperiodMin`). */
export const PHOTOPERIOD_MIN = 0.7;

export type ClimateLimitingFactor = 'mean' | 'cold' | 'heat' | 'photo' | null;

export interface WindowFitDetail {
  /** Combined suitability in `[0, 1]`: `Math.min(mean, cold, heat) * photo`. */
  fit: number;
  /** Worst-month mean temperature trapezoid score in `[0, 1]`. */
  mean: number;
  /** Worst-month night cold / frost survival score in `[0, 1]`. */
  cold: number;
  /** Worst-month daytime heat score in `[0, 1]`. */
  heat: number;
  /** Soft photoperiod factor in `[PHOTOPERIOD_MIN, 1]`. */
  photo: number;
  /** Primary limiting component when `fit < 1`, or `null` when all components are `1`. */
  limiting: ClimateLimitingFactor;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function monthColdScore(tMin: number, absMinC: number, killTempC?: number | null): number {
  let killScore = 1;
  if (killTempC != null && Number.isFinite(killTempC)) {
    if (tMin <= killTempC) {
      killScore = 0.1;
    } else if (tMin <= killTempC + KILL_MARGIN_C) {
      // At killTempC + KILL_MARGIN_C (4 °C), score reaches 0.55 (< SOW_FIT = 0.6), preventing winter sowing of frost-tender crops.
      killScore = 0.1 + 0.45 * ((tMin - killTempC) / KILL_MARGIN_C);
    } else if (tMin < killTempC + KILL_MARGIN_C + 2) {
      killScore = 0.55 + 0.45 * ((tMin - (killTempC + KILL_MARGIN_C)) / 2);
    }
  }
  let baseScore = 1;
  if (tMin <= absMinC - COLD_MARGIN_C) {
    baseScore = 0.1;
  } else if (tMin < absMinC) {
    baseScore = 0.1 + 0.9 * ((tMin - (absMinC - COLD_MARGIN_C)) / COLD_MARGIN_C);
  }
  return Math.min(killScore, baseScore);
}

function monthHeatScore(tMax: number, absMaxC: number): number {
  if (tMax <= absMaxC) return 1;
  return clamp(1 - (tMax - absMaxC) / HEAT_MARGIN_C, 0, 1);
}

export function photoperiodClass(dayHours: number): 'short' | 'neutral' | 'long' {
  return dayHours < 12 ? 'short' : dayHours <= 14 ? 'neutral' : 'long';
}

/**
 * Evaluates sowing-window climate suitability starting in `start` (1..12) and returns both the
 * composite `fit` and its four constituent scores (`mean`, `cold`, `heat`, `photo`) plus `limiting`.
 */
export function windowFit(c: CropProfile, climate: UrbanClimate, start: number): WindowFitDetail {
  const n = windowMonths(c);
  const ms = monthsFrom(start, Math.min(n, 6))
    .map((m) => climate.months.find((x) => x.month === m))
    .filter((x) => x != null);
  if (!ms.length) {
    return { fit: 0, mean: 0, cold: 0, heat: 0, photo: 1, limiting: 'mean' };
  }

  const latDeg = climate.location[1];
  const photoClasses = c.req.photoperiod;
  const checkPhoto = Boolean(photoClasses?.length && photoClasses.length < 3);

  let mean = 1;
  let cold = 1;
  let heat = 1;
  let photoHits = 0;

  for (const m of ms) {
    mean = Math.min(mean, trapezoid(m.tMean, c.req.tempC));
    cold = Math.min(cold, monthColdScore(m.tMin, c.req.tempC[0], c.req.killTempC));
    heat = Math.min(heat, monthHeatScore(m.tMax, c.req.tempC[3]));
    if (checkPhoto) {
      const doy = MID_DOY[(m.month - 1 + 12) % 12] ?? 182;
      const dl = dayLengthHours(latDeg, doy);
      if (photoClasses!.includes(photoperiodClass(dl))) photoHits++;
    }
  }

  const photo = checkPhoto ? PHOTOPERIOD_MIN + (1 - PHOTOPERIOD_MIN) * (photoHits / ms.length) : 1;
  const thermal = Math.min(mean, cold, heat);
  const fit = clamp(thermal * photo, 0, 1);

  let limiting: ClimateLimitingFactor = null;
  const entries: Array<[Exclude<ClimateLimitingFactor, null>, number]> = [
    ['cold', cold],
    ['heat', heat],
    ['mean', mean],
    ['photo', photo],
  ];
  let worst = 1;
  for (const [k, v] of entries) {
    if (v < worst) {
      worst = v;
      limiting = k;
    }
  }

  return { fit, mean, cold, heat, photo, limiting };
}

/**
 * Bilingual explanation of the limiting factor when a month's `fit < SOW_FIT`.
 */
export function climateLimitingReason(detail: WindowFitDetail): I18nText | null {
  switch (detail.limiting) {
    case 'cold':
      return tx(
        'Night temperatures in this sowing window are too cold or risk frost.',
        'Nhiệt độ ban đêm trong vụ gieo này quá lạnh hoặc có nguy cơ sương giá.',
      );
    case 'heat':
      return tx(
        'Daytime highs in this sowing window exceed the crop’s heat limit.',
        'Nhiệt độ cao nhất ban ngày trong vụ gieo này vượt ngưỡng chịu nóng của cây.',
      );
    case 'mean':
      return tx(
        'Mean temperatures in this sowing window are outside its optimal range.',
        'Nhiệt độ trung bình trong vụ gieo này nằm ngoài khoảng thích hợp của cây.',
      );
    case 'photo':
      return tx(
        'Day length in this sowing window does not match its photoperiod preference.',
        'Độ dài ngày trong vụ gieo này chưa khớp với yêu cầu quang chu kỳ của cây.',
      );
    default:
      return null;
  }
}
