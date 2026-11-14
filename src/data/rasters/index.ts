/**
 * Within-field rasters (10-30 m) for a parcel: Sentinel-2 NDVI and NDMI, Landsat surface
 * temperature, Terrarium elevation and slope. Demo parcels read `public/data/samples/<id>.rasters.json`;
 * any other parcel is fetched live from the Planetary Computer, one small request per scene.
 *
 * Every frame is one real acquisition date. Cloudy dates are absent, never filled.
 */
import type { FieldRaster, FieldRasterFrame, ISODate, Parcel } from '@/contracts';
import { encodeFrame } from '@/lib/raster';
import { addDays, todayISO } from '@/lib/time';
import { viteEnv } from '../env';
import { getJson, isAbort, mapLimit } from '../http';
import { fetchScene, searchScenes, type PcScene } from './pc';
import { band, binScenes, makeGrid, quantise, type RasterGrid } from './pure';
import { DATED_SPECS, type DatedSpec } from './specs';
import { terrainRasters } from './terrain';

export interface RasterLoadOptions {
  signal?: AbortSignal;
  today?: ISODate;
  /** Upper bound on dated frames per raster for live loading. */
  maxFrames?: number;
  /** Called whenever a raster gains a frame, with every raster loaded so far (newest scenes first). */
  onProgress?: (rasters: FieldRaster[]) => void;
}

/** A scene is skipped when less than this share of the parcel is valid. */
const MIN_COVERAGE = 0.7;
/** Clearest-first candidates tried per bin before giving up on it. */
const TRIES_PER_BIN = 3;

export async function loadFieldRasters(parcel: Parcel, opts: RasterLoadOptions = {}): Promise<FieldRaster[]> {
  if (parcel.source === 'sample') {
    try {
      const base = viteEnv().BASE_URL ?? '/';
      const cachedR = await getJson<FieldRaster[]>(`${base}data/samples/${parcel.id}.rasters.json`, { signal: opts.signal, timeoutMs: 20_000, retries: 1 });
      opts.onProgress?.(cachedR);
      return cachedR;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      // No demo cache: fall through to live.
    }
  }
  return loadLiveRasters(parcel, opts);
}

export async function loadLiveRasters(parcel: Parcel, opts: RasterLoadOptions = {}): Promise<FieldRaster[]> {
  const today = opts.today ?? todayISO();
  const out = new Map<string, FieldRaster>();
  const order = ['ndvi', 'ndmi', 'lst', 'elevation', 'slope'];
  const publish = () => opts.onProgress?.(order.map((k) => out.get(k)).filter((r): r is FieldRaster => !!r));

  const terrain = terrainRasters(parcel, today, opts.signal)
    .then((rs) => {
      for (const r of rs) out.set(r.key, r);
      publish();
    })
    .catch((e) => {
      if (isAbort(e)) throw e;
      console.warn('[rasters] terrain failed:', (e as Error).message);
    });

  const dated = DATED_SPECS.map((spec) =>
    datedRaster(parcel, spec, today, opts, (r) => {
      out.set(r.key, r);
      publish();
    }).catch((e) => {
      if (isAbort(e)) throw e;
      console.warn(`[rasters] ${spec.key} failed:`, (e as Error).message);
    }),
  );
  await Promise.all([terrain, ...dated]);
  const all = order.map((k) => out.get(k)).filter((r): r is FieldRaster => !!r && r.frames.length > 0);
  return all;
}

/** Build one dated raster, newest bin first, calling `emit` after every frame. */
async function datedRaster(parcel: Parcel, spec: DatedSpec, today: ISODate, opts: RasterLoadOptions, emit: (r: FieldRaster) => void): Promise<FieldRaster> {
  const maxFrames = opts.maxFrames ?? 12;
  const days = 365;
  const start = addDays(today, -(days - 1));
  const grid = makeGrid(parcel, spec.targetM);
  const scenes = await searchScenes(spec.collection, parcel.centroid, start, today, spec.maxCloud, opts.signal, spec.extraQuery);
  const binDays = Math.max(15, Math.ceil(days / maxFrames));
  const bins = binScenes(scenes, today, days, binDays).slice(0, maxFrames);
  const frames: FieldRasterFrame[] = [];
  const raster: FieldRaster = {
    key: spec.key,
    branch: spec.branch,
    label: spec.label,
    unit: spec.unit,
    sourceId: spec.sourceId,
    ramp: spec.ramp,
    cellM: grid.cellM,
    width: grid.width,
    height: grid.height,
    corners: grid.corners,
    scale: spec.scale,
    offset: spec.offset,
    range: spec.range,
    cadence: '16-day',
    frames,
  };
  const means: number[] = [];
  await mapLimit(bins, 2, async (bin) => {
    for (const scene of bin.slice(0, TRIES_PER_BIN)) {
      try {
        const f = await sceneFrame(spec, scene as PcScene, grid, opts.signal);
        if (!f || f.coverage < MIN_COVERAGE) continue;
        frames.push(f.frame);
        if (f.values) means.push(...f.values);
        frames.sort((a, b) => (a.t < b.t ? -1 : 1));
        if (spec.fitRange) raster.range = fitRange(means, spec.range);
        emit({ ...raster, frames: [...frames] });
        return;
      } catch (e) {
        if (isAbort(e)) throw e;
        console.warn(`[rasters] ${spec.key} ${scene.id}:`, (e as Error).message);
      }
    }
  });
  return raster;
}

async function sceneFrame(spec: DatedSpec, scene: PcScene, grid: RasterGrid, signal?: AbortSignal): Promise<{ frame: FieldRasterFrame; coverage: number; values?: number[] } | null> {
  const arr = await fetchScene(spec.collection, scene.id, spec.assets, grid, signal);
  const bands = spec.assets.map((_, b) => band(arr, b));
  const mask = band(arr, spec.assets.length);
  const f = spec.cell(scene.props);
  const values = new Array<number | null>(grid.width * grid.height);
  for (let i = 0; i < values.length; i++) values[i] = mask[i] > 0 ? f(bands, i) : null;
  const q = quantise(values, grid, spec);
  const inside = spec.fitRange ? values.filter((v, i): v is number => v != null && grid.inside[i] === 1) : undefined;
  return { frame: { t: scene.t, data: encodeFrame(q.bytes), coverage: q.coverage, scene: scene.id }, coverage: q.coverage, values: inside };
}

/** 2nd-98th percentile of the values seen, rounded out to 5 units; the default when too few. */
export function fitRange(values: number[], fallback: [number, number]): [number, number] {
  if (values.length < 20) return fallback;
  const s = [...values].sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  const lo = Math.floor(p(0.02) / 5) * 5;
  const hi = Math.ceil(p(0.98) / 5) * 5;
  return hi > lo ? [lo, hi] : fallback;
}
