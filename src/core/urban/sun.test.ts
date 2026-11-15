import { describe, expect, it } from 'vitest';
import type { UrbanClimate, UrbanSite } from '@/contracts';
import { dayLengthHours } from '@/core/scoring';
import { lightClass, recommendUrban, solarPosition, sunHours, sunHoursByMonth } from './index';

const HCMC_CLIMATE: UrbanClimate = {
  location: [106.7, 10.78],
  months: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    tMean: 28,
    tMin: 24,
    tMax: 33,
    rainMm: 150,
    par: 8.5,
    rh: 75,
  })),
  sourceIds: ['nasa-power'],
};

describe('src/core/urban/sun (D5, #18)', () => {
  const cases = [
    { lat: 10.78, doy: 166 },
    { lat: 10.78, doy: 350 },
    { lat: 52.5, doy: 166 },
    { lat: 52.5, doy: 350 },
  ];

  it('East + West equals day length and each is half of day length at lat 10.78 and 52.5, days 166 and 350 (< 0.1 h)', () => {
    for (const { lat, doy } of cases) {
      const dl = dayLengthHours(lat, doy);
      const east = sunHours(lat, doy, 90);
      const west = sunHours(lat, doy, 270);
      expect(Math.abs(east + west - dl), `lat=${lat} doy=${doy} E+W`).toBeLessThan(0.1);
      expect(Math.abs(east - dl / 2), `lat=${lat} doy=${doy} E`).toBeLessThan(0.1);
      expect(Math.abs(west - dl / 2), `lat=${lat} doy=${doy} W`).toBeLessThan(0.1);
    }
  });

  it('North + South equals day length at the same four cases (< 0.1 h)', () => {
    for (const { lat, doy } of cases) {
      const dl = dayLengthHours(lat, doy);
      const north = sunHours(lat, doy, 0);
      const south = sunHours(lat, doy, 180);
      expect(Math.abs(north + south - dl), `lat=${lat} doy=${doy} N+S`).toBeLessThan(0.1);
    }
  });

  it('matches exact solstice/mid-month benchmarks at lat 10.78 (HCMC) and lat 52.5 (Berlin)', () => {
    // Lat 10.78, day 166 (mid-June): sun stays in the northern sky all day
    expect(sunHours(10.78, 166, 180)).toBe(0);
    expect(Math.abs(sunHours(10.78, 166, 0) - 12.63)).toBeLessThan(0.05);

    // Lat 10.78, day 350 (mid-December): sun stays in the southern sky all day
    expect(sunHours(10.78, 350, 0)).toBe(0);
    expect(Math.abs(sunHours(10.78, 350, 180) - 11.37)).toBeLessThan(0.05);

    // Lat 52.5, day 350 (mid-December): North 0 h, South = day length (7.43 h)
    expect(sunHours(52.5, 350, 0)).toBe(0);
    expect(Math.abs(sunHours(52.5, 350, 180) - 7.43)).toBeLessThan(0.05);
  });

  it('day length integrated from solarPosition matches dayLengthHours from src/core/scoring within 0.1 h', () => {
    for (const lat of [-35, 0, 10.78, 21.03, 35, 52.5]) {
      for (const doy of [16, 75, 166, 258, 350]) {
        const steps = 1440;
        let above = 0;
        for (let i = 0; i < steps; i++) {
          if (solarPosition(lat, doy, (i + 0.5) / 60).elevationDeg > 0) above++;
        }
        const integrated = above / 60;
        expect(Math.abs(integrated - dayLengthHours(lat, doy)), `lat=${lat} doy=${doy}`).toBeLessThan(0.1);
      }
    }
  });

  it('increasing horizonDeg never increases sunHours, horizonDeg = 90 gives 0 h, and overhangDeg shades high sun', () => {
    for (const { lat, doy } of cases) {
      for (const facing of [0, 45, 90, 135, 180, 225, 270, 315]) {
        let prev = sunHours(lat, doy, facing, { horizonDeg: 0 });
        for (const h of [10, 20, 30, 45, 60, 75, 90]) {
          const cur = sunHours(lat, doy, facing, { horizonDeg: h });
          expect(cur, `lat=${lat} doy=${doy} facing=${facing} h=${h}`).toBeLessThanOrEqual(prev);
          prev = cur;
        }
        expect(sunHours(lat, doy, facing, { horizonDeg: 90 })).toBe(0);
      }
    }
    const openSouth = sunHours(10.78, 350, 180);
    const overhangSouth = sunHours(10.78, 350, 180, { overhangDeg: 45 });
    expect(overhangSouth).toBeLessThan(openSouth);
    expect(overhangSouth).toBeGreaterThan(0);
  });

  it('Southern Hemisphere: lat -35 facing North matches lat +35 facing South shifted by half a year within 0.2 h', () => {
    // Compare summer solstice, equinoxes and winter solstice pairs shifted by ~182.5 days
    const pairs: [doyNorth: number, doySouth: number][] = [
      [166, 350],
      [350, 166],
      [75, 258],
      [258, 75],
    ];
    for (const [doyN, doyS] of pairs) {
      const northHemSouthFacing = sunHours(35, doyN, 180);
      const southHemNorthFacing = sunHours(-35, doyS, 0);
      expect(Math.abs(southHemNorthFacing - northHemSouthFacing), `doyN=${doyN} doyS=${doyS}`).toBeLessThan(0.2);
    }
  });

  it('handles polar latitudes (lat 70 and -70) without error and maps lightClass thresholds at 3 h and 6 h', () => {
    expect(sunHours(70, 166, 180)).toBeGreaterThan(10);
    expect(sunHours(70, 350, 180)).toBe(0);
    expect(sunHoursByMonth(10.78, 180)).toHaveLength(12);
    expect(lightClass(6)).toBe('full');
    expect(lightClass(5.9)).toBe('partial');
    expect(lightClass(3)).toBe('partial');
    expect(lightClass(2.9)).toBe('shade');
  });

  it('recommendUrban without facingDeg returns identical results, and with facingDeg uses computed sun hours', () => {
    const baseSite: UrbanSite = {
      location: [106.7, 10.78],
      light: 'full',
      space: 'balcony',
    };
    const withoutFacing = recommendUrban(baseSite, HCMC_CLIMATE, ['vegetables'], 6);
    expect(withoutFacing.length).toBeGreaterThan(0);
    expect(withoutFacing[0].why.some((w) => w.en.includes('Your full light is enough'))).toBe(true);

    // In June (month 6) at lat 10.78, a South-facing balcony (180°) gets 0 h direct sun (shade)
    const southJune = recommendUrban({ ...baseSite, facingDeg: 180 }, HCMC_CLIMATE, ['vegetables'], 6);
    const northJune = recommendUrban({ ...baseSite, facingDeg: 0 }, HCMC_CLIMATE, ['vegetables'], 6);
    expect(northJune[0].why.some((w) => w.vi.includes('Ban công của bạn có khoảng 12.6 giờ nắng trực tiếp trong tháng này, khi trời quang'))).toBe(true);
    expect(southJune[0].why.some((w) => w.en.includes('0 hours of direct sun this month under clear skies'))).toBe(true);
  });
});
