/**
 * Tier 1 + 2 public API: acquire NASA and partner data for a parcel, harmonise it in space and
 * time, and hand back one `FieldTelemetry`.
 *
 *   mode 'auto'   demo parcel → cached JSON (public/data/samples/<id>.json); anything else → live
 *   mode 'live'   live adapters (src/data/live), progressive
 *   mode 'cached' cached JSON only
 *   mode 'mock'   simulated, labelled telemetry
 * The mock is also the last resort when every live source fails, and says so on every branch.
 */
import type { BranchId, FieldTelemetry, ISODate, Lang, LngLat, Parcel, PlaceHit, PlaceInfo, UrbanClimate } from '@/contracts';
import { BRANCHES, tx } from '@/contracts';
import { todayISO } from '@/lib/time';
import { isNode, nodeImport, viteEnv } from './env';
import { getJson } from './http';
import { allUnavailable, loadLive } from './live';
import { mockTelemetry } from './mock';
import { nominatimSearch, parseCoordinates, photonSearch, reverse } from './adapters/geocode';
import { loadUrban } from './urban';

export { SAMPLE_PARCELS, getSampleParcel } from './samples';
export { confidenceAt, staticBadge } from './confidence';
export { SOURCES } from './sources';
export { loadFieldRasters, type RasterLoadOptions } from './rasters';
export { detectFieldBoundary, type FieldBoundary } from './boundary';

/** auto = cached file for sample parcels, live adapters otherwise, mock only if everything fails. */
export type DataMode = 'auto' | 'live' | 'cached' | 'mock';

export interface LoadOptions {
  signal?: AbortSignal;
  mode?: DataMode;
  today?: ISODate;
  /**
   * Progressive loading: called each time a branch resolves, with the telemetry assembled so far.
   * Fast sources (NASA POWER, forecast, terrain) should report within ~2 s; slow ones (MODIS
   * subsets, SoilGrids) follow, so the HUD fills in branch by branch instead of blocking.
   */
  onProgress?: (partial: FieldTelemetry, branch: BranchId) => void;
  /** Node cache script only: use the slower, fuller sources. */
  full?: boolean;
}

const MOCK_NOTE = tx(
  'Every live source failed, so this is simulated placeholder data. Do not use it for decisions.',
  'Mọi nguồn trực tuyến đều lỗi nên đây là dữ liệu giả lập. Không dùng để ra quyết định.',
);

function labelledMock(parcel: Parcel, today: ISODate, extra = MOCK_NOTE): FieldTelemetry {
  const m = mockTelemetry(parcel, today);
  for (const b of BRANCHES) m.branches[b] = { ...m.branches[b], notes: [...(m.branches[b].notes ?? []), extra] };
  return m;
}

/** Load a demo cache: fetch in the browser, read from disk in Node. */
async function loadCached(id: string, signal?: AbortSignal): Promise<FieldTelemetry> {
  if (isNode) {
    const fs = await nodeImport<typeof import('node:fs/promises')>('node:fs/promises');
    const path = await nodeImport<typeof import('node:path')>('node:path');
    return JSON.parse(await fs.readFile(path.join(process.cwd(), 'public', 'data', 'samples', `${id}.json`), 'utf8')) as FieldTelemetry;
  }
  const base = viteEnv().BASE_URL ?? '/';
  return getJson<FieldTelemetry>(`${base}data/samples/${id}.json`, { signal, timeoutMs: 15_000, retries: 1 });
}

/**
 * Cached and mock telemetry arrive complete, and the store publishes the returned value with all
 * branch statuses at once; one progress call per branch would only trigger eight identical
 * recomputes. So these paths report once, on the last branch.
 */
function emitAll(t: FieldTelemetry, onProgress: LoadOptions['onProgress']): void {
  onProgress?.(t, BRANCHES[BRANCHES.length - 1]);
}

export async function loadTelemetry(parcel: Parcel, opts: LoadOptions = {}): Promise<FieldTelemetry> {
  const today = opts.today ?? todayISO();
  const envMode = viteEnv().VITE_DATA_MODE as DataMode | undefined;
  const mode: DataMode = opts.mode ?? envMode ?? 'auto';

  if (mode === 'mock') {
    const m = labelledMock(parcel, today, tx('Mock mode is switched on: simulated data.', 'Đang bật chế độ giả lập: dữ liệu mô phỏng.'));
    emitAll(m, opts.onProgress);
    return m;
  }

  let cacheNote: ReturnType<typeof tx> | null = null;
  if (mode === 'cached' || (mode === 'auto' && parcel.source === 'sample')) {
    try {
      const t = await loadCached(parcel.id, opts.signal);
      t.mode = 'cached';
      const elev = t.branches.terrain?.facts.find((f) => f.key === 'elevation_m')?.value;
      if (typeof elev === 'number') parcel.elevationM = elev;
      emitAll(t, opts.onProgress);
      return t;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (mode === 'cached') throw e;
      cacheNote = tx('Demo cache missing; loaded live instead.', 'Thiếu dữ liệu mẫu; đã tải trực tuyến.');
    }
  }

  const live = await loadLive(parcel, {
    signal: opts.signal,
    today,
    full: opts.full,
    onProgress: opts.onProgress,
  });
  if (cacheNote) live.branches.terrain = { ...live.branches.terrain, notes: [...(live.branches.terrain.notes ?? []), cacheNote] };
  if (allUnavailable(live)) {
    const m = labelledMock(parcel, today);
    emitAll(m, opts.onProgress);
    return m;
  }
  return live;
}

/** Forward geocoding for "type a province / city" and "enter coordinates". */
export async function searchPlace(query: string, lang: Lang): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const coords = parseCoordinates(q);
  if (coords) {
    const info = await reverseGeocode(coords, lang).catch(() => null);
    return [{ label: info?.label ?? `${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`, location: coords, country: info?.country, admin1: info?.admin1 }];
  }
  try {
    const hits = await nominatimSearch(q, lang);
    if (hits.length) return hits;
  } catch {
    // fall through to Photon
  }
  try {
    return await photonSearch(q);
  } catch {
    return [];
  }
}

export async function reverseGeocode(at: LngLat, lang: Lang): Promise<PlaceInfo | null> {
  try {
    return await reverse(at, lang);
  } catch {
    return null;
  }
}

/** Monthly climate normals plus current conditions for the Urban Grower Companion. */
export async function loadUrbanClimate(at: LngLat): Promise<UrbanClimate> {
  return loadUrban(at);
}
