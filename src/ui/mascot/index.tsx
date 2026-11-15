/**
 * The three characters (Rice, Seed, Satellite) as 3D figures. The models and their clips are the
 * mascot owner's (docs/MASCOT.md); this component mounts one on a transparent canvas.
 *
 * three.js and the model are fetched only when a character is first shown. Until the model is on
 * screen, and when WebGL or the file fails, `fallback` is drawn in its place: the character is
 * decoration with a voice, so nothing depends on the canvas.
 */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { MascotClip, MascotId, MascotStage } from './stage';

export type { MascotClip, MascotId } from './stage';

export interface MascotProps {
  who: MascotId;
  /** A clip to play once; the character returns to its resting clip after it. Change `beat` to replay the same clip. */
  clip?: MascotClip;
  beat?: number;
  /** Drawn while the model loads and when it cannot be shown. */
  fallback?: ReactNode;
  className?: string;
}

const ASSET_BASE = `${import.meta.env.BASE_URL}mascot`.replace(/\/\//g, '/');

export function Mascot({ who, clip, beat = 0, fallback, className }: MascotProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const stage = useRef<MascotStage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let gone = false;
    let made: MascotStage | null = null;
    setState('loading');
    import('./stage')
      .then(async ({ MascotStage: Stage }) => {
        if (gone) return;
        made = new Stage(el, who, ASSET_BASE);
        await made.load();
        if (gone) return;
        stage.current = made;
        setState('ready');
      })
      .catch(() => {
        // No WebGL, or the model did not load: the fallback figure stays.
        made?.dispose();
        made = null;
        if (!gone) setState('failed');
      });
    return () => {
      gone = true;
      stage.current = null;
      made?.dispose();
    };
  }, [who]);

  useEffect(() => {
    if (state === 'ready' && clip) stage.current?.play(clip);
  }, [clip, beat, state]);

  // The eyes follow the pointer across the page.
  useEffect(() => {
    if (state !== 'ready') return;
    const onMove = (e: PointerEvent) => {
      const r = host.current?.getBoundingClientRect();
      if (!r) return;
      stage.current?.setGaze((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2), (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [state]);

  return (
    <div className={className} style={{ position: 'relative' }} data-mascot={who} data-mascot-state={state}>
      <div ref={host} aria-hidden style={{ position: 'absolute', inset: 0, opacity: state === 'ready' ? 1 : 0, transition: 'opacity 240ms ease-out' }} />
      {state !== 'ready' && fallback != null && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{fallback}</div>}
    </div>
  );
}
