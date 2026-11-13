/**
 * Shared HTTP layer for every adapter: timeout, up to 3 retries with exponential backoff on
 * network errors / 429 / 5xx, at most N concurrent requests per host, AbortSignal propagation.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string,
  ) {
    super(`HTTP ${status} for ${hostOf(url)}: ${body.slice(0, 160)}`);
    this.name = 'HttpError';
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

const HOST_LIMIT: Record<string, number> = {
  // ORNL subsets are slow and intermittently 502: two to three in flight is the polite maximum.
  'modis.ornl.gov': 3,
  'climateserv.servirglobal.net': 2,
  'rest.isric.org': 2,
  'api.opentopodata.org': 1,
  'nominatim.openstreetmap.org': 1,
};
const DEFAULT_LIMIT = 4;

const active = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function acquire(host: string): Promise<void> {
  const limit = HOST_LIMIT[host] ?? DEFAULT_LIMIT;
  const n = active.get(host) ?? 0;
  if (n < limit) {
    active.set(host, n + 1);
    return;
  }
  await new Promise<void>((resolve) => {
    const q = waiting.get(host) ?? [];
    q.push(resolve);
    waiting.set(host, q);
  });
  active.set(host, (active.get(host) ?? 0) + 1);
}

function release(host: string): void {
  active.set(host, Math.max(0, (active.get(host) ?? 1) - 1));
  const next = waiting.get(host)?.shift();
  if (next) next();
}

export const abortError = () => new DOMException('Aborted', 'AbortError');
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const retriable = (status: number) => status === 429 || status >= 500;

async function request(url: string, opts: RequestOptions): Promise<Response> {
  const host = hostOf(url);
  const retries = Math.min(opts.retries ?? 2, 3);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw abortError();
    if (attempt > 0) await sleep(800 * 2 ** (attempt - 1) + Math.random() * 400, opts.signal);
    await acquire(host);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: opts.method ?? 'GET', headers: opts.headers, body: opts.body, signal: ctrl.signal });
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      lastErr = new HttpError(res.status, url, body);
      if (!retriable(res.status)) throw lastErr;
    } catch (e) {
      if (opts.signal?.aborted) throw abortError();
      if (e instanceof HttpError && !retriable(e.status)) throw e;
      lastErr = ctrl.signal.aborted ? new Error(`Timeout after ${timeoutMs} ms for ${host}`) : e;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      release(host);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${hostOf(url)}: ${text.slice(0, 160)}`);
  }
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  return (await request(url, opts)).text();
}

export async function getBytes(url: string, opts: RequestOptions = {}): Promise<Uint8Array> {
  return new Uint8Array(await (await request(url, opts)).arrayBuffer());
}

/** Run tasks with a fixed concurrency, preserving result order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
