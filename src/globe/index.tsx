/**
 * Tier 4 (map): 3D globe, fly-in, base layers, NASA overlays, parcel drawing and highlight.
 * PLACEHOLDER IMPLEMENTATION (owner: Agent 3). Keeps the app running without a map and publishes
 * a fake screen anchor so the HUD can be laid out before the real globe exists.
 */
import { useEffect } from 'react';
import { useMission } from '@/state/mission';

export function GlobeCanvas() {
  const parcel = useMission((s) => s.parcel);
  const setAnchor = useMission((s) => s.setAnchor);

  useEffect(() => {
    if (!parcel) {
      setAnchor(null);
      return;
    }
    const update = () => setAnchor({ x: window.innerWidth / 2, y: window.innerHeight * 0.42, w: 180, h: 120, visible: true });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [parcel, setAnchor]);

  return (
    <div
      data-placeholder="globe"
      style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 42%, #16324a 0, #0a1420 38%, #05070b 70%)' }}
    />
  );
}

/** Isolated bench for the map at `#/globe-lab`. */
export function GlobeLab() {
  return <GlobeCanvas />;
}
