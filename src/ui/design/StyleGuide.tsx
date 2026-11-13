import type { Lang } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Wordmark } from './Feedback';
import { usePrefersReducedMotion } from './layout';
import { Segmented } from './Segmented';
import { StatusGlyph } from './Tag';
import './strings';
import { CompositionSection } from './styleguide/Composition';
import { InstrumentsSection } from './styleguide/Instruments';
import { ControlsSection, HonestySection } from './styleguide/Primitives';
import './styleguide/strings';
import { ColourSection, LayoutSection, TypeSection } from './styleguide/Tokens';

const NAV = ['composition', 'color', 'type', 'layout', 'controls', 'honesty', 'instruments'] as const;

/** Night-side globe with a graticule: the ground every primitive is judged against. */
function GlobeBackdrop() {
  const cx = 1010;
  const cy = 1210;
  const r = 1000;
  const lons = [15, 30, 45, 60, 75];
  const lats = [-60, -45, -30, -15, 0, 15, 30, 45, 60, 75];
  return (
    <svg aria-hidden viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 size-full">
      <defs>
        <radialGradient id="sg-globe" cx="38%" cy="22%" r="80%">
          <stop offset="0%" stopColor="#0d1c33" />
          <stop offset="55%" stopColor="#081220" />
          <stop offset="100%" stopColor="#04080f" />
        </radialGradient>
        <radialGradient id="sg-limb" cx="50%" cy="50%" r="50%">
          <stop offset="97.6%" stopColor="#87b1fd" stopOpacity="0" />
          <stop offset="98.4%" stopColor="#87b1fd" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#87b1fd" stopOpacity="0" />
        </radialGradient>
        <clipPath id="sg-sphere">
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r + 16} fill="url(#sg-limb)" />
      <circle cx={cx} cy={cy} r={r} fill="url(#sg-globe)" />
      <g clipPath="url(#sg-sphere)" fill="none" stroke="#92a8b9" strokeOpacity="0.1" strokeWidth="1" transform={`rotate(-16 ${cx} ${cy})`}>
        <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} />
        {lons.map((l) => (
          <ellipse key={l} cx={cx} cy={cy} rx={r * Math.sin((l * Math.PI) / 180)} ry={r} />
        ))}
        {lats.map((l) => {
          const y = cy - r * Math.sin((l * Math.PI) / 180);
          const half = r * Math.cos((l * Math.PI) / 180);
          return <line key={l} x1={cx - half} y1={y} x2={cx + half} y2={y} />;
        })}
      </g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#87b1fd" strokeOpacity="0.28" strokeWidth="1" />
    </svg>
  );
}

/** Living style guide at `#/styleguide`: every token and primitive, in both languages. */
export function StyleGuide() {
  const t = useT();
  const lang = useLang();
  const setLang = useMission((s) => s.setLang);
  const reduced = usePrefersReducedMotion();
  // In-page navigation scrolls instead of changing the hash, which is the app's router.
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

  return (
    <div className="relative h-full overflow-hidden bg-void text-ink-1">
      <GlobeBackdrop />
      <div className="absolute inset-0 overflow-x-hidden overflow-y-auto">
        <header className="sticky top-0 z-(--z-chrome) flex h-(--topbar-h) items-center gap-4 border-b border-line-1 bg-surface-0/95 px-4 lg:px-6">
          <Wordmark />
          <span aria-hidden className="h-4 w-px shrink-0 bg-line-2" />
          <nav aria-label={t('sg.title')} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {NAV.map((id) => (
              <button key={id} type="button" onClick={() => go(id)} className="h-8 shrink-0 rounded-sm px-2 text-sm text-ink-2 [font-stretch:var(--stretch-semi)] hover:bg-surface-2 hover:text-ink-1">
                {t(`sg.nav.${id}`)}
              </button>
            ))}
          </nav>
          <Segmented<Lang>
            ariaLabel={t('sg.lang')}
            size="sm"
            value={lang}
            onValueChange={setLang}
            options={[
              { value: 'en', label: 'EN', ariaLabel: 'English' },
              { value: 'vi', label: 'VI', ariaLabel: 'Tiếng Việt' },
            ]}
          />
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 lg:px-6">
          <div className="pt-12 pb-10">
            <h1 className="text-4xl font-semibold tracking-tight">{t('sg.title')}</h1>
            <p className="t-reading mt-3 max-w-[60ch] text-ink-2">{t('sg.intro')}</p>
            <dl className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-3">
              {(
                [
                  ['light', <span key="g" className="block size-3 bg-signal" />],
                  ['hue', <StatusGlyph key="g" status="watch" size={14} />],
                  ['texture', <span key="g" className="hatch-pending block h-3 w-8 border-x border-stale/60" />],
                ] as const
              ).map(([key, glyph]) => (
                <div key={key} className="border-t border-line-2 pt-4">
                  <dt className="t-title flex items-center gap-2.5">
                    {glyph}
                    {t(`sg.rule.${key}`)}
                  </dt>
                  <dd className="m-0 mt-2 max-w-[46ch] text-sm text-ink-2">{t(`sg.rule.${key}.body`)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <CompositionSection />
          <ColourSection />
          <TypeSection />
          <LayoutSection />
          <ControlsSection />
          <HonestySection />
          <InstrumentsSection />
        </main>
      </div>
    </div>
  );
}
