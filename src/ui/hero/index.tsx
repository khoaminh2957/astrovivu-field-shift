/**
 * State 1: the hero over the turning globe. One way in (click anywhere, Enter, or the button);
 * when the phase changes the overlay fades while the globe sharpens and starts its approach.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Lang } from '@/contracts';
import { useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, Segmented, Wordmark, cn, usePrefersReducedMotion } from '@/ui/design';
import './strings';

const LEAVE_MS = 420;

export function HeroOverlay() {
  const t = useT();
  const phase = useMission((s) => s.phase);
  const lang = useMission((s) => s.lang);
  const setLang = useMission((s) => s.setLang);
  const enterExplore = useMission((s) => s.enterExplore);
  const reduced = usePrefersReducedMotion();
  const [gone, setGone] = useState(phase !== 'hero');
  const button = useRef<HTMLButtonElement | null>(null);
  const leaving = phase !== 'hero';

  useEffect(() => {
    if (!leaving) {
      setGone(false);
      button.current?.focus({ preventScroll: true });
      return;
    }
    const id = setTimeout(() => setGone(true), reduced ? 0 : LEAVE_MS);
    return () => clearTimeout(id);
  }, [leaving, reduced]);

  useEffect(() => {
    if (leaving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) enterExplore();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leaving, enterExplore]);

  if (gone) return null;

  return (
    <div
      className={cn(
        'absolute inset-0 z-(--z-overlay) cursor-pointer transition-opacity duration-(--dur-slow) ease-in',
        leaving && 'pointer-events-none opacity-0',
      )}
      onClick={() => enterExplore()}
      aria-hidden={leaving || undefined}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-6 px-[clamp(16px,5vw,72px)] pb-[clamp(24px,7vh,72px)] md:flex-row md:items-end md:justify-between">
        <div className="flex max-w-[44rem] flex-col gap-4">
          <h1 className="m-0">
            <Wordmark size="hero" />
          </h1>
          <p className="t-reading m-0 max-w-[34rem] text-md text-ink-1 md:text-lg md:leading-7">{t('hero.line')}</p>
          <p className="t-meta m-0 text-ink-3">{t('hero.sources')}</p>
        </div>

        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="pointer-events-auto flex items-center gap-3">
            <Button
              ref={button}
              variant="primary"
              size="lg"
              iconRight={<ArrowRight />}
              onClick={(e) => {
                e.stopPropagation();
                enterExplore();
              }}
            >
              {t('hero.begin')}
            </Button>
          </div>
          <p className="t-caption m-0">{t('hero.hint')}</p>
          <div className="mt-2 flex flex-col gap-0.5 border-t border-line-2 pt-3 md:items-end">
            <span className="text-xs font-medium text-ink-2 [font-stretch:var(--stretch-semi)]">{t('hero.credit')}</span>
            <span className="t-caption">{t('hero.challenge')}</span>
          </div>
        </div>
      </div>

      <div className="pointer-events-auto absolute top-4 right-[clamp(16px,5vw,72px)]" onClick={(e) => e.stopPropagation()}>
        <Segmented<Lang>
          ariaLabel={t('hero.lang')}
          size="sm"
          value={lang}
          onValueChange={setLang}
          options={[
            { value: 'en', label: 'EN', ariaLabel: 'English' },
            { value: 'vi', label: 'VI', ariaLabel: 'Tiếng Việt' },
          ]}
        />
      </div>
    </div>
  );
}
