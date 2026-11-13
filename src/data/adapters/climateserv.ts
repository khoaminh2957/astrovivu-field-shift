/**
 * NASA SERVIR ClimateSERV (climateserv.servirglobal.net/api). Asynchronous: submit → poll → fetch.
 * CORS *. More than ~3 simultaneous submissions return 503, so the host limiter allows 2.
 *
 * Dataset ids verified on 2026-11-14 at 12.8 N 108.2 E:
 *   0  CHIRPS daily rainfall: data to 2026-09-30 (≈45-day latency)
 *   29 ESI 4-week: weekly values, last value 2025-07 (publication has stalled)
 *   33 ESI 12-week: same calendar as 29
 *   26 IMERG 1-day late / 91 IMERG early: empty for 2025-2026 (one stray value in June 2024)
 *   37-41 USDA SMAP soil moisture: documented as ending August 2022; empty here
 */
import type { LngLat, Sample } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { getJson, sleep } from '../http';
import { boxAround } from '../harmonize/zonal';

const BASE = 'https://climateserv.servirglobal.net/api';

const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

interface CsRow {
  date: string;
  value: { avg?: number };
}

export async function climateServ(datatype: number, at: LngLat, start: string, end: string, signal?: AbortSignal, halfDeg = 0.03): Promise<Sample[]> {
  const geom = JSON.stringify(boxAround(at, halfDeg));
  const key = `cs:${datatype}:${ck(at[0], 2)},${ck(at[1], 2)}:${start}:${end}`;
  return cached(key, TTL.day, async () => {
    const submit =
      `${BASE}/submitDataRequest/?datatype=${datatype}&begintime=${mdy(start)}&endtime=${mdy(end)}` +
      `&intervaltype=0&operationtype=5&dateType_Category=default&isZip_CurrentDataType=false&geometry=${encodeURIComponent(geom)}`;
    const ids = await getJson<string[]>(submit, { signal, timeoutMs: 30_000, retries: 3 });
    const id = ids?.[0];
    if (!id) throw new Error('ClimateSERV did not return a request id');
    const t0 = Date.now();
    for (;;) {
      await sleep(1500, signal);
      const p = await getJson<number[] | number>(`${BASE}/getDataRequestProgress/?id=${id}`, { signal, timeoutMs: 15_000 });
      const v = Array.isArray(p) ? p[0] : p;
      if (v === -1) throw new Error('ClimateSERV request failed on the server');
      if (v >= 100) break;
      if (Date.now() - t0 > 120_000) throw new Error('ClimateSERV request timed out');
    }
    const j = await getJson<{ data?: CsRow[] }>(`${BASE}/getDataFromRequest/?id=${id}`, { signal, timeoutMs: 30_000 });
    return (j.data ?? [])
      .map((r) => {
        const [m, d, y] = r.date.split('/');
        const v = r.value?.avg;
        // ClimateSERV marks missing with large negative fill values.
        return { t: `${y}-${m}-${d}`, v: v == null || !Number.isFinite(v) || v < -9000 ? null : Math.round(v * 1000) / 1000 };
      })
      .sort((a, b) => (a.t < b.t ? -1 : 1));
  });
}
