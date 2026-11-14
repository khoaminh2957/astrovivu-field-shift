/** What the climate strip needs from the telemetry: the monthly normals and where they come from. */
import type { FieldTelemetry } from '@/contracts';
import { monthlyNormals } from '@/lib/climate';
import type { ClimateStripProps } from './ClimateStrip';
import { sourceName } from './shared';

/** Null when the field carries no multi-year record: the calendar is then drawn without the strip. */
export function climateOf(telemetry: FieldTelemetry | null | undefined): ClimateStripProps | null {
  const history = telemetry?.climateHistory;
  if (!telemetry || !history?.length) return null;
  const normals = monthlyNormals(history);
  if (!normals.some((m) => m.rainMm != null || m.tMean != null)) return null;
  const years = history.map((y) => y.year);
  const src = telemetry.climateSourceId ? telemetry.sources[telemetry.climateSourceId] : undefined;
  return {
    normals,
    source: src ? (src.resourceName ?? src.name) : sourceName(telemetry.climateSourceId),
    span: [Math.min(...years), Math.max(...years)],
    years: history.length,
    simulated: src?.provenance === 'simulated' || telemetry.mode === 'mock',
  };
}
