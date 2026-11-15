/**
 * What the grower's last entry did to the score. Nothing is scored here: the store recomputes on
 * every entry, and this keeps the score it showed just before beside the one it shows after.
 */
import { create } from 'zustand';
import { scoreAt } from '@/lib/series';
import { type MissionState, useMission } from '@/state/mission';

export interface ScoreChange {
  before: number;
  after: number;
}

export const useScoreChange = create<{ change: ScoreChange | null }>()(() => ({ change: null }));

const shown = (s: MissionState): number | null => {
  const snap = scoreAt(s.score, s.timeline.cursor);
  return snap ? Math.round(snap.productivity) : null;
};

/** Score on screen when an entry was made and the recompute has not landed yet. */
let pending: number | null = null;

useMission.subscribe((s, prev) => {
  if (s.parcel?.id !== prev.parcel?.id) {
    pending = null;
    useScoreChange.setState({ change: null });
    return;
  }
  // With a crop the number is that crop's productivity, without one a generic index: the two are not a before and an after.
  if (!s.cropId !== !prev.cropId) {
    pending = null;
    useScoreChange.setState({ change: null });
    return;
  }
  if (s.groundTruth !== prev.groundTruth || s.cropId !== prev.cropId) pending = shown(prev) ?? pending;
  if (s.score !== prev.score && pending != null) {
    const after = shown(s);
    if (after != null) useScoreChange.setState({ change: { before: pending, after } });
    pending = null;
  }
});
