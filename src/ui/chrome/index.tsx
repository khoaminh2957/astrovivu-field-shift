/**
 * The app shell. Three layouts:
 *   No field open (the landing, and the map while the visitor looks for their field): the finder at
 *   the bottom centre is the whole interface; on the map the tools join it on the right edge.
 *   A field open, wide screens (1100 px and up): a grey icon rail on the far left, the list column
 *   beside it (it folds away), the map in the rest with the search and its tools floating on it,
 *   the field panel over the map's right side and a slim timeline strip in the gap.
 *   A field open, narrow screens: the map keeps the top of the screen, one scrolling sheet holds
 *   the field panel, the timeline is pinned above a tab bar.
 * The shell reports the space its panels cover (`setInsets`) so the globe frames the parcel, or a
 * place the camera flies to, in what is left.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb, Map as MapIcon, MessageCircleQuestion, Sprout } from 'lucide-react';
import type { Lang } from '@/contracts';
import { BRANCHES } from '@/contracts';
import { DEMO_FIELD } from '@/data';
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
import { UrbanCompanion } from '@/ui/urban';
import { Finder } from './Finder';
import { goHome } from './finderActions';
import { MapLayerPill, MapLegend, MapToolbar } from './MapToolbar';
import { PlaceSearch } from './PlaceSearch';
import { WeatherChip } from './Weather';
import { ADD_CARD, useMissionUi, useNarrow } from './uiState';
import './strings';

type NavId = 'field' | 'advisory' | 'urban' | 'ask';
const NAV: { id: NavId; icon: ReactNode; key: string }[] = [
  { id: 'field', icon: <MapIcon />, key: 'nav.field' },
  { id: 'advisory', icon: <Lightbulb />, key: 'nav.advisory' },
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
  const disabled = (id: NavId): boolean => id === 'advisory' && !hasParcel;
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
  return (
    <button
      type="button"
      aria-label={t('chrome.home')}
      onClick={goHome}
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
    <nav aria-label={t('chrome.nav.label')} className="absolute inset-x-0 bottom-0 z-(--z-chrome) grid h-(--tabbar-h) grid-cols-4 border-t border-line-1 bg-surface-0 safe-bottom">
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

/** Left edge of the map, and its right edge under the field panel. `--left-w` is 0 while the list column is folded. */
const MAP_L = 'left-[calc(var(--rail-w)+var(--left-w)+12px)]';
const MAP_R = 'right-[calc(var(--right-w)+20px)]';
const LIST_ID = 'field-list-column';

/** The tab on the list column's edge that folds the column away and brings it back. */
function ListFold({ folded }: { folded: boolean }) {
  const t = useT();
  const setFolded = useMissionUi((s) => s.setListFolded);
  const label = t(folded ? 'chrome.list.unfold' : 'chrome.list.fold');
  return (
    <Tooltip content={label} side="right" delay={150}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={!folded}
        aria-controls={LIST_ID}
        onClick={() => setFolded(!folded)}
        className="absolute top-1/2 left-[calc(var(--rail-w)+var(--left-w))] z-(--z-panel) flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-r-sm border border-l-0 border-line-1 bg-surface-0 text-ink-2 shadow-md hover:bg-surface-2 hover:text-ink-1"
      >
        {folded ? <ChevronRight size={16} aria-hidden /> : <ChevronLeft size={16} aria-hidden />}
      </button>
    </Tooltip>
  );
}

/** A field is open on a wide screen: list column, map furniture, timeline strip, field panel. */
function WideField() {
  const listMode = useMissionUi((s) => s.listMode);
  const folded = useMissionUi((s) => s.listFolded);
  return (
    // No box of its own: it only carries the column width down to the map furniture.
    <div className="contents" style={folded ? ({ '--left-w': '0px' } as CSSProperties) : undefined}>
      <aside id={LIST_ID} hidden={folded} className={cn('absolute inset-y-0 left-(--rail-w) z-(--z-panel) w-(--left-w) flex-col overflow-y-auto rounded-l-sm border-r border-line-1 bg-surface-0 py-4', !folded && 'flex')}>
        {listMode === 'add' ? <FindField /> : <FieldList />}
      </aside>
      <ListFold folded={folded} />
      {/* Top row of the map: what the field is coloured by on the left, the search on the right. */}
      <div className={cn('pointer-events-none absolute top-[15px] z-(--z-map-ui) flex items-start justify-between gap-2', MAP_L, MAP_R)}>
        <div className="pointer-events-auto flex min-w-0 flex-col items-start gap-2">
          <MapLayerPill />
          <MapNotice />
        </div>
        <PlaceSearch look="map" compact={!folded} className={cn('pointer-events-auto shrink-0', folded ? 'w-64' : 'w-44')} />
      </div>
      <MapToolbar className={cn('absolute top-1/2 z-(--z-map-ui) -translate-y-1/2', MAP_R)} />
      {/* Bottom of the map, above the timeline strip: legend and its switch, the weather, the credits. */}
      <div className={cn('pointer-events-none absolute bottom-[calc(var(--strip-h)+16px)] z-(--z-map-ui) flex items-end justify-between gap-2', MAP_L, MAP_R)}>
        <MapLegend className="pointer-events-auto" />
        <WeatherChip className="pointer-events-auto compact:hidden" />
        <MapCredits className="mb-2 min-w-0" />
      </div>
      <TimelineScrubber className={cn('absolute bottom-3 z-(--z-dock) h-(--strip-h) rounded-lg border border-line-1 shadow-md', MAP_L, MAP_R)} />
      <RightPanel />
    </div>
  );
}

/** No field open yet: the map is the screen. Its tools keep the right edge; the finder (mounted by the shell) holds the rest. */
function ExploreMap({ narrow }: { narrow: boolean }) {
  return (
    <>
      <MapToolbar className={cn('absolute z-(--z-map-ui)', narrow ? 'top-2 right-2' : 'top-1/2 right-[15px] -translate-y-1/2')} />
      {/* The finder owns the bottom edge of a narrow screen, so the credits go to the top there. */}
      <div className={cn('pointer-events-none absolute left-2.5 z-(--z-map-ui) flex', narrow ? 'top-2 right-16' : 'right-[calc(50%+309px)] bottom-1.5')}>
        <MapCredits className="min-w-0" />
      </div>
    </>
  );
}

/** A field is open on a narrow screen. */
function NarrowField() {
  const t = useT();
  const full = useMissionUi((s) => s.sheetFull);
  const setFull = useMissionUi((s) => s.setSheetFull);
  return (
    <>
      <div className="absolute top-2 left-2 z-(--z-map-ui) flex h-11 items-center gap-2 rounded-full bg-surface-0 pr-1.5 pl-1.5 shadow-map">
        <button type="button" aria-label={t('chrome.home')} onClick={goHome} className="t-display flex h-8 items-center rounded-full pr-1 pl-2.5 text-xs text-ink-1 hover:bg-surface-2">
          Astrovivu
        </button>
        <LangSwitch />
      </div>
      <MapToolbar className="absolute top-2 right-2 z-(--z-map-ui)" />
      <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--map-h)-64px)] z-(--z-map-ui) flex flex-col items-start gap-1.5 px-2">
        <MapNotice className="self-center" />
        <MapCredits className="max-w-full" />
      </div>
      <section
        data-panel-scroll
        aria-label={t('chrome.metrics')}
        className={cn(
          'absolute inset-x-0 bottom-[calc(var(--tabbar-h)+var(--strip-h))] z-(--z-panel) flex flex-col overflow-x-hidden overflow-y-auto rounded-t-lg bg-surface-0 px-4 pt-0 pb-6 shadow-lg transition-[top] duration-(--dur-base)',
          full ? 'top-14' : 'top-(--map-h)',
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
        <FieldPanel />
      </section>
      <TimelineScrubber className="absolute inset-x-0 bottom-(--tabbar-h) z-(--z-dock) h-(--strip-h) border-t border-line-1" />
    </>
  );
}

/** What the finder covers before it has measured itself: its box, without anything open above it. */
const FINDER_H = 150;

/** Reports the screen space the panels cover, so the globe frames the parcel in the free part. */
function useReportInsets(narrow: boolean, locked: boolean, finding: boolean) {
  const setInsets = useMission((s) => s.setInsets);
  const folded = useMissionUi((s) => s.listFolded);
  const finderH = useMissionUi((s) => s.finderH);
  const addCard = useMissionUi((s) => s.addCard);
  useEffect(() => {
    const report = () => {
      const css = getComputedStyle(document.documentElement);
      const px = (v: string) => parseFloat(css.getPropertyValue(v)) || 0;
      if (finding) {
        // The landing reports the same as the map after it: when the visitor enters, the globe already knows its room.
        // Wide screens keep the tool stack's width free on both sides, so the globe stays above the middle of the finder.
        const side = narrow ? 0 : 64;
        // The add-a-field card takes the left edge of a wide screen; on a narrow one it is part of the finder's height.
        const left = !narrow && addCard ? ADD_CARD.margin + ADD_CARD.width : side;
        setInsets({ top: 12, left, right: side, bottom: (finderH || FINDER_H) + 12 });
      } else if (narrow) {
        const mapH = Math.round(window.innerHeight * 0.45);
        setInsets({ top: 52, left: 0, right: 56, bottom: Math.max(0, window.innerHeight - mapH) });
      } else {
        const left = px('--rail-w') + (locked && !folded ? px('--left-w') : 0);
        // Top: the search row; right: the tool stack and the field panel; bottom: the legend and the timeline strip.
        setInsets({ top: 56, left, right: (locked ? px('--right-w') + 8 : 0) + 64, bottom: locked ? px('--strip-h') + 48 : 0 });
      }
    };
    report();
    window.addEventListener('resize', report);
    return () => window.removeEventListener('resize', report);
  }, [narrow, locked, finding, folded, finderH, addCard, setInsets]);
}

export function Shell() {
  const phase = useMission((s) => s.phase);
  const hasParcel = useMission((s) => !!s.parcel);
  const narrow = useNarrow();
  const locked = phase === 'locked' && hasParcel;
  const hero = phase === 'hero';
  /** No field is open and the visitor is finding one: on the landing, or on the map after it. */
  const finding = hero || ((phase === 'explore' || phase === 'locked') && !locked);
  useReportInsets(narrow, locked, finding);
  const setListMode = useMissionUi((s) => s.setListMode);
  const setFieldTab = useMissionUi((s) => s.setFieldTab);
  const setOwnField = useMissionUi((s) => s.setOwnField);
  const parcel = useMission((s) => s.parcel);
  const parcelId = parcel?.id;
  // A newly selected field opens on its overview, and the list panel goes back to the list.
  useEffect(() => {
    if (!parcelId) return;
    setListMode('list');
    setFieldTab('overview');
  }, [parcelId, setListMode, setFieldTab]);
  // A field the visitor made stays on offer for the session, in the list and in the search.
  useEffect(() => {
    if (parcel && parcel.source !== 'sample') setOwnField(parcel);
  }, [parcel, setOwnField]);

  // A click on the demo field's outline selects it, like a click on its row.
  useEffect(
    () =>
      onMapClick((at) => {
        const s = useMission.getState();
        if (s.phase === 'hero' || s.draft || useMissionUi.getState().listMode === 'add' || useMeasureStore.getState().kind) return;
        if (DEMO_FIELD.id !== s.parcel?.id && pointInPolygon(at, DEMO_FIELD.polygon)) void s.lockSample(DEMO_FIELD.id);
      }),
    [],
  );
  const view = phase === 'advisory' ? <AdvisoryPanel /> : phase === 'urban' ? <UrbanCompanion /> : null;
  return (
    <>
      {finding && <Finder />}
      {finding && !hero && <ExploreMap narrow={narrow} />}
      {!finding && (narrow ? <TabBar /> : <Rail />)}
      {locked && (narrow ? <NarrowField /> : <WideField />)}
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
