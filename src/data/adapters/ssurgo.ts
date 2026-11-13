/**
 * USDA NRCS SSURGO via Soil Data Access (POST, JSON). ~1-2 s. Sends `Access-Control-Allow-Origin: *`
 * (checked 2026-11-14, also on the OPTIONS preflight), so it works live in the browser.
 *
 * Reads the dominant component of the map unit under the point and depth-weights its horizons
 * over 0-30 cm.
 */
import type { LngLat } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { getJson } from '../http';

export interface SsurgoSoil {
  mukey: string;
  muname: string;
  compname: string;
  comppct: number | null;
  drainage: string | null;
  hydgrp: string | null;
  restrictiveDepthCm: number | null;
  ph: number | null;
  omPct: number | null;
  clayPct: number | null;
  sandPct: number | null;
  siltPct: number | null;
  awc: number | null;
  ecDsm: number | null;
  cec: number | null;
}

const SDA = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';

async function sda(query: string, signal?: AbortSignal): Promise<Record<string, string | null>[]> {
  const j = await getJson<{ Table?: (string | null)[][] }>(SDA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'JSON+COLUMNNAME', query }),
    signal,
    timeoutMs: 30_000,
  });
  const t = j.Table ?? [];
  if (t.length < 2) return [];
  const cols = t[0] as string[];
  return t.slice(1).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

const num = (v: string | null | undefined): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export async function ssurgoAtPoint([lon, lat]: LngLat, signal?: AbortSignal): Promise<SsurgoSoil | null> {
  return cached(`ssurgo:${ck(lon, 4)},${ck(lat, 4)}`, TTL.year, async () => {
    const comp = await sda(
      `SELECT TOP 1 mu.mukey, mu.muname, c.cokey, c.compname, c.comppct_r, c.drainagecl, c.hydgrp,
         (SELECT MIN(r.resdept_r) FROM corestrictions r WHERE r.cokey = c.cokey) AS resdept
       FROM mapunit mu INNER JOIN component c ON c.mukey = mu.mukey
       WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lon.toFixed(6)} ${lat.toFixed(6)})'))
       ORDER BY c.comppct_r DESC`,
      signal,
    );
    if (comp.length === 0) return null;
    const c = comp[0];
    const hz = await sda(
      `SELECT hzdept_r, hzdepb_r, ph1to1h2o_r, om_r, claytotal_r, sandtotal_r, silttotal_r, awc_r, ec_r, cec7_r
       FROM chorizon WHERE cokey = '${String(c.cokey).replace(/[^0-9]/g, '')}' AND hzdept_r < 30 ORDER BY hzdept_r`,
      signal,
    );
    const wavg = (col: string): number | null => {
      let s = 0;
      let w = 0;
      for (const h of hz) {
        const top = num(h.hzdept_r) ?? 0;
        const bot = Math.min(30, num(h.hzdepb_r) ?? 30);
        const v = num(h[col]);
        if (v == null || bot <= top) continue;
        s += v * (bot - top);
        w += bot - top;
      }
      return w > 0 ? Math.round((s / w) * 100) / 100 : null;
    };
    return {
      mukey: String(c.mukey),
      muname: String(c.muname ?? ''),
      compname: String(c.compname ?? ''),
      comppct: num(c.comppct_r),
      drainage: c.drainagecl ?? null,
      hydgrp: c.hydgrp ?? null,
      restrictiveDepthCm: num(c.resdept),
      ph: wavg('ph1to1h2o_r'),
      omPct: wavg('om_r'),
      clayPct: wavg('claytotal_r'),
      sandPct: wavg('sandtotal_r'),
      siltPct: wavg('silttotal_r'),
      awc: wavg('awc_r'),
      ecDsm: wavg('ec_r'),
      cec: wavg('cec7_r'),
    };
  });
}
