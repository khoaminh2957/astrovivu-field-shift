/**
 * ISRIC SoilGrids 2.0 point query. 5-80 s per call (observed 78 s on 2026-11-14), CORS *.
 * Returns null layers on masked pixels (urban, water); the caller retries neighbours.
 */
import type { LngLat } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { getJson } from '../http';
import { weightedMean } from '../harmonize/units';

const PROPS = ['phh2o', 'soc', 'clay', 'sand', 'silt', 'nitrogen', 'cec', 'bdod'] as const;
export type SoilProp = (typeof PROPS)[number];
const DEPTHS = ['0-5cm', '5-15cm', '15-30cm'] as const;
const WEIGHTS = [5, 10, 15];

interface SgLayer {
  name: string;
  unit_measure: { d_factor: number; target_units: string };
  depths: { label: string; values: Record<string, number | null> }[];
}

export interface SoilValue {
  mean: number | null;
  q05: number | null;
  q95: number | null;
}

/**
 * 0-30 cm depth-weighted means in target units (pH, dg/kg→g/kg etc. via `d_factor`). Quantiles
 * are depth-weighted the same way; this is an approximation (quantiles do not add) documented in
 * DATA_SOURCES.md.
 */
export async function soilGrids(at: LngLat, signal?: AbortSignal): Promise<Record<SoilProp, SoilValue> | null> {
  const [lon, lat] = at;
  const q =
    PROPS.map((p) => `property=${p}`).join('&') + '&' + DEPTHS.map((d) => `depth=${d}`).join('&') + '&value=mean&value=Q0.05&value=Q0.95';
  const url = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}&${q}`;
  const j = await cached(`soilgrids:${ck(lon, 4)},${ck(lat, 4)}`, TTL.year, () =>
    getJson<SoilGridsResponse>(url, { signal, timeoutMs: 100_000, retries: 2 }),
  );
  return parseSoilGrids(j);
}

export interface SoilGridsResponse {
  properties: { layers: SgLayer[] };
}

export function parseSoilGrids(j: SoilGridsResponse): Record<SoilProp, SoilValue> | null {
  const out = {} as Record<SoilProp, SoilValue>;
  let any = false;
  for (const p of PROPS) {
    const layer = j.properties.layers.find((l) => l.name === p);
    const f = layer?.unit_measure.d_factor || 1;
    const pick = (k: string) =>
      weightedMean(
        DEPTHS.map((d) => {
          const v = layer?.depths.find((x) => x.label === d)?.values[k];
          return v == null ? null : v / f;
        }),
        WEIGHTS,
      );
    out[p] = { mean: pick('mean'), q05: pick('Q0.05'), q95: pick('Q0.95') };
    if (out[p].mean != null) any = true;
  }
  return any ? out : null;
}
