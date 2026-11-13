import { useEffect, useState } from 'react';
import { GlobeCanvas, GlobeLab } from '@/globe';
import { useMission } from '@/state/mission';
import { AdvisoryPanel } from '@/ui/advisory';
import { AskPanel } from '@/ui/ask';
import { TopBar } from '@/ui/chrome';
import { StyleGuide } from '@/ui/design/StyleGuide';
import { ActionDock, LayerPanel } from '@/ui/dock';
import { HeroOverlay } from '@/ui/hero';
import { RadialHud } from '@/ui/hud';
import { GroundTruthPanel } from '@/ui/override';
import { TimelineScrubber } from '@/ui/timeline';
import { TrackingView } from '@/ui/tracking';
import { UrbanCompanion } from '@/ui/urban';

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/**
 * Composition root. The globe is always mounted; each mission phase layers its own instruments
 * on top. `#/styleguide` and `#/globe-lab` are isolated benches for the design system and the map.
 */
export default function App() {
  const hash = useHashRoute();
  const phase = useMission((s) => s.phase);

  if (hash === '#/styleguide') return <StyleGuide />;
  if (hash === '#/globe-lab') return <GlobeLab />;

  return (
    <div className="app-root">
      <GlobeCanvas />
      <TopBar />
      {phase === 'hero' && <HeroOverlay />}
      {phase === 'explore' && (
        <>
          <LayerPanel />
          <ActionDock />
        </>
      )}
      {phase === 'locked' && (
        <>
          <RadialHud />
          <GroundTruthPanel />
          <TimelineScrubber />
        </>
      )}
      {phase === 'advisory' && <AdvisoryPanel />}
      {phase === 'tracking' && <TrackingView />}
      {phase === 'urban' && <UrbanCompanion />}
      <AskPanel />
    </div>
  );
}
