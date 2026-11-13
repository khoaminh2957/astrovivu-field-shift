/** PLACEHOLDER (owner: Agent 4a). Top bar: brand, mission phase navigation, language toggle. */
import { useMission, type Phase } from '@/state/mission';
import { box, btn } from '../_placeholder';

const NAV: Phase[] = ['locked', 'advisory', 'tracking'];

export function TopBar() {
  const { phase, parcel, lang, setPhase, setLang, unlockParcel } = useMission();
  if (phase === 'hero') return null;
  return (
    <div style={{ ...box, top: 8, left: 8, right: 8 }} data-placeholder="topbar">
      <strong>ASTROVIVU</strong> · {phase}
      {parcel && NAV.map((p) => (
        <button key={p} style={btn} onClick={() => setPhase(p)}>{p}</button>
      ))}
      {parcel && <button style={btn} onClick={unlockParcel}>change field</button>}
      <button style={btn} onClick={() => setPhase(phase === 'urban' ? (parcel ? 'locked' : 'explore') : 'urban')}>urban</button>
      <button style={btn} onClick={() => setLang(lang === 'en' ? 'vi' : 'en')}>{lang.toUpperCase()}</button>
    </div>
  );
}
