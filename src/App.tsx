/**
 * Composition root. The globe is always mounted; each mission phase layers its own instruments.
 *
 * Regions (CSS variables from tokens.css, values at 1440 x 900 / 1280 x 720 / below 1024 px):
 *   top bar        top 0, height --topbar-h (48 / 48 / 52 px), z chrome
 *   explore        LayerPanel top-right under the bar; ActionDock bottom-centre, z dock
 *   locked         RadialHud over the full viewport (columns between the bar and the timeline),
 *                  TimelineScrubber bottom, height --timeline-h (132 / 112 / 96 px),
 *                  GroundTruthPanel a non-modal sheet on the right between bar and timeline
 *   advisory, tracking, urban
 *                  one full region: top --topbar-h, left 0, right 0, bottom 0 (1440 x 852 at the
 *                  reference size, 1280 x 672 at 1280 x 720). The panel owns its scrolling.
 *   AskPanel       floats and positions itself (z assistant)
 * `#/styleguide` and `#/globe-lab` are isolated benches for the design system and the map.
 */
import { useEffect, useState } from 'react';
import { GlobeCanvas, GlobeLab } from '@/globe';
import { useMission } from '@/state/mission';
import { AdvisoryPanel } from '@/ui/advisory';
import { AskPanel } from '@/ui/ask';
import { TopBar } from '@/ui/chrome';
import { useMissionUi } from '@/ui/chrome/uiState';
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

/** A full region below the top bar for the views that replace the HUD. */
function Region({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-x-0 top-(--topbar-h) bottom-0 z-(--z-panel) overflow-hidden">{children}</div>;
}

export default function App() {
  const hash = useHashRoute();
  const phase = useMission((s) => s.phase);
  const setOverrideOpen = useMissionUi((s) => s.setOverrideOpen);

  // Side panels belong to the locked view; leaving it closes them.
  useEffect(() => {
    if (phase !== 'locked') setOverrideOpen(false);
  }, [phase, setOverrideOpen]);

  if (hash === '#/styleguide') return <StyleGuide />;
  if (hash === '#/globe-lab') return <GlobeLab />;

  return (
    <div className="app-root bg-void">
      <GlobeCanvas />
      <TopBar />
      <HeroOverlay />
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
      {phase === 'advisory' && (
        <Region>
          <AdvisoryPanel />
        </Region>
      )}
      {phase === 'tracking' && (
        <Region>
          <TrackingView />
        </Region>
      )}
      {phase === 'urban' && (
        <Region>
          <UrbanCompanion />
        </Region>
      )}
      <AskPanel />
    </div>
  );
}
