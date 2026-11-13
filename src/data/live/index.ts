/**
 * Live telemetry for any point on Earth. Every branch runs concurrently and publishes itself
 * through `onProgress` as soon as it has data (fast sources ~1-3 s, ORNL/SoilGrids/ClimateSERV
 * 20-120 s), possibly twice when a better source arrives after a fallback.
 */
import type { FieldTelemetry, Parcel } from '@/contracts';
import { BRANCHES, tx } from '@/contracts';
import { abortError } from '../http';
import { SOURCES } from '../sources';
import { LiveContext, type LiveOptions } from './context';
import { cropHistory, soil, terrain } from './ground';
import { thermal, vegetation } from './satellite';
import { agromet, climateHistory, rainfall, risk, soilMoisture } from './weather';

export type { LiveOptions } from './context';

export async function loadLive(parcel: Parcel, opts: LiveOptions): Promise<FieldTelemetry> {
  const ctx = new LiveContext(parcel, opts);
  // Warm the shared requests immediately so the fast branches are not serialised behind terrain.
  void ctx.era5History();
  void ctx.powerWindow();
  const builders: [string, () => Promise<void>][] = [
    ['terrain', () => terrain(ctx)],
    ['risk', () => risk(ctx)],
    ['agromet', () => agromet(ctx)],
    ['soilMoisture', () => soilMoisture(ctx)],
    ['rainfall', () => rainfall(ctx)],
    ['vegetation', () => vegetation(ctx)],
    ['thermal', () => thermal(ctx)],
    ['soil', () => soil(ctx)],
  ];
  const results = await Promise.allSettled([
    ...builders.map(async ([id, fn]) => {
      try {
        await fn();
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        // A builder bug must not take the other branches down; surface it on the branch.
        const b = ctx.telemetry.branches[id as keyof FieldTelemetry['branches']];
        ctx.emit({
          ...b,
          notes: [...(b.notes ?? []), tx(`Loader error: ${e instanceof Error ? e.message : String(e)}`, 'Lỗi khi tải dữ liệu nhánh này.')],
        });
      }
    }),
    climateHistory(ctx).then((h) => {
      if (h?.length) {
        ctx.telemetry.climateHistory = h;
        ctx.telemetry.climateSourceId = SOURCES.era5.id;
        ctx.addSource(SOURCES.era5);
      }
    }),
    cropHistory(ctx)
      .then((c) => {
        if (c) ctx.telemetry.cropHistory = c;
      })
      .catch(() => undefined),
  ]);
  if (opts.signal?.aborted) throw abortError();
  void results;
  ctx.telemetry.generatedAt = new Date().toISOString();
  return ctx.snapshot();
}

export const allUnavailable = (t: FieldTelemetry): boolean => BRANCHES.every((b) => t.branches[b].status === 'unavailable');
