/** PLACEHOLDER (owner: Agent 4b). State 6: long-term tracking (journal, seasons, soil tests, plan vs actual). */
import { useMission } from '@/state/mission';
import { box } from '../_placeholder';

export function TrackingView() {
  const tracking = useMission((s) => s.tracking);
  return (
    <div style={{ ...box, top: 60, left: 8, right: 8, bottom: 8, overflow: 'auto' }} data-placeholder="tracking">
      <strong>TRACKING</strong> — {tracking?.seasons.length ?? 0} seasons, {tracking?.journal.length ?? 0} journal entries
      {tracking?.simulated ? ' (simulated demo history)' : ''}
    </div>
  );
}
