/** PLACEHOLDER (owner: Agent 4a). State 3: Center Productivity Hub + 8-branch radial telemetry callouts. */
import { BRANCHES, BRANCH_SIDE, pick } from '@/contracts';
import { primarySeries, sampleAt, scoreAt } from '@/lib/series';
import { useMission } from '@/state/mission';
import { box } from '../_placeholder';

export function RadialHud() {
  const { telemetry, branchStatus, timeline, score, anchor, lang, cropId } = useMission();
  const snap = scoreAt(score, timeline.cursor);
  return (
    <>
      {anchor?.visible && (
        <div style={{ ...box, left: anchor.x - 70, top: anchor.y - 30, width: 140, textAlign: 'center' }} data-placeholder="hub">
          PRODUCTIVITY {snap?.productivity ?? '--'}
          <br />
          {cropId ? `compat ${snap?.compatibility ?? '--'}` : 'select crop'}
        </div>
      )}
      {(['left', 'right'] as const).map((side) => (
        <div key={side} style={{ ...box, top: 110, [side]: 8, width: 250 }} data-placeholder={`hud-${side}`}>
          {BRANCHES.filter((b) => BRANCH_SIDE[b] === side).map((b) => {
            const branch = telemetry?.branches[b];
            const series = branch && primarySeries(branch);
            const at = series ? sampleAt(series, timeline.cursor) : null;
            const fact = branch?.facts[0];
            return (
              <div key={b} style={{ marginBottom: 8 }}>
                <strong>{branch ? pick(branch.title, lang) : b}</strong> [{branchStatus[b]}]
                <br />
                {series ? `${pick(series.label, lang)}: ${at?.sample?.v ?? '--'} ${series.unit}${at?.stale ? ' (stale)' : ''}` : fact ? `${pick(fact.label, lang)}: ${fact.value} ${fact.unit ?? ''}` : '--'}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
