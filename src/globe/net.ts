/**
 * One door for every tile the globe requests. MapLibre is pointed at `astro://host/path` URLs and
 * this module performs the fetch, which is the only place where the project's network rules can
 * be enforced for map tiles: at most four requests in flight per host, a timeout on each, a
 * bounded retry, and a count of failures per host so the globe can switch imagery when a server
 * stops answering.
 *
 * It also rejects Esri's "Map data not yet available" tile. Esri answers 200 with that grey
 * placeholder wherever a zoom level has no imagery (level 19 in most of rural Asia, level 15 at
 * sea). Rejecting it makes MapLibre keep the sharper parent tile instead of painting the label.
 */
import { addProtocol } from 'maplibre-gl';

export const TILE_SCHEME = 'astro';
const MAX_PER_HOST = 4;
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
/** Byte length of Esri's placeholder JPEG (verified identical at five places, ETag "vvvvvvvvvvvvf"). */
const ESRI_PLACEHOLDER_BYTES = 2521;
const ESRI_HOST = 'server.arcgisonline.com';

export interface HostStats {
  ok: number;
  failed: number;
  /** Failures since the last success: what the imagery fallback looks at. */
  streak: number;
  missing: number;
  inFlight: number;
  queued: number;
}

interface Job {
  url: string;
  signal: AbortSignal;
  run: () => void;
}

const queues = new Map<string, { active: number; waiting: Job[] }>();
const stats = new Map<string, HostStats>();
const listeners = new Set<(host: string, s: HostStats) => void>();

function hostStats(host: string): HostStats {
  let s = stats.get(host);
  if (!s) {
    s = { ok: 0, failed: 0, streak: 0, missing: 0, inFlight: 0, queued: 0 };
    stats.set(host, s);
  }
  return s;
}

export const getTileStats = (): ReadonlyMap<string, HostStats> => stats;

/** Called after every finished request with the host's running totals. */
export function onTileResult(listener: (host: string, s: HostStats) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `astro://host/path` for MapLibre; `{z}/{x}/{y}` placeholders pass through untouched. */
export const viaScheduler = (httpsUrl: string): string => httpsUrl.replace(/^https:\/\//, `${TILE_SCHEME}://`);

function pump(host: string): void {
  const q = queues.get(host);
  if (!q) return;
  const s = hostStats(host);
  while (q.active < MAX_PER_HOST && q.waiting.length > 0) {
    const job = q.waiting.shift() as Job;
    // MapLibre cancels tiles the camera has flown past; never spend a slot on those.
    if (job.signal.aborted) continue;
    q.active++;
    job.run();
  }
  s.inFlight = q.active;
  s.queued = q.waiting.length;
}

function schedule<T>(host: string, url: string, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  let q = queues.get(host);
  if (!q) {
    q = { active: 0, waiting: [] };
    queues.set(host, q);
  }
  const queue = q;
  return new Promise<T>((resolve, reject) => {
    queue.waiting.push({
      url,
      signal,
      run: () => {
        task()
          .then(resolve, reject)
          .finally(() => {
            queue.active--;
            pump(host);
          });
      },
    });
    // A request cancelled while still queued must settle, or MapLibre keeps its tile pending.
    signal.addEventListener('abort', () => reject(new DOMException('Tile request aborted', 'AbortError')), { once: true });
    pump(host);
  });
}

class MissingTileError extends Error {
  constructor(url: string) {
    super(`No tile at this zoom: ${url}`);
    this.name = 'MissingTileError';
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Tile request aborted', 'AbortError'));
      },
      { once: true },
    );
  });

async function fetchTile(url: string, host: string, signal: AbortSignal): Promise<ArrayBuffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(250 * 3 ** (attempt - 1), signal);
    try {
      const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) });
      // 4xx is an answer, not an outage: the tile does not exist (a date GIBS has no picture for).
      if (res.status >= 400 && res.status < 500) throw new MissingTileError(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const data = await res.arrayBuffer();
      if (host === ESRI_HOST && data.byteLength === ESRI_PLACEHOLDER_BYTES) throw new MissingTileError(url);
      return data;
    } catch (err) {
      if (signal.aborted || err instanceof MissingTileError) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

let registered = false;

/** Idempotent: several maps (the app and the bench) share one scheduler. */
export function registerTileScheduler(): void {
  if (registered) return;
  registered = true;
  addProtocol(TILE_SCHEME, (params, abortController) => {
    const url = params.url.replace(`${TILE_SCHEME}://`, 'https://');
    const host = url.slice(8, url.indexOf('/', 8));
    const s = hostStats(host);
    const viaQueue = () => schedule(host, url, abortController.signal, () => fetchTile(url, host, abortController.signal)).then(
      (data) => {
        s.ok++;
        s.streak = 0;
        for (const l of listeners) l(host, s);
        return { data };
      },
      (err: unknown) => {
        if (err instanceof MissingTileError) s.missing++;
        else if (!abortController.signal.aborted) {
          s.failed++;
          s.streak++;
          for (const l of listeners) l(host, s);
        }
        throw err;
      },
    );
    const warm = prefetched.get(url);
    if (!warm) return viaQueue();
    prefetched.delete(url);
    // A prefetch that failed for any reason falls back to the ordinary path (and its retries).
    return warm.then((data) => (data ? { data } : viaQueue()));
  });
}

/** Small JSON/XML fetch with the same manners, for the GIBS time-domain lookups. */
export async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const host = url.slice(8, url.indexOf('/', 8));
  const own = new AbortController();
  signal?.addEventListener('abort', () => own.abort(), { once: true });
  return schedule(host, url, own.signal, async () => {
    const res = await fetch(url, { signal: AbortSignal.any([own.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  });
}

/**
 * Tiles fetched ahead of a flight, keyed by https URL. MapLibre asks for the destination tiles only
 * in the last second of a descent; fetched early (through the same per-host queue, so the
 * four-per-host rule holds), they are in memory when it does and the field appears without a
 * second of blur at the end of the move. Null means the server has no tile there.
 */
const prefetched = new Map<string, Promise<ArrayBuffer | null>>();
const PREFETCH_MAX = 96;

/** Warms the tile cache for these https URLs. Each is fetched once; the oldest entries are dropped first. */
export function prefetchTiles(urls: string[]): void {
  for (const url of urls) {
    if (prefetched.has(url)) continue;
    const host = url.slice(8, url.indexOf('/', 8));
    const ctrl = new AbortController();
    const job = schedule(host, url, ctrl.signal, () => fetchTile(url, host, ctrl.signal)).then(
      (data) => data,
      () => null,
    );
    prefetched.set(url, job);
    if (prefetched.size > PREFETCH_MAX) {
      const oldest = prefetched.keys().next().value;
      if (oldest !== undefined) prefetched.delete(oldest);
    }
  }
}
