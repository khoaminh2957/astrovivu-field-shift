/**
 * Long-term tracking (State 6): season history, journal, soil tests, alerts, plan vs actual.
 * PLACEHOLDER IMPLEMENTATION (owner: Agent 2c). Demo fields get simulated history that is always
 * flagged `simulated: true`; a user's own parcel starts empty and fills from their entries.
 */
import type { ModelInput, TrackingData } from '@/contracts';

export function buildTracking(input: ModelInput): TrackingData {
  return {
    parcelId: input.parcel.id,
    simulated: input.parcel.source === 'sample',
    seasons: [],
    journal: [],
    soilTests: [],
    alerts: [],
    planVsActual: [],
    ndviByYear: [],
  };
}
