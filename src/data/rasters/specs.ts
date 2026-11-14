/**
 * The dated rasters: which collection, which assets, how a cell value is computed, and how it is
 * encoded. Value functions receive the per-asset arrays of one scene and return null for no data.
 */
import type { BranchId, I18nText, RampId } from '@/contracts';
import { tx } from '@/contracts';
import { landsatClear, landsatLstC, normDiff, s2Offset, s2Reflectance, sclValid } from './pure';

export interface DatedSpec {
  key: string;
  branch: BranchId;
  label: I18nText;
  unit: string;
  sourceId: string;
  ramp: RampId;
  collection: string;
  assets: string[];
  targetM: number;
  maxCloud: number;
  extraQuery?: Record<string, unknown>;
  scale: number;
  offset: number;
  /** Display range; `fitRange` widens or narrows it to the scenes found. */
  range: [number, number];
  fitRange?: boolean;
  /** Build a per-cell value function for one scene (scene properties carry the S2 baseline). */
  cell: (props: Record<string, unknown>) => (bands: Float64Array[], i: number) => number | null;
}

export const NDVI: DatedSpec = {
  key: 'ndvi',
  branch: 'vegetation',
  label: tx('NDVI, Sentinel-2 (10 m)', 'NDVI, Sentinel-2 (10 m)'),
  unit: 'NDVI',
  sourceId: 'sentinel-2-l2a',
  ramp: 'vegetation',
  collection: 'sentinel-2-l2a',
  assets: ['B04', 'B08', 'SCL'],
  targetM: 10,
  maxCloud: 60,
  scale: 2 / 254,
  offset: -1,
  range: [0, 1],
  cell: (props) => {
    const off = s2Offset(props.baseline as string | undefined);
    return ([red, nir, scl], i) => (sclValid(scl[i]) ? normDiff(s2Reflectance(nir[i], off), s2Reflectance(red[i], off)) : null);
  },
};

export const NDMI: DatedSpec = {
  key: 'ndmi',
  branch: 'soilMoisture',
  label: tx('Canopy and surface moisture index (NDMI), Sentinel-2 (20 m)', 'Chỉ số ẩm tán lá và bề mặt (NDMI), Sentinel-2 (20 m)'),
  unit: 'NDMI',
  sourceId: 'sentinel-2-l2a',
  ramp: 'moisture',
  collection: 'sentinel-2-l2a',
  assets: ['B8A', 'B11', 'SCL'],
  targetM: 20,
  maxCloud: 60,
  scale: 2 / 254,
  offset: -1,
  range: [-0.4, 0.6],
  cell: (props) => {
    const off = s2Offset(props.baseline as string | undefined);
    return ([nir, swir, scl], i) => (sclValid(scl[i]) ? normDiff(s2Reflectance(nir[i], off), s2Reflectance(swir[i], off)) : null);
  },
};

export const LST: DatedSpec = {
  key: 'lst',
  branch: 'thermal',
  label: tx('Land surface temperature, Landsat 8/9 (30 m)', 'Nhiệt độ bề mặt đất, Landsat 8/9 (30 m)'),
  unit: '°C',
  sourceId: 'landsat-c2-l2-st',
  ramp: 'heat',
  collection: 'landsat-c2-l2',
  assets: ['lwir11', 'qa_pixel'],
  targetM: 30,
  maxCloud: 60,
  extraQuery: { platform: { in: ['landsat-8', 'landsat-9'] } },
  scale: 0.4,
  offset: -40,
  range: [0, 50],
  fitRange: true,
  cell: () => ([st, qa], i) => (landsatClear(qa[i]) ? landsatLstC(st[i]) : null),
};

export const DATED_SPECS = [NDVI, NDMI, LST];
