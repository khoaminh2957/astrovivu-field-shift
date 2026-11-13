/** PLACEHOLDER (owner: Agent 4b). State 5: Actionable Advisory Engine (rotation comparison, irrigation, pH, sowing). */
import { pick } from '@/contracts';
import { useMission } from '@/state/mission';
import { box } from '../_placeholder';

export function AdvisoryPanel() {
  const { advisory, lang } = useMission();
  return (
    <div style={{ ...box, top: 60, left: 8, right: 8, bottom: 8, overflow: 'auto' }} data-placeholder="advisory">
      <strong>ADVISORY</strong> — {advisory?.rotations.length ?? 0} rotation strategies, {advisory?.advisories.length ?? 0} advisories
      {advisory?.rotations.map((r) => <div key={r.id}>{pick(r.name, lang)} · score {r.score}</div>)}
      {advisory?.advisories.map((a) => <div key={a.id}>{pick(a.title, lang)}</div>)}
    </div>
  );
}
