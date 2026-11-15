/**
 * Steps (2) and (3) of the path. (2) Rotation has three tabs: the farm stage (the field drawn as a
 * farm, the characters, the strategies played through the year), the comparison (every strategy
 * against the current practice on one page: calendar and trade-offs on the left, why, evidence,
 * benefits, gaps and risks on the right, the priorities at its head) and the plan of the year.
 * (3) Dossier shows how the answer was reached, on one sheet. The tab shown is `advisoryView` in
 * the UI store, so the rail and the address can name it.
 */
import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardList, Compass, Info, MapPinned, MessageCircleQuestion, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { Advisory, AdvisoryReport, FarmerPriority, ModelInput } from '@/contracts';
import { pick } from '@/contracts';
import { type CustomRotationSpec, annualPlan, evaluateCustomRotation, slotCropChoices, swapRotationSeason } from '@/core/advisory';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { toModelInput, useMission } from '@/state/mission';
import { type AdvisoryView, useMissionUi } from '@/ui/chrome/uiState';
import { Dossier } from '@/ui/farm/Dossier';
import { FarmView } from '@/ui/farm/FarmView';
import { Button, EmptyState, Panel, Skeleton, SkeletonText, StatusGlyph, TabPanel, Tabs, cn } from '@/ui/design';
import { AdvisoryBody, CropSuiteView, IrrigationView, PhView, SowingView } from './ActionPlans';
import { AnnualPlanView } from './AnnualPlanView';
import { climateOf } from './climate';
import { useFixture } from './fixture';
import { type CurrencyCode, fmtDate, fmtNum, fmtSigned, money, monthLong } from './format';
import { bestStrategyId, defaultSelection, orderStrategies } from './metrics';
import { SeasonCalendar } from './SeasonCalendar';
import { CurrencySwitch, FixtureTag, Fold, LocalReviewTag, SectionHead, SupportLine } from './shared';
import { StrategyCards } from './StrategyCards';
import { StrategyStory } from './StrategyStory';
import { TradeOffs } from './TradeOffs';
import './strings';

const PRIORITIES: FarmerPriority[] = ['profit', 'yield', 'water', 'soil', 'risk', 'cost'];
/** The tabs of step (2). The dossier is step (3): same page, no tab strip. */
const PAGES: AdvisoryView[] = ['farm', 'compare', 'plan'];

export function AdvisoryPanel() {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const telemetry = useMission((s) => s.telemetry);
  const live = useMission((s) => s.advisory);
  const priorities = useMission((s) => s.priorities);
  const setPriorities = useMission((s) => s.setPriorities);
  const branchStatus = useMission((s) => s.branchStatus);
  const cropId = useMission((s) => s.cropId);
  const groundTruth = useMission((s) => s.groundTruth);
  const countryTable = useMission((s) => s.countryTable);
  const today = useMission((s) => s.telemetry?.window.today ?? s.timeline.end);
  const setPhase = useMission((s) => s.setPhase);
  const setAskOpen = useMission((s) => s.setAskOpen);
  const [currency, setCurrency] = useState<CurrencyCode>(groundTruth.currency ?? (lang === 'vi' ? 'VND' : 'USD'));
  const page = useMissionUi((s) => s.advisoryView);
  const setPage = useMissionUi((s) => s.setAdvisoryView);
  const dossier = page === 'dossier';

  const fixture = useFixture(import.meta.env.DEV ? () => import('./__fixtures__/advisory').then((m) => m.advisoryFixture) : null);
  const report: AdvisoryReport | null = fixture ? fixture(priorities) : live;
  const modelInput = useMemo(
    () => (fixture ? null : toModelInput({ parcel, telemetry, cropId, groundTruth, priorities, countryTable })),
    [fixture, parcel, telemetry, cropId, groundTruth, priorities, countryTable],
  );
  const loading = !report && Object.values(branchStatus).some((s) => s === 'loading');
  const crop = getCrop(report?.cropId ?? cropId);

  const togglePriority = (p: FarmerPriority) => {
    if (priorities.includes(p)) setPriorities(priorities.filter((x) => x !== p));
    else if (priorities.length < 3) setPriorities([...priorities, p]);
  };

  return (
    <main aria-labelledby="adv-title" className="rotation-workspace" data-rotation-page={parcel && !loading ? page : undefined}>
        {/* Compare and Plan sit under the rotation tabs, which already say where the grower is: no title block there. */}
        <header className={cn('rotation-inner rotation-header', !dossier && parcel && 'rotation-header-compact')}>
          {parcel && dossier && (
            <button type="button" className="rotation-back" onClick={() => setPage('compare')}>
              <ArrowLeft size={16} aria-hidden />{t('advisory.workspace.backRotation')}
            </button>
          )}
          <div className="rotation-header-row">
            <div className={cn(!dossier && parcel && 'sr-only')}>
              <h1 id="adv-title">
                <span className="rotation-step-num" aria-hidden>{dossier ? 3 : 2}</span>
                {t(dossier ? 'advisory.workspace.dossierTitle' : 'advisory.title')}
              </h1>
              <p>{[parcel?.name, crop && (lang === 'vi' && crop.names.vi ? crop.names.vi : crop.names.en), report && t('advisory.generated', { date: fmtDate(report.generatedAt, lang) })].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
            <CurrencySwitch value={currency} onChange={setCurrency} />
              <button className="rotation-action" type="button" onClick={() => setAskOpen(true)}>
                <MessageCircleQuestion size={17} aria-hidden />{t('advisory.workspace.ask')}
              </button>
              {fixture && <FixtureTag />}
            </div>
          </div>
        </header>

        {!parcel ? (
          <EmptyState
            icon={<MapPinned />}
            title={t('advisory.empty.noField')}
            body={t('advisory.empty.noFieldBody')}
            action={
              <Button variant="primary" onClick={() => setPhase('explore')}>
                {t('advisory.empty.pickField')}
              </Button>
            }
          />
        ) : loading ? (
          <LoadingLayout />
        ) : (
          <Tabs<AdvisoryView> className="workspace-tabs rotation-tabs" value={page} onValueChange={setPage} ariaLabel={t('advisory.title')} tabs={PAGES.map((value) => ({ value, label: t(`advisory.workspace.${value}`) }))}>
            <Body
              key={parcel.id}
              report={report}
              modelInput={modelInput}
              currency={currency}
              priorities={priorities}
              onTogglePriority={togglePriority}
              page={page}
              onPage={setPage}
              today={today}
              sowingMonth={groundTruth.sowingDate ? Number(groundTruth.sowingDate.slice(5, 7)) : null}
            />
          </Tabs>
        )}

        <footer className="rotation-inner rotation-footer">
          <SupportLine />
        </footer>
    </main>
  );
}

function PriorityPicker({ value, onToggle }: { value: FarmerPriority[]; onToggle: (p: FarmerPriority) => void }) {
  const t = useT();
  const full = value.length >= 3;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-labelledby="adv-prio">
      <span id="adv-prio" className="t-label">
        {t('advisory.priorities')}
      </span>
      <div className="flex flex-wrap gap-1">
        {PRIORITIES.map((p) => {
          const rank = value.indexOf(p);
          const on = rank >= 0;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => onToggle(p)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-sm font-medium transition-colors duration-(--dur-instant) stacked:h-11',
                on ? 'border-signal bg-signal/12 text-signal-strong' : 'border-line-2 bg-surface-0 text-ink-2 hover:bg-surface-2 hover:text-ink-1',
                'disabled:cursor-not-allowed disabled:opacity-45',
              )}
            >
              {on && <span className="t-value inline-flex size-4 items-center justify-center rounded-xs bg-signal text-2xs font-bold text-on-signal">{rank + 1}</span>}
              {t(`advisory.prio.${p}`)}
            </button>
          );
        })}
      </div>
      <span className="t-caption">{full ? t('advisory.prioFull') : t('advisory.prioHint')}</span>
    </div>
  );
}

function LoadingLayout() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex w-60 shrink-0 flex-col gap-3 rounded-sm border border-line-1 p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-8 w-16" />
            <SkeletonText lines={3} />
          </div>
        ))}
      </div>
      <Skeleton className="h-56" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

interface BodyProps {
  report: AdvisoryReport | null;
  modelInput: ModelInput | null;
  currency: CurrencyCode;
  priorities: FarmerPriority[];
  onTogglePriority: (p: FarmerPriority) => void;
  page: AdvisoryView;
  onPage: (page: AdvisoryView) => void;
  today: string;
  sowingMonth: number | null;
}

function Body({ report, modelInput, currency, priorities, onTogglePriority, page, onPage, today, sowingMonth }: BodyProps) {
  const t = useT();
  const lang = useLang();
  const setPhase = useMission((s) => s.setPhase);
  const telemetry = useMission((s) => s.telemetry);
  const climate = useMemo(() => climateOf(telemetry), [telemetry]);
  // Only what the farmer picked is remembered; until then the page follows the ranking.
  const [picked, setPicked] = useState<string | null>(null);
  const [customSpec, setCustomSpec] = useState<CustomRotationSpec | null>(null);
  const [editingPriorities, setEditingPriorities] = useState(false);
  const rotations = useMemo(() => {
    const base = report?.rotations ?? [];
    if (!customSpec || !modelInput || !base.length) return orderStrategies(base);
    return orderStrategies(evaluateCustomRotation(modelInput, base, customSpec));
  }, [report, customSpec, modelInput]);
  const advisories = report?.advisories ?? [];
  const nothing = !report || (!rotations.length && !advisories.length && !report.irrigation && !report?.ph && !report?.sowing?.length && !report.annualPlan);

  const selected = rotations.find((r) => r.id === picked) ?? rotations.find((r) => r.id === defaultSelection(rotations)) ?? null;
  const getChoices = useCallback(
    (seasonIndex: number) => (modelInput && selected ? slotCropChoices(modelInput, selected, seasonIndex) : []),
    [modelInput, selected],
  );
  const handleSwap = useCallback(
    (seasonIndex: number, newCropId: string) => {
      if (!modelInput || !report || !selected) return;
      const next = swapRotationSeason(modelInput, report.rotations, selected, seasonIndex, newCropId, customSpec);
      if (!next) return;
      setCustomSpec(next.spec);
      setPicked('custom');
    },
    [modelInput, report, selected, customSpec],
  );
  const activePlan = useMemo(
    () => (selected?.kind === 'custom' && modelInput ? annualPlan(modelInput, selected) : (report?.annualPlan ?? null)),
    [selected, modelInput, report],
  );

  if (nothing && page !== 'farm') {
    return (
      <EmptyState
        icon={<Compass />}
        title={t('advisory.empty.noReport')}
        body={t('advisory.empty.noReportBody')}
        action={<Button onClick={() => setPhase('locked')}>{t('advisory.empty.backToField')}</Button>}
      />
    );
  }

  const current = rotations.find((r) => r.kind === 'current') ?? null;
  const scoreGap = current && selected && selected.id !== current.id ? Math.round(selected.score) - Math.round(current.score) : null;
  let glance = t(current ? 'advisory.workspace.baselineSummary' : 'advisory.noCurrent');
  if (selected && current && selected.id !== current.id) {
    const water = selected.metrics.waterUseMm - current.metrics.waterUseMm;
    const margin = selected.metrics.marginUsdPerHaYr - current.metrics.marginUsdPerHaYr;
    const cover = selected.metrics.groundCoverPct - current.metrics.groundCoverPct;
    const amount = money(Math.abs(margin), currency, lang, { compact: true });
    glance = [
      t(water < 0 ? 'advisory.workspace.waterLess' : water > 0 ? 'advisory.workspace.waterMore' : 'advisory.workspace.waterSame', { n: fmtNum(Math.abs(water), lang) }),
      t(margin < 0 ? 'advisory.workspace.marginLess' : margin > 0 ? 'advisory.workspace.marginMore' : 'advisory.workspace.marginSame', { amount: `${amount.value} ${amount.unit}/ha` }),
      t(cover < 0 ? 'advisory.workspace.coverLess' : cover > 0 ? 'advisory.workspace.coverMore' : 'advisory.workspace.coverSame', { n: fmtNum(Math.abs(cover), lang) }),
    ].join(' ');
  }
  const planStrategy = activePlan ? rotations.find((r) => r.id === activePlan.strategyId) : undefined;
  const usesReference = rotations.some((r) => r.economics?.seasons?.some((s) => s.usesReferenceValues));
  const byKind = (k: string) => [...advisories].filter((a) => a.kind === k).sort((a, b) => a.priority - b.priority)[0];
  const irrAdv = byKind('irrigation');
  const phAdv = byKind('ph');
  const sowAdv = byKind('sowing');
  const shown = new Set([irrAdv?.id, phAdv?.id, sowAdv?.id]);
  const others = advisories.filter((a) => !shown.has(a.id)).sort((a, b) => a.priority - b.priority);
  const reviewCount = selected ? selected.gaps.length + selected.risks.length : 0;
  const selectedName = selected ? pick(selected.name, lang) : '';
  const resetCustom = () => {
    setCustomSpec(null);
    if (picked === 'custom') setPicked(null);
  };

  const bestId = bestStrategyId(rotations);
  const irrigation = report?.irrigation;
  const bestSowing = report?.sowing?.length ? report?.sowing.reduce((x, w) => (w.score > x.score ? w : x)) : null;
  // The engine writes scores and reliabilities as 0..1 or 0..100; the sowing view reads both, and so does this line.
  const pct = (v: number) => (v <= 1 ? v * 100 : v);
  // What a closed advisory says of itself: the engine's own sentence when there is one, else the plan in a line.
  const said = (adv: Advisory | undefined, fallback: string) => (adv ? pick(adv.summary, lang) : fallback);
  const marks = (adv: Advisory | undefined) =>
    adv && (
      <>
        {adv.needsLocalReview && <LocalReviewTag />}
        <span className="t-meta" title={t('advisory.priorityHint')}>
          P{adv.priority}
        </span>
      </>
    );
  const tone = (adv: Advisory | undefined) => (adv?.needsLocalReview ? ('watch' as const) : undefined);

  return (
    <>
      {/* The plan is for the strategy chosen in the comparison: the row says which, and the priorities behind it. */}
      <div className="rotation-context" hidden={page !== 'plan'}>
        <div className="rotation-inner rotation-context-row">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('advisory.workspace.selected')}</span>
            <strong>{selectedName || '—'}</strong>
            {scoreGap != null && <span className="rotation-badge">{fmtSigned(scoreGap, lang)} {t('advisory.card.vsCurrent')}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('advisory.workspace.priorities')}</span>
            {priorities.map((p, i) => <strong key={p}>{i + 1}. {t(`advisory.prio.${p}`)}</strong>)}
            <button type="button" className="rotation-action" aria-expanded={editingPriorities} onClick={() => setEditingPriorities(!editingPriorities)}>
              <SlidersHorizontal size={16} aria-hidden />{t('advisory.workspace.edit')}
            </button>
          </div>
        </div>
        {editingPriorities && <div className="workspace-reveal rotation-inner pb-3"><PriorityPicker value={priorities} onToggle={onTogglePriority} /></div>}
      </div>

      {/* Until the grower picks a rotation the stage shows the field as it is: the current practice, not a simulation. */}
      <TabPanel value="farm" className="rotation-farm">
        <FarmView rotations={rotations} current={current} bestId={bestId} selected={picked ? selected : (current ?? selected)} onSelect={setPicked} report={report} onAnalysis={() => onPage('compare')} onDossier={() => onPage('dossier')} />
      </TabPanel>

      <TabPanel value="compare" className="rotation-inner rotation-page">
        {selected ? (
          <div className="flex flex-col gap-6 compact:gap-4">
            <section aria-labelledby="adv-rot" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <h2 id="adv-rot" className="workspace-section-title">{t('advisory.compareTitle')}</h2>
                  <p className="t-caption">{t('advisory.workspace.choose')}</p>
                </div>
                <PriorityPicker value={priorities} onToggle={onTogglePriority} />
              </div>
              <div>
                <StrategyCards rotations={rotations} current={current} bestId={bestId} selectedId={selected.id} onSelect={setPicked} />
              </div>
              <p className="rotation-glance-line">
                <strong>{selectedName}</strong>
                {scoreGap != null && <span className="rotation-badge">{fmtSigned(scoreGap, lang)} {t('advisory.card.vsCurrent')}</span>}
                <span>{glance}</span>
              </p>
            </section>
            {/* Left: when it grows and what it trades. Right: why, on what evidence, and what is still unknown. */}
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 compact:gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-6 compact:gap-4">
                {!current && <p className="text-sm text-watch">{t('advisory.noCurrent')}</p>}
                <section aria-labelledby="adv-cal">
                  <SectionHead
                    id="adv-cal"
                    title={t('advisory.cal.title')}
                    sub={selected.id === current?.id || !current ? t('advisory.cal.subAlone', { name: selectedName }) : t('advisory.cal.sub', { name: selectedName })}
                    actions={
                      customSpec && (
                        <Button variant="secondary" size="sm" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />} onClick={resetCustom}>
                          {t('advisory.custom.reset')}
                        </Button>
                      )
                    }
                  />
                  <Panel pad="none">
                    <div className="p-4 narrow:p-2.5">
                      <SeasonCalendar
                        current={current}
                        selected={selected}
                        climate={climate}
                        currency={currency}
                        getChoices={modelInput ? getChoices : undefined}
                        onSwap={modelInput ? handleSwap : undefined}
                      />
                    </div>
                  </Panel>
                </section>
                <section aria-labelledby="adv-trade">
                  <SectionHead id="adv-trade" title={t('advisory.trade.title')} sub={t('advisory.trade.sub')} />
                  <Panel>
                    <TradeOffs rotations={rotations} current={current} selected={selected} priorities={priorities} currency={currency} usesReference={usesReference} />
                  </Panel>
                  {usesReference && (
                    <p className="t-caption mt-2 flex items-start gap-1.5">
                      <Info size={14} strokeWidth={1.5} aria-hidden className="mt-px shrink-0" />
                      {t('advisory.refNote')}
                    </p>
                  )}
                </section>
              </div>
              <section aria-labelledby="adv-story">
                <SectionHead
                  id="adv-story"
                  title={t('advisory.story.title', { name: selectedName })}
                  sub={t('advisory.story.sub')}
                  actions={
                    reviewCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-watch">
                        <StatusGlyph status="watch" />
                        {t('advisory.reviewCount', { n: reviewCount })}
                      </span>
                    )
                  }
                />
                <Panel>
                  <StrategyStory strategy={selected} />
                </Panel>
              </section>
            </div>
            <NextLinks onPlan={() => onPage('plan')} onDossier={() => onPage('dossier')} />
          </div>
        ) : (
          <EmptyState layout="block" icon={<Compass />} title={t('advisory.empty.noRotations')} body={t('advisory.empty.noRotationsBody')} />
        )}
      </TabPanel>

      <TabPanel value="plan" className="rotation-inner rotation-page">
        <section aria-labelledby="adv-more" className="flex flex-col gap-2">
        <SectionHead id="adv-more" title={t('advisory.moreTitle')} sub={t('advisory.moreSub')} />
        <Fold
          title={planStrategy ? t('advisory.plan.titleFor', { name: pick(planStrategy.name, lang) }) : t('advisory.plan.title')}
          sub={planStrategy && selected && planStrategy.id !== selected.id ? t('advisory.plan.otherStrategy', { plan: pick(planStrategy.name, lang), selected: selectedName }) : t('advisory.plan.sub')}
        >
          {activePlan ? (
            <AnnualPlanView plan={activePlan} currency={currency} usesReference={usesReference} />
          ) : (
            <EmptyState layout="inline" icon={<ClipboardList />} title={t('advisory.empty.noPlan')} body={t('advisory.empty.noPlanBody')} />
          )}
        </Fold>

        <Fold
          title={t('advisory.irr.title')}
          sub={said(irrAdv, irrigation ? `${t('advisory.irr.total')}: ${fmtNum(irrigation.totalMm, lang)} mm · ${t('advisory.irr.events', { n: irrigation.events.length })}` : t('advisory.empty.noIrrigation'))}
          marks={marks(irrAdv)}
          tone={tone(irrAdv)}
        >
          {irrigation ? <IrrigationView plan={irrigation} today={today} /> : <EmptyState layout="inline" title={t('advisory.empty.noIrrigation')} body={t('advisory.empty.noIrrigationBody')} />}
          {irrAdv && <Divider />}
          {irrAdv && <AdvisoryBody adv={irrAdv} currency={currency} showTitle />}
        </Fold>

        <Fold
          title={t('advisory.sow.title')}
          sub={said(
            sowAdv,
            bestSowing
              ? t('advisory.sow.best', { month: monthLong(bestSowing.month, lang), score: fmtNum(report?.sowing!.every((w) => w.score <= 1) ? bestSowing.score * 100 : bestSowing.score, lang), rel: bestSowing.reliability == null ? '--' : fmtNum(pct(bestSowing.reliability), lang) })
              : t('advisory.empty.noSowing'),
          )}
          marks={marks(sowAdv)}
          tone={tone(sowAdv)}
        >
          {report?.sowing?.length ? <SowingView windows={report?.sowing} chosenMonth={sowingMonth} /> : <EmptyState layout="inline" title={t('advisory.empty.noSowing')} body={t('advisory.empty.noSowingBody')} />}
          {report?.cropSuite && <Divider />}
          {report?.cropSuite && <CropSuiteView summary={report?.cropSuite} />}
          {sowAdv && <Divider />}
          {sowAdv && <AdvisoryBody adv={sowAdv} currency={currency} showTitle />}
        </Fold>

        <Fold
          title={t('advisory.ph.title')}
          sub={said(phAdv, report?.ph ? `${t('advisory.ph.scaleSummary', { from: fmtNum(report?.ph.current, lang, 1), to: fmtNum(report?.ph.target, lang, 1) })} · ${t(`advisory.ph.${report?.ph.amendment}`)}` : t('advisory.empty.noPh'))}
          marks={marks(phAdv)}
          tone={tone(phAdv)}
        >
          {report?.ph ? <PhView plan={report?.ph} /> : <EmptyState layout="inline" title={t('advisory.empty.noPh')} body={t('advisory.empty.noPhBody')} />}
          {phAdv && <Divider />}
          {phAdv && <AdvisoryBody adv={phAdv} currency={currency} showTitle />}
        </Fold>

        {others.map((adv) => (
          <Fold key={adv.id} title={pick(adv.title, lang)} sub={pick(adv.summary, lang)} marks={marks(adv)} tone={tone(adv)}>
            <AdvisoryBody adv={adv} currency={currency} hideSummary />
          </Fold>
        ))}
        </section>
        <NextLinks onDossier={() => onPage('dossier')} />
      </TabPanel>

      <TabPanel value="dossier" className="rotation-inner rotation-page">
        <Dossier report={report} rotations={rotations} current={current} selected={selected} bestId={bestId} currency={currency} />
      </TabPanel>
    </>
  );
}

/** The way on at the foot of a tab: the plan of the year, then step (3). */
function NextLinks({ onPlan, onDossier }: { onPlan?: () => void; onDossier: () => void }) {
  const t = useT();
  return (
    <nav aria-label={t('advisory.workspace.next')} className="rotation-next">
      {onPlan && (
        <Button variant="secondary" size="lg" iconRight={<ArrowRight />} onClick={onPlan}>
          {t('advisory.workspace.toPlan')}
        </Button>
      )}
      <button type="button" className="workspace-next-button" onClick={onDossier}>
        <span aria-hidden className="workspace-next-num">
          3
        </span>
        {t('advisory.workspace.toDossier')}
        <ArrowRight size={17} aria-hidden />
      </button>
    </nav>
  );
}

function Divider() {
  return <div aria-hidden className="my-4 h-px bg-line-1" />;
}
