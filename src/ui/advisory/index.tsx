/**
 * The crop-rotation screen. A strip of the strategies (the current practice first) stays at the top
 * while the page scrolls. Under it, two columns on a wide screen: on the left the season calendar of
 * the chosen strategy over the field's own climate and its trade-offs against the current practice;
 * on the right the five lists that explain it (why, evidence, benefits, gaps, risks). The year plan
 * and the action advisories follow, each one line until opened.
 * Everything is read from the mission store; the engine lives in src/core/advisory.
 */
import { useCallback, useMemo, useState } from 'react';
import { ClipboardList, Compass, Info, MapPinned, RotateCcw } from 'lucide-react';
import type { Advisory, AdvisoryReport, FarmerPriority, ModelInput } from '@/contracts';
import { pick } from '@/contracts';
import { type CustomRotationSpec, annualPlan, evaluateCustomRotation, slotCropChoices, swapRotationSeason } from '@/core/advisory';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { toModelInput, useMission } from '@/state/mission';
import { Button, EmptyState, Panel, Skeleton, SkeletonText, StatusGlyph, cn } from '@/ui/design';
import { AdvisoryBody, CropSuiteView, IrrigationView, PhView, SowingView } from './ActionPlans';
import { AnnualPlanView } from './AnnualPlanView';
import { climateOf } from './climate';
import { useFixture } from './fixture';
import { type CurrencyCode, fmtDate, fmtNum, monthLong } from './format';
import { bestStrategyId, defaultSelection, orderStrategies } from './metrics';
import { SeasonCalendar } from './SeasonCalendar';
import { CurrencySwitch, FixtureTag, Fold, LocalReviewTag, SectionHead, SupportLine } from './shared';
import { StrategyCards } from './StrategyCards';
import { StrategyStory } from './StrategyStory';
import { TradeOffs } from './TradeOffs';
import './strings';

const PRIORITIES: FarmerPriority[] = ['profit', 'yield', 'water', 'soil', 'risk', 'cost'];

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
  const today = useMission((s) => s.telemetry?.window.today ?? s.timeline.end);
  const setPhase = useMission((s) => s.setPhase);
  const [currency, setCurrency] = useState<CurrencyCode>(groundTruth.currency ?? (lang === 'vi' ? 'VND' : 'USD'));

  const fixture = useFixture(import.meta.env.DEV ? () => import('./__fixtures__/advisory').then((m) => m.advisoryFixture) : null);
  const report: AdvisoryReport | null = fixture ? fixture(priorities) : live;
  const modelInput = useMemo(
    () => (fixture ? null : toModelInput({ parcel, telemetry, cropId, groundTruth, priorities })),
    [fixture, parcel, telemetry, cropId, groundTruth, priorities],
  );
  const loading = !report && Object.values(branchStatus).some((s) => s === 'loading');
  const crop = getCrop(report?.cropId ?? cropId);

  const togglePriority = (p: FarmerPriority) => {
    if (priorities.includes(p)) setPriorities(priorities.filter((x) => x !== p));
    else if (priorities.length < 3) setPriorities([...priorities, p]);
  };

  return (
    <main aria-labelledby="adv-title" className="absolute inset-0 overflow-x-hidden overflow-y-auto bg-surface-0">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-6 pt-5 pb-20 compact:gap-4 compact:px-4 compact:pt-4 narrow:px-3">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 id="adv-title" className="text-xl leading-7 font-semibold text-ink-1">
                {t('advisory.title')}
              </h1>
              {parcel && <span className="text-base text-ink-2">{parcel.name}</span>}
              {crop && <span className="text-base text-ink-3">· {lang === 'vi' && crop.names.vi ? crop.names.vi : crop.names.en}</span>}
              {report && <span className="t-meta">{t('advisory.generated', { date: fmtDate(report.generatedAt, lang) })}</span>}
              {fixture && <FixtureTag />}
            </div>
            <CurrencySwitch value={currency} onChange={setCurrency} />
          </div>
          <PriorityPicker value={priorities} onToggle={togglePriority} />
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
          <Body
            key={parcel.id}
            report={report}
            modelInput={modelInput}
            currency={currency}
            priorities={priorities}
            today={today}
            sowingMonth={groundTruth.sowingDate ? Number(groundTruth.sowingDate.slice(5, 7)) : null}
          />
        )}

        <footer className="border-t border-line-1 pt-4">
          <SupportLine />
        </footer>
      </div>
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
  today: string;
  sowingMonth: number | null;
}

function Body({ report, modelInput, currency, priorities, today, sowingMonth }: BodyProps) {
  const t = useT();
  const lang = useLang();
  const setPhase = useMission((s) => s.setPhase);
  const telemetry = useMission((s) => s.telemetry);
  const climate = useMemo(() => climateOf(telemetry), [telemetry]);
  // Only what the farmer picked is remembered; until then the page follows the ranking.
  const [picked, setPicked] = useState<string | null>(null);
  const [customSpec, setCustomSpec] = useState<CustomRotationSpec | null>(null);
  const rotations = useMemo(() => {
    const base = report?.rotations ?? [];
    if (!customSpec || !modelInput || !base.length) return orderStrategies(base);
    return orderStrategies(evaluateCustomRotation(modelInput, base, customSpec));
  }, [report, customSpec, modelInput]);
  const advisories = report?.advisories ?? [];
  const nothing = !report || (!rotations.length && !advisories.length && !report.irrigation && !report.ph && !report.sowing?.length && !report.annualPlan);

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

  if (nothing) {
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

  const irrigation = report.irrigation;
  const bestSowing = report.sowing?.length ? report.sowing.reduce((x, w) => (w.score > x.score ? w : x)) : null;
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
      {selected ? (
        // Stays under the page's top edge while the rest scrolls: another strategy is one press away from anywhere.
        <section aria-labelledby="adv-rot" className="sticky top-0 z-10 -mx-6 -mt-3 flex flex-col gap-1 border-b border-line-1 bg-surface-0 px-6 pt-2 pb-2 compact:-mx-4 compact:px-4 narrow:-mx-3 narrow:px-3">
          {/* A phone gives the strip a fifth of its height at most: the heading is kept for screen readers only there. */}
          <div className="flex flex-wrap items-baseline gap-x-3 narrow:sr-only">
            <h2 id="adv-rot" className="t-heading">
              {t('advisory.compareTitle')}
            </h2>
            <p className="t-caption min-w-0 truncate">{t('advisory.compareSub', { n: rotations.length })}</p>
          </div>
          <StrategyCards rotations={rotations} current={current} bestId={bestStrategyId(rotations)} selectedId={selected.id} onSelect={setPicked} />
        </section>
      ) : (
        <EmptyState layout="block" icon={<Compass />} title={t('advisory.empty.noRotations')} body={t('advisory.empty.noRotationsBody')} />
      )}

      {selected && (
        // Left: when it grows and what it trades. Right: why, on what evidence, and what is still unknown.
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
      )}

      {/* The year plan and the action advisories are closed until asked for: the comparison above is the page's subject. */}
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
              ? t('advisory.sow.best', { month: monthLong(bestSowing.month, lang), score: fmtNum(report.sowing!.every((w) => w.score <= 1) ? bestSowing.score * 100 : bestSowing.score, lang), rel: bestSowing.reliability == null ? '--' : fmtNum(pct(bestSowing.reliability), lang) })
              : t('advisory.empty.noSowing'),
          )}
          marks={marks(sowAdv)}
          tone={tone(sowAdv)}
        >
          {report.sowing?.length ? <SowingView windows={report.sowing} chosenMonth={sowingMonth} /> : <EmptyState layout="inline" title={t('advisory.empty.noSowing')} body={t('advisory.empty.noSowingBody')} />}
          {report.cropSuite && <Divider />}
          {report.cropSuite && <CropSuiteView summary={report.cropSuite} />}
          {sowAdv && <Divider />}
          {sowAdv && <AdvisoryBody adv={sowAdv} currency={currency} showTitle />}
        </Fold>

        <Fold
          title={t('advisory.ph.title')}
          sub={said(phAdv, report.ph ? `${t('advisory.ph.scaleSummary', { from: fmtNum(report.ph.current, lang, 1), to: fmtNum(report.ph.target, lang, 1) })} · ${t(`advisory.ph.${report.ph.amendment}`)}` : t('advisory.empty.noPh'))}
          marks={marks(phAdv)}
          tone={tone(phAdv)}
        >
          {report.ph ? <PhView plan={report.ph} /> : <EmptyState layout="inline" title={t('advisory.empty.noPh')} body={t('advisory.empty.noPhBody')} />}
          {phAdv && <Divider />}
          {phAdv && <AdvisoryBody adv={phAdv} currency={currency} showTitle />}
        </Fold>

        {others.map((adv) => (
          <Fold key={adv.id} title={pick(adv.title, lang)} sub={pick(adv.summary, lang)} marks={marks(adv)} tone={tone(adv)}>
            <AdvisoryBody adv={adv} currency={currency} hideSummary />
          </Fold>
        ))}
      </section>
    </>
  );
}

function Divider() {
  return <div aria-hidden className="my-4 h-px bg-line-1" />;
}
