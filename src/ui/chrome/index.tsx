/**
 * The app shell. Three layouts:
 *   No field open (the landing, and the map while the visitor looks for their field): the finder at
 *   the bottom centre is the whole interface; on the map the tools join it on the right edge.
 *   A field open, wide screens (1100 px and up): the rail and the field panel sit on the left.
 *   The rail is the path a grower walks: (1) the field as it is, (2) the rotation (the farm stage,
 *   the comparison, the plan), (3) the dossier. Urban and Ask stand apart under a rule.
 *   The map fills the right, with its tools, legend and timeline inside it.
 *   A field open, narrow screens: the map keeps the top of the screen, one scrolling sheet holds
 *   the field panel, the timeline is pinned above a tab bar.
 * The shell reports the space its panels cover (`setInsets`) so the globe frames the parcel, or a
 * place the camera flies to, in what is left.
 */
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Building2, FileText, Map as MapIcon, MessageCircleQuestion, RefreshCw } from 'lucide-react';
import type { Lang } from '@/contracts';
import { BRANCHES } from '@/contracts';
import { DEMO_FIELD } from '@/data';
import { onMapClick, useGlobeStatus } from '@/globe';
import { useMeasureStore } from '@/globe/toolState';
import { useLang, useT } from '@/i18n';
import { pointInPolygon } from '@/lib/geo';
import { type Phase, useMission } from '@/state/mission';
import { AdvisoryPanel } from '@/ui/advisory';
import { Button, Dialog, StatusTag, Tooltip, cn } from '@/ui/design';
import { FieldPanel } from '@/ui/field/FieldPanel';
import { FieldList, FindField } from '@/ui/field/FindField';
import { TimelineScrubber } from '@/ui/timeline';
import { UrbanCompanion } from '@/ui/urban';
import { Finder } from './Finder';
import { goLanding } from './finderActions';
import { MapLayerPill, MapLegend, MapToolbar } from './MapToolbar';
import { PlaceSearch } from './PlaceSearch';
import { getShellInsets } from './shellInsets';
import { useStepUrl } from './stepUrl';
import { useMissionUi, useNarrow } from './uiState';
import './strings';

type NavId = 'field' | 'advisory' | 'dossier' | 'urban' | 'ask';
/** The three steps of a field, numbered, then what stands apart from them. */
const NAV: { id: NavId; icon: ReactNode; key: string; step?: number; rule?: boolean }[] = [
  { id: 'field', icon: <MapIcon />, key: 'nav.field', step: 1 },
  { id: 'advisory', icon: <RefreshCw />, key: 'nav.advisory', step: 2 },
  { id: 'dossier', icon: <FileText />, key: 'nav.dossier', step: 3 },
  { id: 'urban', icon: <Building2 />, key: 'nav.urban', rule: true },
  { id: 'ask', icon: <MessageCircleQuestion />, key: 'nav.ask' },
];

export function useNav() {
  const phase = useMission((s) => s.phase);
  const hasParcel = useMission((s) => !!s.parcel);
  const askOpen = useMission((s) => s.askOpen);
  const setPhase = useMission((s) => s.setPhase);
  const setAskOpen = useMission((s) => s.setAskOpen);
  const view = useMissionUi((s) => s.advisoryView);
  const setView = useMissionUi((s) => s.setAdvisoryView);
  const active = (id: NavId): boolean =>
    id === 'ask'
      ? askOpen
      : id === 'field'
        ? phase === 'explore' || phase === 'locked'
        : id === 'advisory'
          ? phase === 'advisory' && view !== 'dossier'
          : id === 'dossier'
            ? phase === 'advisory' && view === 'dossier'
            : phase === id;
  const disabled = (id: NavId): boolean => (id === 'advisory' || id === 'dossier') && !hasParcel;
  const go = (id: NavId) => {
    if (disabled(id)) return;
    if (id === 'ask') return setAskOpen(!askOpen);
    if (askOpen) setAskOpen(false);
    if (id === 'field') return setPhase(hasParcel ? 'locked' : 'explore');
    if (id === 'dossier') {
      setView('dossier');
      return setPhase('advisory');
    }
    if (id === 'advisory' && view === 'dossier') setView('farm');
    setPhase(id);
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

/**
 * The mark leads to the landing. With a field open that closes the field, so it asks first: losing
 * the open field without warning was the most confusing jump of the old shell.
 */
function Mark() {
  const t = useT();
  const hasParcel = useMission((s) => !!s.parcel);
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button type="button" aria-label={t('chrome.home')} onClick={() => (hasParcel ? setAsking(true) : goLanding())} className="workspace-mark">
        A
      </button>
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        size="sm"
        title={t('chrome.leave.title')}
        description={t('chrome.leave.body')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t('chrome.leave.stay')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setAsking(false);
                goLanding();
              }}
            >
              {t('chrome.leave.go')}
            </Button>
          </>
        }
      />
    </>
  );
}

/** Keep the same destinations and labels available on desktop and mobile. */
function Rail() {
  const t = useT();
  const { active, disabled, go } = useNav();
  return (
    <nav aria-label={t('chrome.nav.label')} className="workspace-rail absolute inset-y-0 left-0 z-(--z-chrome) flex flex-col items-center">
      <Mark />
      <div className="workspace-nav-items">
        {NAV.map((n) => (
          <div key={n.id} className="contents">
            {n.rule && <span aria-hidden className="workspace-nav-rule" />}
            <Tooltip content={disabled(n.id) ? `${t(`chrome.${n.key}`)}: ${t('chrome.nav.needField')}` : t(`chrome.${n.key}Long`)} side="right" delay={150}>
              <button
                type="button"
                aria-current={n.id !== 'ask' && active(n.id) ? 'page' : undefined}
                aria-pressed={n.id === 'ask' ? active(n.id) : undefined}
                aria-disabled={disabled(n.id) || undefined}
                aria-label={n.step ? t('chrome.nav.stepLabel', { n: n.step, name: t(`chrome.${n.key}`) }) : t(`chrome.${n.key}`)}
                onClick={() => go(n.id)}
                className={cn('workspace-nav-item relative', disabled(n.id) && 'cursor-not-allowed opacity-35')}
              >
                {n.step && (
                  <span aria-hidden className="workspace-nav-step">
                    {n.step}
                  </span>
                )}
                {n.icon}
                {t(`chrome.${n.key}`)}
              </button>
            </Tooltip>
          </div>
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
    <nav aria-label={t('chrome.nav.label')} className="workspace-tab-bar workspace-theme absolute inset-x-0 bottom-0 z-(--z-chrome) grid h-(--tabbar-h) grid-cols-5 border-t border-line-1 safe-bottom">
      {NAV.map((n) => (
        <button
          key={n.id}
          type="button"
          aria-current={n.id !== 'ask' && active(n.id) ? 'page' : undefined}
          aria-pressed={n.id === 'ask' ? active(n.id) : undefined}
          aria-disabled={disabled(n.id) || undefined}
          onClick={() => go(n.id)}
          className={cn(
            'flex min-w-0 flex-col items-center justify-center gap-0.5 text-xs [&_svg]:size-5 [&_svg]:stroke-[1.5]',
            active(n.id) ? 'font-medium text-signal-strong' : 'text-ink-3',
            disabled(n.id) && 'opacity-40',
          )}
        >
          <span className="relative flex h-6 w-8 items-center justify-center">
            {n.icon}
            {n.step && (
              <span aria-hidden className="workspace-nav-step">
                {n.step}
              </span>
            )}
          </span>
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

function WideField() {
  const t = useT();
  const askOpen = useMission((s) => s.askOpen);
  const listMode = useMissionUi((s) => s.listMode);
  const setListMode = useMissionUi((s) => s.setListMode);
  const parcelId = useMission((s) => s.parcel?.id);
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => setListOpen(false), [parcelId]);
  const closeList = () => {
    setListOpen(false);
    setListMode('list');
  };

  return (
    <>
      <aside aria-label={t('chrome.fieldPanel')} className="workspace-field-panel" data-assistant={askOpen || undefined}>
        <div className="workspace-back">
          <button type="button" onClick={listOpen ? closeList : () => setListOpen(true)} aria-expanded={listOpen}>
            <ArrowLeft size={16} aria-hidden />{t(listOpen ? 'chrome.backToField' : 'chrome.nav.field')}
          </button>
        </div>
        <div hidden={listOpen} className="workspace-field-content">
          <FieldPanel workspace />
        </div>
        {listOpen && (
          <div className="workspace-field-list">
            <PlaceSearch look="map" className="mx-4 mb-4" onOpenField={closeList} />
            {listMode === 'add' ? <FindField /> : <FieldList onOpenField={closeList} />}
          </div>
        )}
      </aside>
      <div className="workspace-map-layer">
        <MapLayerPill workspace />
        <MapNotice />
      </div>
      <MapToolbar workspace className="workspace-map-tools" />
      <MapLegend workspace className="workspace-map-legend" />
      <TimelineScrubber workspace className="workspace-timeline" />
      <MapCredits className="workspace-map-credit" />
    </>
  );
}

/** No field open yet: the map is the screen. Its tools keep the right edge; the finder (mounted by the shell) holds the rest. */
function ExploreMap({ narrow }: { narrow: boolean }) {
  const t = useT();
  const { go } = useNav();
  return (
    <>
      <div className="workspace-theme workspace-explore-nav absolute top-2 left-2 z-(--z-chrome) flex items-center gap-2.5 px-1.5 py-1">
        <Mark />
        <button type="button" className="workspace-nav-item" onClick={() => go('urban')}>
          <Building2 aria-hidden />{t('chrome.nav.urban')}
        </button>
      </div>
      <MapToolbar className={cn('absolute z-(--z-map-ui)', narrow ? 'top-2 right-2' : 'top-1/2 right-[15px] -translate-y-1/2')} />
      {/* The finder owns the bottom edge of a narrow screen, so the credits go to the top there. */}
      <div className={cn('pointer-events-none absolute left-2.5 z-(--z-map-ui) flex', narrow ? 'top-14 right-16' : 'right-[calc(50%+309px)] bottom-1.5')}>
        <MapCredits className="min-w-0" />
      </div>
    </>
  );
}

/** A field is open on a narrow screen. */
function NarrowField() {
  const t = useT();
  const askOpen = useMission((s) => s.askOpen);
  const full = useMissionUi((s) => s.sheetFull);
  const setFull = useMissionUi((s) => s.setSheetFull);
  return (
    <>
      <div className="workspace-theme workspace-field-top absolute top-2 left-2 z-(--z-map-ui) flex h-11 items-center gap-2 rounded-full bg-surface-0 px-1.5 shadow-map">
        <Mark />
        <LangSwitch />
      </div>
      <MapToolbar className="absolute top-2 right-2 z-(--z-map-ui)" />
      <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--map-h)-64px)] z-(--z-map-ui) flex flex-col items-start gap-1.5 px-2">
        <MapNotice className="self-center" />
        <MapCredits className="max-w-full" />
      </div>
      <section
        data-panel-scroll
        hidden={askOpen}
        aria-label={t('chrome.metrics')}
        className={cn(
          'workspace-mobile-field workspace-theme absolute inset-x-0 bottom-[calc(var(--tabbar-h)+var(--strip-h))] z-(--z-panel) flex flex-col overflow-x-hidden overflow-y-auto rounded-t-lg px-4 pt-0 pb-6 shadow-lg transition-[top] duration-(--dur-base)',
          askOpen && 'hidden',
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

/** Reports the screen space the panels cover, so the globe frames the parcel in the free part. */
function useReportInsets(narrow: boolean, phase: Phase, hasParcel: boolean, covered: boolean) {
  const finderH = useMissionUi((s) => s.finderH);
  const addCard = useMissionUi((s) => s.addCard);
  useLayoutEffect(() => {
    // Keep the field framing while a full-page workspace covers the map.
    if (covered || phase === 'advisory' || phase === 'urban') return;
    const report = () => {
      const mission = useMission.getState();
      mission.setInsets(getShellInsets(mission));
    };
    report();
    window.addEventListener('resize', report);
    return () => window.removeEventListener('resize', report);
  }, [narrow, phase, hasParcel, covered, finderH, addCard]);
}

export function Shell() {
  const phase = useMission((s) => s.phase);
  const hasParcel = useMission((s) => !!s.parcel);
  const narrow = useNarrow();
  const locked = phase === 'locked' && hasParcel;
  const hero = phase === 'hero';
  /** No field is open and the visitor is finding one: on the landing, or on the map after it. */
  const finding = hero || ((phase === 'explore' || phase === 'locked') && !locked);
  useReportInsets(narrow, phase, hasParcel, false);
  useStepUrl();
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
  const [visitedUrban, setVisitedUrban] = useState(false);
  const [advisoryParcel, setAdvisoryParcel] = useState<string | undefined>();
  useEffect(() => {
    if (phase === 'urban') setVisitedUrban(true);
    if (phase === 'advisory') setAdvisoryParcel(parcelId);
  }, [phase, parcelId]);
  const advisory = phase === 'advisory';
  const urban = phase === 'urban';
  return (
    <>
      {finding && <Finder />}
      {finding && !hero && <ExploreMap narrow={narrow} />}
      {!finding && (narrow ? <TabBar /> : <Rail />)}
      {locked && (narrow ? <NarrowField /> : <WideField />)}
      {(advisory || urban) && narrow && (
        <div className="workspace-theme workspace-mobile-top absolute inset-x-0 top-0 z-(--z-chrome) flex h-12 items-center justify-between border-b border-line-1 px-3">
          <Mark />
          <LangSwitch />
        </div>
      )}
      {(advisory || (parcelId && parcelId === advisoryParcel)) && (
        <div className="workspace-page-shell" hidden={!advisory}>
          <AdvisoryPanel key={parcelId} />
        </div>
      )}
      {(urban || visitedUrban) && (
        <div className="workspace-page-shell" hidden={!urban}>
          <UrbanCompanion active={urban} />
        </div>
      )}
    </>
  );
}
