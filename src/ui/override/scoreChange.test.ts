import { beforeEach, describe, expect, it } from 'vitest';
import type { Parcel, ScoreSnapshot, ScoreTimeline } from '@/contracts';
import { useMission } from '@/state/mission';
import { useScoreChange } from './scoreChange';

const DAY = '2026-11-14';

/** Only what `scoreAt` reads: one snapshot on the cursor date. */
const timeline = (productivity: number): ScoreTimeline =>
  ({ cropId: 'rice', stepDays: 1, snapshots: [{ t: DAY, productivity } as ScoreSnapshot], summary: {} }) as unknown as ScoreTimeline;

const parcel = (id: string): Parcel => ({ id }) as unknown as Parcel;

describe('score before and after an entry', () => {
  beforeEach(() => {
    useMission.setState({ parcel: parcel('a'), cropId: 'rice', groundTruth: {}, score: timeline(53), timeline: { ...useMission.getState().timeline, cursor: DAY } });
    useScoreChange.setState({ change: null });
  });

  it('pairs the score shown at the entry with the one the recompute lands on', () => {
    useMission.setState({ groundTruth: { ph: 7.5 } });
    expect(useScoreChange.getState().change).toBeNull();
    useMission.setState({ score: timeline(85) });
    expect(useScoreChange.getState().change).toEqual({ before: 53, after: 85 });
  });

  it('ignores a recompute that no entry caused (telemetry still arriving)', () => {
    useMission.setState({ score: timeline(60) });
    expect(useScoreChange.getState().change).toBeNull();
  });

  it('forgets the change when another field opens', () => {
    useMission.setState({ groundTruth: { ph: 7.5 } });
    useMission.setState({ score: timeline(85) });
    useMission.setState({ parcel: parcel('b') });
    expect(useScoreChange.getState().change).toBeNull();
  });

  it('does not compare a crop score with the generic index', () => {
    useMission.setState({ cropId: null });
    useMission.setState({ score: timeline(100) });
    expect(useScoreChange.getState().change).toBeNull();
  });
});
