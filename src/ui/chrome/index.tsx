/**
 * The app shell after the hero. Wide screens (1100 px and up): a grey icon rail on the far left,
 * the white list panel beside it, the map in the rest with a search and its tools floating on it,
 * and, once a field is locked, the field panel floating over the map's right side with a slim
 * timeline strip in the gap. Narrow screens: the map keeps the top of the screen, one scrolling
 * sheet holds the panels, the timeline is pinned above a tab bar.
 * The shell reports the space its panels cover (`setInsets`) so the globe frames the parcel, or a
 * place the camera flies to, in what is left.
 */
import { useEffect, type ReactNode } from 'react';
import { CalendarCheck, Lightbulb, Map as MapIcon, MessageCircleQuestion, Sprout } from 'lucide-react';
import type { Lang } from '@/contracts';
import { BRANCHES } from '@/contracts';
import { SAMPLE_PARCELS } from '@/data';
import { onMapClick, useGlobeStatus } from '@/globe';
import { useMeasureStore } from '@/globe/toolState';
import { useLang, useT } from '@/i18n';
import { pointInPolygon } from '@/lib/geo';
import { type Phase, useMission } from '@/state/mission';
import { AdvisoryPanel } from '@/ui/advisory';
import { StatusTag, Tooltip, cn } from '@/ui/design';
import { FieldPanel } from '@/ui/field/FieldPanel';
import { FieldList, FindField } from '@/ui/field/FindField';
import { TimelineScrubber } from '@/ui/timeline';
import { TrackingView } from '@/ui/tracking';
import { UrbanCompanion } from '@/ui/urban';
import { MapSearch, WeatherChip } from './MapSearch';
import { MapLayerPill, MapLegend, MapToolbar } from './MapToolbar';
import { useMissionUi, useNarrow } from './uiState';
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

const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'vi', name: 'Tiếng Việt' },
];

/** Two visible choices: the demo is bilingual and the switch should not hide behind a menu. */
function LangSwitch({ vertical }: { vertical?: boolean }) {
  const t = useT();
  const lang = useLang();
  const setLang = useMission((s) => s.setLang);
  return (
    <div role="radiogroup" aria-label={t('chrome.lang')} className={cn('flex gap-0.5 rounded-sm p-0.5', vertical ? 'flex-col' : 'bg-surface-3')}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={lang === l.id}
          aria-label={l.name}
          title={l.name}
          onClick={() => setLang(l.id)}
          className={cn(
            't-value rounded-[6px] text-xs',
            vertical ? 'h-7 w-10' : 'h-7 w-9',
            lang === l.id ? (vertical ? 'bg-line-2 text-ink-1' : 'bg-surface-0 text-ink-1 shadow-sm') : 'text-ink-3 hover:text-ink-1',
          )}
        >
          {l.id.toUpperCase()}
        </button>
      ))}
    </div>
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
      className="t-display flex size-10 items-center justify-center rounded-sm bg-signal text-base text-on-signal hover:bg-signal-hover"
    >
      A
    </button>
  );
}

/** Icons only, like the model's rail; the name of each page is its tooltip and its accessible name. */
function Rail() {
  const t = useT();
  const { active, disabled, go } = useNav();
  return (
    <nav aria-label={t('chrome.nav.label')} className="absolute inset-y-0 left-0 z-(--z-chrome) flex w-(--rail-w) flex-col items-center bg-surface-3 pt-4 pb-2">
      <Mark />
      <div className="mt-4 flex flex-col items-center gap-2">
        {NAV.map((n) => (
          <Tooltip key={n.id} content={disabled(n.id) ? `${t(`chrome.${n.key}`)}: ${t('chrome.nav.needField')}` : t(`chrome.${n.id === 'urban' ? 'nav.urbanLong' : n.key}`)} side="right" delay={150}>
            <button
              type="button"
              aria-current={active(n.id) ? 'page' : undefined}
              aria-disabled={disabled(n.id) || undefined}
              aria-label={t(`chrome.${n.key}`)}
              onClick={() => go(n.id)}
              className={cn(
                // The page in view and the one under the pointer share one grey tile, as in the reference rail.
                'flex size-10 items-center justify-center rounded-sm text-ink-1 [&_svg]:size-6 [&_svg]:stroke-[1.5]',
                active(n.id) ? 'bg-line-2' : 'hover:bg-line-2',
                disabled(n.id) && 'cursor-not-allowed opacity-35 hover:bg-transparent',
              )}
            >
              {n.icon}
            </button>
          </Tooltip>
        ))}
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
            'flex min-w-0 flex-col items-center justify-center gap-0.5 text-xs [&_svg]:size-5 [&_svg]:stroke-[1.5]',
            active(n.id) ? 'font-medium text-signal-strong' : 'text-ink-3',
            disabled(n.id) && 'opacity-40',
          )}
        >
          <span className="flex h-7 w-12 items-center justify-center">{n.icon}</span>
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
  else if (done < BRANCHES.length) body = <><span className="skeleton h-3 w-8 shrink-0" aria-hidden /><span className="min-w-0 truncate text-xs text-ink-2">{t('hud.loading.title')} · {t('hud.loading.body', { done })}</span></>;
  if (!body) return null;
  return (
    <div role="status" className={cn('pointer-events-auto flex h-8 max-w-full items-center gap-2 rounded-full bg-surface-0 px-3 shadow-map', className)}>
      {body}
    </div>
  );
}

/** Imagery and terrain credits, hosted by the shell so they sit in the visible part of the map. */
function MapCredits({ className }: { className?: string }) {
  const credits = useGlobeStatus((s) => s.credits);
  if (!credits) return null;
  return (
    <span title={credits} className={cn('pointer-events-auto truncate rounded-xs bg-black/45 px-1.5 text-[10px] leading-4 text-white/85', className)}>
      {credits}
    </span>
  );
}

function RightPanel() {
  const t = useT();
  return (
    <aside aria-label={t('chrome.fieldPanel')} data-panel-scroll className="absolute top-2 right-2 bottom-2 z-(--z-panel) w-(--right-w) overflow-y-auto rounded-lg bg-surface-0 px-6 pt-5 pb-6 shadow-lg">
      <FieldPanel />
    </aside>
  );
}

/** Left edge of the map, and its right edge when the field panel floats over it. */
const MAP_L = 'left-[calc(var(--rail-w)+var(--left-w)+12px)]';
const MAP_R_LOCKED = 'right-[calc(var(--right-w)+20px)]';

function WideField({ locked }: { locked: boolean }) {
  const listMode = useMissionUi((s) => s.listMode);
  return (
    <>
      <aside className="absolute inset-y-0 left-(--rail-w) z-(--z-panel) flex w-(--left-w) flex-col overflow-y-auto rounded-l-sm border-r border-line-1 bg-surface-0 py-4">
        {listMode === 'add' ? <FindField /> : <FieldList />}
      </aside>
      {/* Top row of the map: what the field is coloured by on the left, the place search on the right. */}
      <div className={cn('pointer-events-none absolute top-[15px] z-(--z-map-ui) flex items-start justify-between gap-2', MAP_L, locked ? MAP_R_LOCKED : 'right-[15px]')}>
        <div className="pointer-events-auto flex min-w-0 flex-col items-start gap-2">
          {locked && <MapLayerPill />}
          <MapNotice />
        </div>
        <MapSearch className={cn('pointer-events-auto shrink-0', locked ? 'w-44' : 'w-60')} />
      </div>
      <MapToolbar className={cn('absolute top-1/2 z-(--z-map-ui) -translate-y-1/2', locked ? MAP_R_LOCKED : 'right-[15px]')} />
      {locked ? (
        <>
          {/* Bottom of the map, above the timeline strip: legend and its switch, the weather, the credits. */}
          <div className={cn('pointer-events-none absolute bottom-[calc(var(--strip-h)+16px)] z-(--z-map-ui) flex items-end justify-between gap-2', MAP_L, MAP_R_LOCKED)}>
            <MapLegend className="pointer-events-auto" />
            <WeatherChip className="pointer-events-auto compact:hidden" />
            <MapCredits className="mb-2 min-w-0" />
          </div>
          <TimelineScrubber className={cn('absolute bottom-3 z-(--z-dock) h-(--strip-h) rounded-lg border border-line-1 shadow-md', MAP_L, MAP_R_LOCKED)} />
          <RightPanel />
        </>
      ) : (
        <div className={cn('pointer-events-none absolute right-3 bottom-2 z-(--z-map-ui) flex justify-end', MAP_L)}>
          <MapCredits className="min-w-0" />
        </div>
      )}
    </>
  );
}

function NarrowField({ locked }: { locked: boolean }) {
  const t = useT();
  const full = useMissionUi((s) => s.sheetFull);
  const listMode = useMissionUi((s) => s.listMode);
  const setFull = useMissionUi((s) => s.setSheetFull);
  return (
    <>
      <div className="absolute top-2 left-2 z-(--z-map-ui) flex h-11 items-center gap-2 rounded-full bg-surface-0 pr-1.5 pl-4 shadow-map">
        <span className="t-display text-xs text-ink-1">Astrovivu</span>
        <LangSwitch />
      </div>
      <MapToolbar className="absolute top-2 right-2 z-(--z-map-ui)" />
      <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--map-h)-64px)] z-(--z-map-ui) flex flex-col items-start gap-1.5 px-2">
        <MapNotice className="self-center" />
        <MapCredits className="max-w-full" />
      </div>
      <section
        // Remounted when its content changes kind, so a list scrolled down does not open the field half-way.
        key={locked ? 'field' : listMode}
        data-panel-scroll
        aria-label={locked ? t('chrome.metrics') : t('field.find.title')}
        className={cn(
          'absolute inset-x-0 z-(--z-panel) flex flex-col overflow-x-hidden overflow-y-auto rounded-t-lg bg-surface-0 px-4 pt-0 pb-6 shadow-lg transition-[top] duration-(--dur-base)',
          full ? 'top-14' : 'top-(--map-h)',
          locked ? 'bottom-[calc(var(--tabbar-h)+var(--strip-h))]' : 'bottom-(--tabbar-h)',
        )}
      >
        <div className="sticky top-0 z-10 -mx-4 flex shrink-0 justify-center bg-surface-0">
          <button
            type="button"
            aria-expanded={full}
            aria-label={t(full ? 'chrome.sheet.collapse' : 'chrome.sheet.expand')}
            onClick={() => setFull(!full)}
            className="flex h-6 w-24 items-center justify-center"
          >
            <span aria-hidden className="h-1 w-9 rounded-full bg-line-2" />
          </button>
        </div>
        {locked ? <FieldPanel /> : listMode === 'add' ? <FindField /> : <FieldList />}
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
        // The hero counts as the field view: when the user enters, the globe already knows where the list panel will be.
        const left = px('--rail-w') + (phase === 'explore' || phase === 'locked' || phase === 'hero' ? px('--left-w') : 0);
        // Top: the search row; right: the tool stack (and the field panel); bottom: the legend and the timeline strip.
        setInsets({ top: 56, left, right: (locked ? px('--right-w') + 8 : 0) + 64, bottom: locked ? px('--strip-h') + 48 : 0 });
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
  const setListMode = useMissionUi((s) => s.setListMode);
  const setFieldTab = useMissionUi((s) => s.setFieldTab);
  const parcelId = useMission((s) => s.parcel?.id);
  // A newly selected field opens on Status, and the list panel goes back to the list.
  useEffect(() => {
    if (!parcelId) return;
    setListMode('list');
    setFieldTab('status');
  }, [parcelId, setListMode, setFieldTab]);

  // A click on a demo field's outline selects it, like a click on its row.
  useEffect(
    () =>
      onMapClick((at) => {
        const s = useMission.getState();
        if (s.phase === 'hero' || s.draft || useMissionUi.getState().listMode === 'add' || useMeasureStore.getState().kind) return;
        const hit = SAMPLE_PARCELS.find((p) => pointInPolygon(at, p.polygon));
        if (hit && hit.id !== s.parcel?.id) void s.lockSample(hit.id);
      }),
    [],
  );
  if (phase === 'hero') return null;
  const fieldPhase = phase === 'explore' || phase === 'locked';
  const view = phase === 'advisory' ? <AdvisoryPanel /> : phase === 'tracking' ? <TrackingView /> : phase === 'urban' ? <UrbanCompanion /> : null;
  return (
    <>
      {narrow ? <TabBar /> : <Rail />}
      {fieldPhase && (narrow ? <NarrowField locked={locked} /> : <WideField locked={locked} />)}
      {view && narrow && (
        <div className="absolute inset-x-0 top-0 z-(--z-chrome) flex h-12 items-center justify-between border-b border-line-1 bg-surface-0 px-3">
          <span className="t-display text-xs">Astrovivu</span>
          <LangSwitch />
        </div>
      )}
      {view && <div className="absolute top-0 right-0 bottom-0 left-(--rail-w) z-(--z-panel) overflow-hidden narrow:top-12 narrow:bottom-(--tabbar-h) narrow:left-0">{view}</div>}
    </>
  );
}
