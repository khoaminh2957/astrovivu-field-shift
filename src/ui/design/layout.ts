import { useSyncExternalStore } from 'react';

/**
 * Density of the mission screens, from the same media queries tokens.css uses:
 *   regular  1440 x 900 and up     radial HUD, full callouts
 *   compact  1280 x 720 class      radial HUD, tighter callouts and shorter sparklines
 *   stacked  below 1024 px wide    no radial layout: map on top, callouts in a list or sheet
 */
export type HudDensity = 'regular' | 'compact' | 'stacked';

const STACKED = '(max-width: 63.99rem)';
const COMPACT = '(max-width: 89.99rem), (max-height: 50rem)';

function read(): HudDensity {
  if (typeof window === 'undefined' || !window.matchMedia) return 'regular';
  if (window.matchMedia(STACKED).matches) return 'stacked';
  return window.matchMedia(COMPACT).matches ? 'compact' : 'regular';
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const lists = [window.matchMedia(STACKED), window.matchMedia(COMPACT)];
  for (const l of lists) l.addEventListener('change', onChange);
  return () => {
    for (const l of lists) l.removeEventListener('change', onChange);
  };
}

export function useHudDensity(): HudDensity {
  return useSyncExternalStore(subscribe, read, () => 'regular');
}

/** Sizes that are props rather than CSS (SVG heights), per density. */
export const HUD_METRICS: Record<HudDensity, { sparkline: number; shelf: number; hub: number }> = {
  regular: { sparkline: 32, shelf: 28, hub: 148 },
  compact: { sparkline: 24, shelf: 20, hub: 128 },
  stacked: { sparkline: 40, shelf: 0, hub: 112 },
};

function subscribeMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const l = window.matchMedia('(prefers-reduced-motion: reduce)');
  l.addEventListener('change', onChange);
  return () => l.removeEventListener('change', onChange);
}

/** True when the user asked for reduced motion. CSS already honours it; this is for JS-driven motion. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}
