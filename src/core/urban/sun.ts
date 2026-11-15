/**
 * Direct-beam solar geometry for vertical balconies and walls (D5, #18).
 *
 * Pure module with no runtime imports.
 *
 * Sign and angle conventions:
 *   - Latitude `latDeg`: degrees, positive North, negative South (-90..90).
 *   - Day of year `doy`: 1 = January 1 .. 365 = December 31.
 *   - `solarHour`: local apparent solar time in hours (0..24; 12 = solar noon).
 *   - Azimuth `azimuthDeg` and `facingDeg`: compass bearing in degrees clockwise from North:
 *       0° = North, 45° = NE, 90° = East, 135° = SE, 180° = South, 225° = SW, 270° = West, 315° = NW.
 *     Note conversion from Duffie & Beckman's South-zero convention (γ_s = 0° at South, positive West):
 *       ψ_compass = (γ_s + 180°) mod 360°.
 *
 * Published equations and sources:
 *   1. Solar declination δ (rad):
 *        δ = 0.409 * sin((2π / 365) * J - 1.39)
 *      Source: Allen et al. (1998), FAO Irrigation and Drainage Paper No. 56, Chapter 3, Eq. 24
 *      (same formula used in `src/core/scoring/index.ts` for `dayLengthHours`).
 *   2. Hour angle ω (rad):
 *        ω = (π / 12) * (solarHour - 12)
 *      Negative in the morning, zero at solar noon, positive in the afternoon
 *      (Duffie & Beckman, "Solar Engineering of Thermal Processes", 4th ed., Wiley, 2013, §1.6).
 *   3. Solar altitude (elevation) angle α and zenith angle θ_z = 90° - α:
 *        sin(α) = cos(θ_z) = sin(φ) sin(δ) + cos(φ) cos(δ) cos(ω)
 *      Source: Duffie & Beckman (4th ed., 2013), Chapter 1, Eq. 1.6.5.
 *   4. Solar compass azimuth ψ (0° = North, clockwise):
 *      In local East-North-Up (ENU) coordinates pointing toward the sun:
 *        s_E = -cos(δ) sin(ω)
 *        s_N =  cos(φ) sin(δ) - sin(φ) cos(δ) cos(ω)
 *        ψ   = (atan2(s_E, s_N) * 180 / π + 360) mod 360
 *      Equivalent to Duffie & Beckman (4th ed., 2013), Eq. 1.6.6 shifted by +180° to North-zero,
 *      and NOAA Global Monitoring Laboratory "Solar Calculation Details" (Meeus, 1998).
 *   5. Angle of incidence θ on a vertical surface (slope β = 90°) facing compass azimuth β_face:
 *        cos(θ) = cos(α) cos(ψ - β_face)
 *      Source: Duffie & Beckman (4th ed., 2013), Eq. 1.6.3 with β = 90°. The sun is in front of the
 *      balcony plane when cos(θ) > 0.
 *   6. Profile angle α_p for an overhead projection / balcony overhang (Duffie & Beckman, 4th ed.,
 *      2013, §1.6 Eq. 1.6.12 and §1.9 Eq. 1.9.3):
 *        tan(α_p) = tan(α) / cos(ψ - β_face)
 *      When `overhangDeg` is specified, direct beam reaches the balcony only while α_p <= overhangDeg.
 */
import type { CropUrbanTraits } from '@/contracts';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Representative mid-month days of the year (Jan 16 .. Dec 16), matching `src/core/scoring/index.ts` and Duffie & Beckman Table 1.6.1. */
export const MID_DOY: readonly number[] = [16, 45, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350];

export interface SolarPosition {
  /** Solar altitude above the astronomical horizon, degrees (-90..90). */
  elevationDeg: number;
  /** Solar compass azimuth in degrees clockwise from North (0..360, 0 = N, 90 = E, 180 = S, 270 = W). */
  azimuthDeg: number;
}

export interface SunHoursOptions {
  /** Elevation angle of opposing buildings or horizon obstructions in front of the balcony, degrees (default 0). */
  horizonDeg?: number;
  /** Profile angle cutoff of an overhead roof or upper balcony, degrees (optional, 0..90). */
  overhangDeg?: number;
  /** Integration time step in minutes across the 24-hour solar day (default 1). */
  stepMin?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Solar altitude (`elevationDeg`) and compass azimuth (`azimuthDeg`, 0° = North, clockwise)
 * at latitude `latDeg`, day of year `doy` (1..365) and local solar hour `solarHour` (0..24).
 */
export function solarPosition(latDeg: number, doy: number, solarHour: number): SolarPosition {
  const phi = clamp(latDeg, -90, 90) * DEG_TO_RAD;
  const decl = 0.409 * Math.sin(((2 * Math.PI) / 365) * doy - 1.39);
  const omega = (Math.PI / 12) * (solarHour - 12);

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinDecl = Math.sin(decl);
  const cosDecl = Math.cos(decl);
  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);

  const sinAlpha = clamp(sinPhi * sinDecl + cosPhi * cosDecl * cosOmega, -1, 1);
  const elevationDeg = Math.asin(sinAlpha) * RAD_TO_DEG;

  const sEast = -cosDecl * sinOmega;
  const sNorth = cosPhi * sinDecl - sinPhi * cosDecl * cosOmega;
  const rawAzimuth = Math.atan2(sEast, sNorth) * RAD_TO_DEG;
  const azimuthDeg = ((rawAzimuth % 360) + 360) % 360;

  return { elevationDeg, azimuthDeg };
}

/**
 * Direct-sun hours on a vertical balcony facing `facingDeg` (0° = North, 90° = East, 180° = South,
 * 270° = West) on day `doy` at latitude `latDeg`, under clear skies.
 */
export function sunHours(latDeg: number, doy: number, facingDeg: number, opts?: SunHoursOptions): number {
  const horizonDeg = Math.max(0, opts?.horizonDeg ?? 0);
  if (horizonDeg >= 90) return 0;
  const overhangDeg = opts?.overhangDeg;
  if (overhangDeg != null && overhangDeg <= 0) return 0;

  const stepMin = opts?.stepMin && opts.stepMin > 0 ? opts.stepMin : 1;
  const steps = Math.max(24, Math.round((24 * 60) / stepMin));
  const dtHours = 24 / steps;
  const faceRad = facingDeg * DEG_TO_RAD;

  let totalHours = 0;
  for (let i = 0; i < steps; i++) {
    const solarHour = (i + 0.5) * dtHours;
    const { elevationDeg, azimuthDeg } = solarPosition(latDeg, doy, solarHour);
    if (elevationDeg <= horizonDeg) continue;

    const alphaRad = elevationDeg * DEG_TO_RAD;
    const cosAlpha = Math.cos(alphaRad);
    const cosDeltaAz = Math.cos(azimuthDeg * DEG_TO_RAD - faceRad);
    const cosTheta = cosAlpha * cosDeltaAz;
    if (cosTheta <= 1e-9) continue;

    if (overhangDeg != null) {
      const profileDeg = Math.atan2(Math.sin(alphaRad), cosTheta) * RAD_TO_DEG;
      if (profileDeg > overhangDeg) continue;
    }

    totalHours += dtHours;
  }

  return Math.round(totalHours * 100) / 100;
}

/**
 * Direct-sun hours per day for each of the 12 calendar months (evaluated at the representative
 * mid-month days `MID_DOY`).
 */
export function sunHoursByMonth(latDeg: number, facingDeg: number, opts?: SunHoursOptions): number[] {
  return MID_DOY.map((doy) => sunHours(latDeg, doy, facingDeg, opts));
}

/**
 * Maps direct-sun hours per day to the three urban light classes (`full` >= 6 h,
 * `partial` 3..6 h, `shade` < 3 h) used by `src/ui/urban/strings.ts` and `src/core/urban/index.ts`.
 */
export function lightClass(hours: number): CropUrbanTraits['light'] {
  if (hours >= 6) return 'full';
  if (hours >= 3) return 'partial';
  return 'shade';
}
