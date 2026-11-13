/**
 * Tier 1 + 2 public API: acquire NASA and partner data for a parcel, harmonise it in space and
 * time, and hand back one `FieldTelemetry`.
 *
 * PLACEHOLDER IMPLEMENTATION (owner: Agent 2a). The signatures below are the contract the store
 * and the UI code against; keep them, replace the bodies.
 */
import type { BranchId, FieldTelemetry, ISODate, Lang, LngLat, Parcel, PlaceHit, PlaceInfo, UrbanClimate } from '@/contracts';
import { BRANCHES } from '@/contracts';
import { emptyBranch } from '@/lib/series';
import { mockTelemetry } from './mock';

export { SAMPLE_PARCELS, getSampleParcel } from './samples';

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
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function loadTelemetry(parcel: Parcel, opts: LoadOptions = {}): Promise<FieldTelemetry> {
  const full = mockTelemetry(parcel, opts.today);
  let partial: FieldTelemetry = {
    ...full,
    branches: Object.fromEntries(BRANCHES.map((id) => [id, emptyBranch(id)])) as FieldTelemetry['branches'],
  };
  for (const id of BRANCHES) {
    await delay(120);
    if (opts.signal?.aborted) throw new DOMException('Telemetry load aborted', 'AbortError');
    partial = { ...partial, branches: { ...partial.branches, [id]: full.branches[id] } };
    opts.onProgress?.(partial, id);
  }
  return full;
}

/** Forward geocoding for "type a province / city" and "enter coordinates". */
export async function searchPlace(_query: string, _lang: Lang): Promise<PlaceHit[]> {
  return [];
}

export async function reverseGeocode(_at: LngLat, _lang: Lang): Promise<PlaceInfo | null> {
  return null;
}

/** Monthly climate normals plus current conditions for the Urban Grower Companion. */
export async function loadUrbanClimate(at: LngLat): Promise<UrbanClimate> {
  const base = 29 - Math.min(Math.abs(at[1]), 50) * 0.35;
  return {
    location: at,
    months: Array.from({ length: 12 }, (_, i) => {
      const s = (Math.cos(((i - 6.5) / 12) * 2 * Math.PI) + 1) / 2;
      return { month: i + 1, tMean: base - 4 + 6 * s, tMin: base - 9 + 6 * s, tMax: base + 1 + 6 * s, rainMm: 20 + 180 * s, par: 7 + 3 * s, rh: 60 + 20 * s };
    }),
    sourceIds: ['sim'],
  };
}
