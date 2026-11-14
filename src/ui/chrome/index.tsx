/**
 * The app shell after the hero. Wide screens (1100 px and up): an icon rail on the far left, the
 * field panel beside it, the map in the rest with its toolbar and a slim timeline strip, and the
 * eight metric cards on the right once a field is locked. Narrow screens: the map keeps the top
 * of the screen, one scrolling sheet holds the panels, the timeline is pinned above a tab bar.
 * The shell reports the space its panels cover (`setInsets`) so the globe frames the parcel in what
 * is left.
 */
import { useEffect, type ReactNode } from 'react';
import { CalendarCheck, Lightbulb, Map as MapIcon, MessageCircleQuestion, Sprout } from 'lucide-react';
import type { Lang } from '@/contracts';
import { BRANCHES } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { type Phase, useMission } from '@/state/mission';
import { AdvisoryPanel } from '@/ui/advisory';
import { Segmented, StatusTag, Tooltip, cn } from '@/ui/design';
import { FieldPanel } from '@/ui/field/FieldPanel';
import { FieldList, FindField } from '@/ui/field/FindField';
import { TimelineScrubber } from '@/ui/timeline';
import { TrackingView } from '@/ui/tracking';
import { UrbanCompanion } from '@/ui/urban';
import { MapToolbar } from './MapToolbar';
import { useNarrow } from './uiState';
import './strings';

type NavId = 'field' | 'advisory' | 'tracking' | 'urban' | 'ask';
const NAV: { id: NavId; icon: ReactNode; key: string }[] = [
  { id: 'field', icon: <MapIcon />, key: 'nav.field' },
  { id: 'advisory', icon: <Lightbulb />, key: 'nav.advisory' },
  { id: 'tracking', icon: <CalendarCheck />, key: 'nav.tracking' },
  { id: 'urban', icon: <Sprout />, key: 'nav.urban' },
  { id: 'ask', icon: <MessageCircleQuestion />, key: 'nav.ask' },
];

function useNav() {
  const phase = useMission((s) => s.phase);
  const hasParcel = useMission((s) => !!s.parcel);
  const askOpen = useMission((s) => s.askOpen);
  const setPhase = useMission((s) => s.setPhase);
  const setAskOpen = useMission((s) => s.setAskOpen);
  const active = (id: NavId): boolean =>
    id === 'ask' ? askOpen : id === 'field' ? phase === 'explore' || phase === 'locked' : phase === (id as Phase);
  const disabled = (id: NavId): boolean => (id === 'advisory' || id === 'tracking') && !hasParcel;
  const go = (id: NavId) => {
    if (disabled(id)) return;
    if (id === 'ask') return setAskOpen(!askOpen);
    if (id === 'field') return setPhase(hasParcel ? 'locked' : 'explore');
    setPhase(id as Phase);
  };
  return { active, disabled, go };
}

function LangSwitch({ vertical }: { vertical?: boolean }) {
  const t = useT();
  const lang = useLang();
  const setLang = useMission((s) => s.setLang);
  if (vertical) {
    return (
      <div role="radiogroup" aria-label={t('chrome.lang')} className="flex flex-col gap-0.5 rounded-sm bg-inset p-0.5">
        {(['en', 'vi'] as Lang[]).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={lang === l}
            aria-label={l === 'en' ? 'English' : 'Tiếng Việt'}
            onClick={() => setLang(l)}
            className={cn('t-value h-8 w-10 rounded-xs text-xs', lang === l ? 'bg-signal text-on-signal' : 'text-ink-2 hover:text-ink-1')}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    );
  }
  return (
    <Segmented<Lang>
      ariaLabel={t('chrome.lang')}
      size="md"
      value={lang}
      onValueChange={setLang}
      options={[
        { value: 'en', label: 'EN', ariaLabel: 'English' },
        { value: 'vi', label: 'VI', ariaLabel: 'Tiếng Việt' },
      ]}
    />
  );
}

function Mark() {
  const t = useT();
  const unlock = useMission((s) => s.unlockParcel);
  const hasParcel = useMission((s) => !!s.parcel);
  const setPhase = useMission((s) => s.setPhase);
  return (
    <button
      type="button"
      aria-label={t('chrome.home')}
      onClick={() => (hasParcel ? unlock() : setPhase('explore'))}
      className="t-display flex size-10 items-center justify-center rounded-md bg-signal text-base text-on-signal shadow-sm hover:brightness-110"
    >
      A
    </button>
  );
}

function Rail() {
  const t = useT();
  const { active, disabled, go } = useNav();
  return (
    <nav aria-label={t('chrome.nav.label')} className="absolute inset-y-0 left-0 z-(--z-chrome) flex w-(--rail-w) flex-col items-center gap-1 bg-surface-3 py-2">
      <Mark />
      <div className="mt-4 flex flex-col items-center gap-1">
        {NAV.map((n) => {
          const btn = (
            <button
              type="button"
              aria-current={active(n.id) ? 'page' : undefined}
              aria-disabled={disabled(n.id) || undefined}
              aria-label={t(`chrome.${n.key}`)}
              onClick={() => go(n.id)}
              className={cn(
                'flex w-12 flex-col items-center gap-1 rounded-sm py-2 text-[11px] leading-none [font-stretch:var(--stretch-condensed)] [&_svg]:size-5 [&_svg]:stroke-[1.5]',
                active(n.id) ? 'bg-surface-0 text-signal shadow-sm' : 'text-ink-2 hover:bg-surface-0/60 hover:text-ink-1',
                disabled(n.id) && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-ink-3',
                n.id === 'ask' && 'mt-3',
              )}
            >
              {n.icon}
              <span aria-hidden className="max-w-full truncate">
                {t(`chrome.${n.key}`)}
              </span>
            </button>
          );
          return (
            <Tooltip key={n.id} content={disabled(n.id) ? t('chrome.nav.needField') : t(`chrome.${n.id === 'urban' ? 'nav.urbanLong' : n.key}`)} side="right">
              {btn}
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-auto">
        <LangSwitch vertical />
      </div>
    </nav>
  );
}

function TabBar() {
  const t = useT();
  const { active, disabled, go } = useNav();
  return (
    <nav aria-label={t('chrome.nav.label')} className="absolute inset-x-0 bottom-0 z-(--z-chrome) grid h-(--tabbar-h) grid-cols-5 border-t border-line-1 bg-surface-0 safe-bottom">
      {NAV.map((n) => (
        <button
          key={n.id}
          type="button"
          aria-current={active(n.id) ? 'page' : undefined}
          aria-disabled={disabled(n.id) || undefined}
          onClick={() => go(n.id)}
          className={cn(
            'flex min-w-0 flex-col items-center justify-center gap-1 text-xs [&_svg]:size-5 [&_svg]:stroke-[1.5]',
            active(n.id) ? 'text-ink-1' : 'text-ink-3',
            disabled(n.id) && 'opacity-45',
          )}
        >
          <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', active(n.id) && 'bg-surface-3')}>{n.icon}</span>
          <span className="max-w-full truncate px-1">{t(`chrome.${n.key}`)}</span>
        </button>
      ))}
    </nav>
  );
}

/** Loading and failure, said plainly over the map. Quiet when all is well. */
function MapNotice({ className }: { className?: string }) {
  const t = useT();
  const status = useMission((s) => s.branchStatus);
  const loadError = useMission((s) => s.loadError);
  const locked = useMission((s) => s.phase === 'locked');
  const done = BRANCHES.filter((b) => status[b] === 'ready' || status[b] === 'error').length;
  if (!locked) return null;
  let body: ReactNode = null;
  if (loadError) body = <><StatusTag status="alert" label={t('hud.error.title')} /><span className="t-caption min-w-0 truncate">{loadError}</span></>;
  else if (done < BRANCHES.length) body = <><span className="skeleton h-3 w-8 shrink-0" aria-hidden /><span className="min-w-0 truncate text-sm text-ink-2">{t('hud.loading.title')} · {t('hud.loading.body', { done })}</span></>;
  if (!body) return null;
  return (
    <div role="status" className={cn('plate pointer-events-auto flex max-w-[min(480px,calc(100%-24px))] items-center gap-2 px-3 py-1.5 shadow-md', className)}>
      {body}
    </div>
  );
}

function RightPanel() {
  const t = useT();
  return (
    <aside aria-label={t('chrome.fieldPanel')} className="absolute top-2 right-2 bottom-2 z-(--z-panel) w-(--right-w) overflow-y-auto rounded-lg border border-line-1 bg-surface-0 px-6 py-5 shadow-lg">
      <FieldPanel />
    </aside>
  );
}

function WideField({ locked }: { locked: boolean }) {
  return (
    <>
      <aside className="absolute inset-y-0 left-(--rail-w) z-(--z-panel) w-(--left-w) overflow-y-auto rounded-l-sm border-r border-line-1 bg-surface-0 px-4 py-4">
        {locked ? <FieldList /> : <FindField />}
      </aside>
      <div className={cn('pointer-events-none absolute top-3 z-(--z-map-ui) flex justify-center', 'left-[calc(var(--rail-w)+var(--left-w)+12px)]', locked ? 'right-[calc(var(--right-w)+64px)]' : 'right-16')}>
        <MapNotice />
      </div>
      <MapToolbar className={cn('absolute top-3 z-(--z-map-ui)', locked ? 'right-[calc(var(--right-w)+20px)]' : 'right-3')} />
      {locked && (
        <>
          <TimelineScrubber className="absolute bottom-3 left-[calc(var(--rail-w)+var(--left-w)+12px)] right-[calc(var(--right-w)+20px)] z-(--z-dock) h-(--strip-h) rounded-lg border border-line-1" />
          <RightPanel />
        </>
      )}
    </>
  );
}

function NarrowField({ locked }: { locked: boolean }) {
  const t = useT();
  return (
    <>
      <div className="absolute top-2 left-2 z-(--z-map-ui) flex items-center gap-2">
        <div className="plate flex items-center gap-2 p-1 pl-2 shadow-md">
          <span className="t-display text-xs">Astrovivu</span>
          <LangSwitch />
        </div>
      </div>
      <MapToolbar className="absolute top-2 right-2 z-(--z-map-ui)" />
      <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--map-h)-44px)] z-(--z-map-ui) flex justify-center px-3">
        <MapNotice />
      </div>
      <section
        aria-label={locked ? t('chrome.metrics') : t('field.find.title')}
        className={cn(
          'absolute inset-x-0 top-(--map-h) z-(--z-panel) overflow-x-hidden overflow-y-auto border-t border-line-2 bg-surface-0 px-4 pt-4 pb-6',
          locked ? 'bottom-[calc(var(--tabbar-h)+var(--strip-h))]' : 'bottom-(--tabbar-h)',
        )}
      >
        {locked ? (
          <FieldPanel />
        ) : (
          <FindField />
        )}
      </section>
      {locked && <TimelineScrubber className="absolute inset-x-0 bottom-(--tabbar-h) z-(--z-dock) h-(--strip-h) border-t border-line-1" />}
    </>
  );
}

/** Reports the screen space the panels cover, so the globe frames the parcel in the free part. */
function useReportInsets(narrow: boolean, locked: boolean, phase: Phase) {
  const setInsets = useMission((s) => s.setInsets);
  useEffect(() => {
    const report = () => {
      const css = getComputedStyle(document.documentElement);
      const px = (v: string) => parseFloat(css.getPropertyValue(v)) || 0;
      if (narrow) {
        const mapH = Math.round(window.innerHeight * 0.45);
        setInsets({ top: 52, left: 0, right: 56, bottom: Math.max(0, window.innerHeight - mapH) });
      } else {
        const left = px('--rail-w') + (phase === 'explore' || phase === 'locked' ? px('--left-w') : 0);
        setInsets({ top: 0, left, right: (locked ? px('--right-w') : 0) + 56, bottom: locked ? px('--strip-h') : 0 });
      }
    };
    report();
    window.addEventListener('resize', report);
    return () => window.removeEventListener('resize', report);
  }, [narrow, locked, phase, setInsets]);
}

export function Shell() {
  const phase = useMission((s) => s.phase);
  const hasParcel = useMission((s) => !!s.parcel);
  const narrow = useNarrow();
  const locked = phase === 'locked' && hasParcel;
  useReportInsets(narrow, locked, phase);
  if (phase === 'hero') return null;
  const fieldPhase = phase === 'explore' || phase === 'locked';
  const view = phase === 'advisory' ? <AdvisoryPanel /> : phase === 'tracking' ? <TrackingView /> : phase === 'urban' ? <UrbanCompanion /> : null;
  return (
    <>
      {narrow ? <TabBar /> : <Rail />}
      {fieldPhase && (narrow ? <NarrowField locked={locked} /> : <WideField locked={locked} />)}
      {view && <div className="absolute top-0 right-0 bottom-0 left-(--rail-w) z-(--z-panel) overflow-hidden narrow:bottom-(--tabbar-h) narrow:left-0">{view}</div>}
    </>
  );
}
