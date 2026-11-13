/** PLACEHOLDER (owner: Agent 4a). State 1: hero overlay above the rotating globe. */
import { useMission } from '@/state/mission';

export function HeroOverlay() {
  const enterExplore = useMission((s) => s.enterExplore);
  return (
    <button
      data-placeholder="hero"
      onClick={enterExplore}
      style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0, color: '#e8ecf1', font: '600 40px system-ui', cursor: 'pointer' }}
    >
      ASTROVIVU — click to begin
    </button>
  );
}
