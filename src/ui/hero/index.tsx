/**
 * The landing: one question over the turning globe. The answer is given in the finder under it
 * (`@/ui/chrome/Finder`: the search, "Select on map", the demo field), which stays on screen when
 * the visitor leaves, so this overlay holds only what belongs to the landing alone: the question,
 * the wordmark, the language switch and one caption. It takes no pointer events except on the
 * switch: the globe under it can be turned and zoomed. When the phase changes it fades out.
 */
import { useEffect, useState } from 'react';
import { heroGlobeMiddle } from '@/globe';
import { useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { LangSegmented } from '@/ui/chrome/Finder';
import { Wordmark, cn, usePrefersReducedMotion } from '@/ui/design';
import './strings';

const LEAVE_MS = 420;

/** Where the camera puts the middle of the globe, so the question sits on it at every screen size. */
function useGlobeMiddle(): number {
  const read = () => heroGlobeMiddle({ width: window.innerWidth, height: window.innerHeight });
  const [middle, setMiddle] = useState(read);
  useEffect(() => {
    const onResize = () => setMiddle(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return middle;
}

export function HeroOverlay() {
  const t = useT();
  const leaving = useMission((s) => s.phase !== 'hero');
  const reduced = usePrefersReducedMotion();
  const [gone, setGone] = useState(leaving);
  const middle = useGlobeMiddle();

  useEffect(() => {
    if (!leaving) {
      setGone(false);
      return;
    }
    const id = setTimeout(() => setGone(true), reduced ? 0 : LEAVE_MS);
    return () => clearTimeout(id);
  }, [leaving, reduced]);

  if (gone) return null;

  return (
    <div
      className={cn('theme-dark pointer-events-none absolute inset-0 z-(--z-overlay) transition-opacity duration-(--dur-slow) ease-in', leaving && 'opacity-0')}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
    >
      <h1
        style={{ top: middle }}
        className="absolute inset-x-4 m-0 -translate-y-1/2 text-center text-[clamp(1.875rem,calc(1.2rem+2.6vw),3.5rem)] leading-[1.1] font-bold tracking-[-0.01em] text-balance text-white [text-shadow:0_2px_14px_rgb(3_5_11/0.75),0_0_2px_rgb(3_5_11/0.6)]"
      >
        {t('hero.question')}
      </h1>

      <div className="absolute top-4 left-4 md:top-6 md:left-8">
        <Wordmark size="sm" className="text-white [text-shadow:0_1px_3px_rgb(3_5_11/0.8)]" />
      </div>
      <LangSegmented className="pointer-events-auto absolute top-3 right-4 md:top-5 md:right-8" />

      {/* Bottom right, level with the imagery credit the globe writes bottom left. Dropped where the two would meet. */}
      <p className="absolute right-2.5 bottom-1.5 m-0 text-[10px] leading-[13px] text-white/60 [text-shadow:0_1px_2px_rgb(0_0_0/0.95)] max-[560px]:hidden">{t('hero.caption')}</p>
    </div>
  );
}
