import { useEffect, useRef, useState } from 'react';
import type { LngLat } from '@/contracts';
import { useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { GlobeEngine, getActiveGlobe, type MotionPref } from './engine';
import { setGlobeStatus } from './status';

/** `?motion=full|reduced` overrides the system setting, for demos and for testing both paths. */
export function motionFromQuery(): MotionPref {
  const m = new URLSearchParams(window.location.search).get('motion');
  return m === 'full' || m === 'reduced' ? m : 'auto';
}

/**
 * Moves the camera to a place (search result, "take me there"). Call it from UI code; it does
 * nothing while a parcel is locked or before the map exists.
 */
export function flyToPlace(location: LngLat, zoom?: number): void {
  getActiveGlobe()?.flyToPlace(location, zoom);
}

/** Brings the camera back onto the locked parcel after the user has panned or zoomed away. */
export function refocusParcel(): void {
  getActiveGlobe()?.refocus();
}

/** Shown instead of the map when the browser cannot give us WebGL 2. The rest of the app keeps working. */
function NoWebGL() {
  const t = useT();
  const parcel = useMission((s) => s.parcel);
  const setAnchor = useMission((s) => s.setAnchor);

  // The HUD still needs somewhere to attach: give it a fixed box where the parcel would be.
  useEffect(() => {
    if (!parcel) {
      setAnchor(null);
      return;
    }
    const update = () => setAnchor({ x: window.innerWidth / 2, y: window.innerHeight * 0.44, w: 200, h: 130, visible: true });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [parcel, setAnchor]);

  return (
    <div className="globe-fallback" role="status">
      <h2>{t('globe.webgl.title')}</h2>
      <p>{t('globe.webgl.body')}</p>
    </div>
  );
}

export interface GlobeCanvasProps {
  /** Overrides the motion preference (the bench uses it); defaults to `?motion=` or the system setting. */
  motion?: MotionPref;
}

/**
 * Full-bleed map canvas. Mount it once, behind everything else. It renders exactly once: all
 * map work happens in `GlobeEngine`, outside React.
 */
export function GlobeCanvas({ motion }: GlobeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const initialMotion = useRef(motion);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: GlobeEngine | null = null;
    try {
      engine = new GlobeEngine(host, { motion: initialMotion.current ?? motionFromQuery() });
      engineRef.current = engine;
      setFailed(false);
    } catch (err) {
      // MapLibre throws GPUInitializationError when no WebGL 2 context can be created.
      console.warn('[globe] map could not start:', err);
      setGlobeStatus({ webgl: false, ready: false });
      setFailed(true);
    }
    return () => {
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  // The engine is built once; a changed preference is applied to it, not a reason to rebuild.
  useEffect(() => {
    if (motion) engineRef.current?.setMotion(motion);
  }, [motion]);

  return (
    <div className="globe-root" data-globe>
      <div className="globe-host" ref={hostRef} />
      {failed && <NoWebGL />}
    </div>
  );
}
