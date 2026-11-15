import { describe, expect, it } from 'vitest';
import type { LngLat } from '@/contracts';
import { centerParcelOutline, type CameraPose } from './camera';

const pose: CameraPose = {
  center: [106, 10],
  zoom: 17,
  pitch: 0,
  bearing: 0,
  padding: { top: 96, left: 648, right: 64, bottom: 96 },
};

const ring: LngLat[] = [
  [105.999, 9.999],
  [106.001, 9.999],
  [106.001, 10.001],
  [105.999, 10.001],
];

describe('centre the parcel outline', () => {
  it('leaves a symmetric ring centred in a top-down view', () => {
    const [lng, lat] = centerParcelOutline(ring, pose, 900);
    expect(lng).toBeCloseTo(106, 8);
    expect(lat).toBeCloseTo(10, 8);
  });

  it('moves the pitched target towards the near edge before the flight', () => {
    const [lng, lat] = centerParcelOutline(ring, { ...pose, pitch: 54 }, 900);
    expect(lng).toBeCloseTo(106, 8);
    expect(lat).toBeLessThan(10);
    expect(lat).toBeGreaterThan(9.999);
  });
});
