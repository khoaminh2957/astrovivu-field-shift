/**
 * Composition root. The globe is always mounted full-bleed; the hero sits over it until the user
 * enters, then the shell (`src/ui/chrome`) lays its panels over the globe and reports the space
 * they cover through `setInsets`, so the camera frames the parcel in the free part.
 *
 * Wide (1100 px and up): rail 56 px | field panel 340 px | map (toolbar on its right edge, timeline
 * strip along its bottom) | metric cards 440 px once a field is locked. Advisory, Tracking and
 * Urban take everything right of the rail.
 * Narrow: map in the top 45 %, a scrolling sheet under it, timeline pinned above a tab bar.
 * `#/styleguide` and `#/globe-lab` are isolated benches for the design system and the map.
 */
import { useEffect, useState } from 'react';
import { GlobeCanvas, GlobeLab } from '@/globe';
import { AskPanel } from '@/ui/ask';
import { Shell } from '@/ui/chrome';
import { StyleGuide } from '@/ui/design/StyleGuide';
import { HeroOverlay } from '@/ui/hero';

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHashRoute();
  if (hash === '#/styleguide') return <StyleGuide />;
  if (hash === '#/globe-lab') return <GlobeLab />;

  return (
    <div className="app-root bg-void">
      <GlobeCanvas />
      <HeroOverlay />
      <Shell />
      <AskPanel />
    </div>
  );
}
