/**
 * The `FieldContext` the assistant receives for one of the four demo fields, built from the cached
 * telemetry in `public/data/samples/` the way the app builds it. Real cached telemetry, unlike
 * `FIXTURE_CONTEXT` in eval.ts: tests and the demo script use it to check answers against the
 * numbers a user sees.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FieldContext, FieldTelemetry, GroundTruth, ModelInput } from '../../src/contracts';
import { computeScoreTimeline } from '../../src/core/scoring';
import { getSampleParcel } from '../../src/data/samples';
import { buildFieldContext } from '../../src/rag/fieldContext';

const ROOT = path.resolve(import.meta.dirname, '../..');
/** The telemetry window of the demo caches ends on this day (AGENTS.md). */
export const SAMPLE_TODAY = '2026-11-14';
export const SAMPLE_FIELDS = ['daklak-coffee', 'cantho-rice', 'iowa-corn-soy', 'nevada-alfalfa'] as const;

export function sampleContext(id: string, groundTruth: Partial<GroundTruth> = {}): FieldContext {
  const parcel = getSampleParcel(id);
  if (!parcel) throw new Error(`No demo field ${id}; one of ${SAMPLE_FIELDS.join(', ')}`);
  const defaults = (parcel as { defaultGroundTruth?: GroundTruth }).defaultGroundTruth ?? {};
  const gt = { ...defaults, ...groundTruth };
  const telemetry = JSON.parse(fs.readFileSync(path.join(ROOT, `public/data/samples/${id}.json`), 'utf8')) as FieldTelemetry;
  const input: ModelInput = { parcel, telemetry, cropId: parcel.defaultCropId, groundTruth: gt, priorities: ['profit', 'water', 'soil'], today: SAMPLE_TODAY };
  return buildFieldContext({ parcel, telemetry, score: computeScoreTimeline(input), cursor: SAMPLE_TODAY, cropId: parcel.defaultCropId, groundTruth: gt });
}
