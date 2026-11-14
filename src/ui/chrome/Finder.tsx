/**
 * The finder: everything a visitor needs before a field is open, in one place at the bottom centre
 * of the screen. On the landing it is the search and two pills, drawn straight on the night sky.
 * On the map (explore) the same controls sit in a frosted box and gain the urban grower, the
 * assistant and the language switch, because there is no rail yet; the add-a-field step opens above
 * the box. The component stays mounted across the two phases, so the search does not jump.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, MessageCircleQuestion, MousePointer2, Sprout } from 'lucide-react';
import type { Lang } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Segmented, cn } from '@/ui/design';
import { FindField } from '@/ui/field/FindField';
import { openDemoField, setSelectOnMap } from './finderActions';
import { PlaceSearch } from './PlaceSearch';
import { useMissionUi } from './uiState';
import './strings';

/** EN / VI as two visible choices, on a dark surface. */
export function LangSegmented({ className }: { className?: string }) {
  const t = useT();
  const lang = useLang();
  const setLang = useMission((s) => s.setLang);
  return (
    <Segmented<Lang>
      ariaLabel={t('chrome.lang')}
      size="lg"
      value={lang}
      onValueChange={setLang}
      className={className}
      options={[
        { value: 'en', label: 'EN', ariaLabel: 'English' },
        { value: 'vi', label: 'VI', ariaLabel: 'Tiếng Việt' },
      ]}
    />
  );
}

interface PillProps {
  children: ReactNode;
  icon?: ReactNode;
  /** A toggle: filled and ticked while on, so the state does not rest on colour alone. */
  pressed?: boolean;
  /** The larger pill of the landing. */
  large: boolean;
  /** The longer name, for a pill whose text is a short form of it. */
  label?: string;
  onClick: () => void;
}

function Pill({ children, icon, pressed, large, label, onClick }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'pointer-events-auto inline-flex shrink-0 items-center justify-center rounded-full border font-medium whitespace-nowrap transition-colors duration-(--dur-fast) [&_svg]:shrink-0 [&_svg]:stroke-[1.5]',
        large ? 'h-12 gap-2.5 px-5 text-lg narrow:h-11 narrow:px-4 narrow:text-md [&_svg]:size-5' : 'h-10 gap-2 px-3.5 text-base narrow:h-11 [&_svg]:size-[18px]',
        pressed ? 'border-white bg-white text-on-signal hover:bg-white/90' : 'border-white/70 bg-surface-0/45 text-white hover:border-white hover:bg-white/15',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Finder() {
  const t = useT();
  const hero = useMission((s) => s.phase === 'hero');
  const setPhase = useMission((s) => s.setPhase);
  const setAskOpen = useMission((s) => s.setAskOpen);
  const askOpen = useMission((s) => s.askOpen);
  const adding = useMissionUi((s) => s.listMode === 'add');
  const picking = useMissionUi((s) => s.listMode === 'add' && s.addWay === 'map');
  const setFinderH = useMissionUi((s) => s.setFinderH);
  const [listOpen, setListOpen] = useState(false);
  const stack = useRef<HTMLDivElement>(null);

  // The shell reserves this much of the map's bottom edge, so a place the camera flies to lands above the finder.
  useEffect(() => {
    const el = stack.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFinderH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => {
      ro.disconnect();
      setFinderH(0);
    };
  }, [setFinderH]);

  return (
    <div className={cn('theme-dark pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-2', hero ? 'z-(--z-overlay)' : 'z-(--z-chrome)')}>
      <div ref={stack} className="flex w-full max-w-[594px] flex-col gap-2">
        {adding && !hero && <FindField floating />}
        <section
          aria-label={t('finder.label')}
          className={cn(
            'flex flex-col gap-3 rounded-[28px] border p-3 transition-colors duration-(--dur-slow) narrow:px-2',
            // On the landing only the controls take the pointer: the globe turns under the gaps between them.
            hero
              ? 'pointer-events-none border-transparent'
              : 'pointer-events-auto border-white/20 bg-surface-0 shadow-lg supports-[backdrop-filter:blur(1px)]:bg-surface-0/75 supports-[backdrop-filter:blur(1px)]:backdrop-blur-md',
          )}
        >
          <PlaceSearch look="glass" onOpenChange={setListOpen} className="pointer-events-auto" />
          {/* Kept in the layout while the list is open, so the search does not move under the typing hand. */}
          <div className={cn('flex flex-wrap items-center justify-center gap-2', hero && 'gap-x-4', listOpen && 'invisible')}>
            <Pill large={hero} pressed={hero ? undefined : picking} icon={picking ? <Check aria-hidden /> : <MousePointer2 aria-hidden />} onClick={() => setSelectOnMap(!picking)}>
              {t('finder.selectMap')}
            </Pill>
            <Pill large={hero} onClick={openDemoField}>
              {t(hero ? 'finder.demo' : 'finder.demoShort')}
            </Pill>
            {!hero && (
              <>
                <Pill large={false} label={t('chrome.nav.urbanLong')} icon={<Sprout aria-hidden />} onClick={() => setPhase('urban')}>
                  {t('chrome.nav.urban')}
                </Pill>
                <Pill large={false} pressed={askOpen} icon={<MessageCircleQuestion aria-hidden />} onClick={() => setAskOpen(!askOpen)}>
                  {t('chrome.nav.ask')}
                </Pill>
                <LangSegmented className="pointer-events-auto" />
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
