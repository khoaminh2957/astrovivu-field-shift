/**
 * The crop-rotation screen. Top to bottom: the strategies as cards (the current practice first),
 * the season calendar of the chosen one over the field's own climate, its trade-offs against the
 * current practice, the five lists that explain it, then the year plan and the action advisories.
 * Everything is read from the mission store; the engine lives in src/core/advisory.
 */
import { useMemo, useState } from 'react';
import { ClipboardList, Compass, Info, MapPinned } from 'lucide-react';
import type { AdvisoryReport, FarmerPriority } from '@/contracts';
import { pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, EmptyState, Panel, Skeleton, SkeletonText, StatusGlyph, cn } from '@/ui/design';
import { AdvisoryCard, AdvisoryBody, AdvisoryPlate, IrrigationView, PhView, SowingView } from './ActionPlans';
import { AnnualPlanView } from './AnnualPlanView';
import { climateOf } from './climate';
import { useFixture } from './fixture';
import { type CurrencyCode, fmtDate } from './format';
import { bestStrategyId, defaultSelection, orderStrategies } from './metrics';
import { SeasonCalendar } from './SeasonCalendar';
import { CurrencySwitch, FixtureTag, SectionHead, SupportLine } from './shared';
import { StrategyCards } from './StrategyCards';
import { StrategyStory } from './StrategyStory';
import { TradeOffs } from './TradeOffs';
import './strings';

const PRIORITIES: FarmerPriority[] = ['profit', 'yield', 'water', 'soil', 'risk', 'cost'];

export function AdvisoryPanel() {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
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
  const loading = !report && Object.values(branchStatus).some((s) => s === 'loading');
  const crop = getCrop(report?.cropId ?? cropId);

  const togglePriority = (p: FarmerPriority) => {
    if (priorities.includes(p)) setPriorities(priorities.filter((x) => x !== p));
    else if (priorities.length < 3) setPriorities([...priorities, p]);
  };

  return (
    <main aria-labelledby="adv-title" className="absolute inset-0 overflow-x-hidden overflow-y-auto bg-surface-0">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-6 pt-5 pb-28 compact:gap-6 compact:px-4 compact:pt-4 narrow:px-3">
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
          <SupportLine />
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
          <Body key={parcel.id} report={report} currency={currency} priorities={priorities} today={today} sowingMonth={groundTruth.sowingDate ? Number(groundTruth.sowingDate.slice(5, 7)) : null} />
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
  currency: CurrencyCode;
  priorities: FarmerPriority[];
  today: string;
  sowingMonth: number | null;
}

function Body({ report, currency, priorities, today, sowingMonth }: BodyProps) {
  const t = useT();
  const lang = useLang();
  const setPhase = useMission((s) => s.setPhase);
  const telemetry = useMission((s) => s.telemetry);
  const climate = useMemo(() => climateOf(telemetry), [telemetry]);
  // Only what the farmer picked is remembered; until then the page follows the ranking.
  const [picked, setPicked] = useState<string | null>(null);
  const rotations = useMemo(() => orderStrategies(report?.rotations ?? []), [report]);
  const advisories = report?.advisories ?? [];
  const nothing = !report || (!rotations.length && !advisories.length && !report.irrigation && !report.ph && !report.sowing?.length && !report.annualPlan);

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
  const selected = rotations.find((r) => r.id === picked) ?? rotations.find((r) => r.id === defaultSelection(rotations)) ?? null;
  const planStrategy = report.annualPlan ? rotations.find((r) => r.id === report.annualPlan!.strategyId) : undefined;
  const usesReference = rotations.some((r) => r.economics?.seasons?.some((s) => s.usesReferenceValues));
  const byKind = (k: string) => [...advisories].filter((a) => a.kind === k).sort((a, b) => a.priority - b.priority)[0];
  const irrAdv = byKind('irrigation');
  const phAdv = byKind('ph');
  const sowAdv = byKind('sowing');
  const shown = new Set([irrAdv?.id, phAdv?.id, sowAdv?.id]);
  const others = advisories.filter((a) => !shown.has(a.id)).sort((a, b) => a.priority - b.priority);
  const reviewCount = selected ? selected.gaps.length + selected.risks.length : 0;
  const selectedName = selected ? pick(selected.name, lang) : '';

  return (
    <>
      <section aria-labelledby="adv-rot">
        <SectionHead id="adv-rot" title={t('advisory.compareTitle')} sub={t('advisory.compareSub', { n: rotations.length })} />
        {selected ? (
          <div className="flex flex-col gap-2">
            {!current && <p className="text-sm text-watch">{t('advisory.noCurrent')}</p>}
            <StrategyCards
              rotations={rotations}
              current={current}
              bestId={bestStrategyId(rotations)}
              selectedId={selected.id}
              onSelect={setPicked}
              priorities={priorities}
              currency={currency}
              planStrategyId={report.annualPlan?.strategyId}
            />
            {usesReference && (
              <p className="t-caption flex max-w-[96ch] items-start gap-1.5">
                <Info size={14} strokeWidth={1.5} aria-hidden className="mt-px shrink-0" />
                {t('advisory.refNote')}
              </p>
            )}
          </div>
        ) : (
          <EmptyState layout="block" icon={<Compass />} title={t('advisory.empty.noRotations')} body={t('advisory.empty.noRotationsBody')} />
        )}
      </section>

      {selected && (
        <>
          <section aria-labelledby="adv-cal">
            <SectionHead id="adv-cal" title={t('advisory.cal.title')} sub={selected.id === current?.id || !current ? t('advisory.cal.subAlone', { name: selectedName }) : t('advisory.cal.sub', { name: selectedName })} />
            <Panel pad="none">
              <div className="p-4 narrow:p-2.5">
                <SeasonCalendar current={current} selected={selected} climate={climate} currency={currency} />
              </div>
            </Panel>
          </section>

          {/* An explicit shrinkable column: the comparison table scrolls inside its panel, never the page. */}
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 compact:gap-4 xl:grid-cols-2">
            <section aria-labelledby="adv-trade">
              <SectionHead id="adv-trade" title={t('advisory.trade.title')} sub={t('advisory.trade.sub')} />
              <Panel>
                <TradeOffs rotations={rotations} current={current} selected={selected} priorities={priorities} currency={currency} usesReference={usesReference} />
              </Panel>
            </section>

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
        </>
      )}

      <section aria-labelledby="adv-plan">
        <SectionHead
          id="adv-plan"
          title={planStrategy ? t('advisory.plan.titleFor', { name: pick(planStrategy.name, lang) }) : t('advisory.plan.title')}
          sub={planStrategy && selected && planStrategy.id !== selected.id ? t('advisory.plan.otherStrategy', { plan: pick(planStrategy.name, lang), selected: selectedName }) : t('advisory.plan.sub')}
        />
        <Panel pad="none">
          <div className="p-4 narrow:p-2.5">
            {report.annualPlan ? (
              <AnnualPlanView plan={report.annualPlan} currency={currency} usesReference={usesReference} />
            ) : (
              <EmptyState layout="inline" icon={<ClipboardList />} title={t('advisory.empty.noPlan')} body={t('advisory.empty.noPlanBody')} />
            )}
          </div>
        </Panel>
      </section>

      <section aria-labelledby="adv-actions">
        <SectionHead id="adv-actions" title={t('advisory.actionsTitle')} sub={t('advisory.actionsSub')} />
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
          <AdvisoryPlate adv={irrAdv} title={t('advisory.irr.title')}>
            {report.irrigation ? <IrrigationView plan={report.irrigation} today={today} /> : <EmptyState layout="inline" title={t('advisory.empty.noIrrigation')} body={t('advisory.empty.noIrrigationBody')} />}
            {irrAdv && <Divider />}
            {irrAdv && <AdvisoryBody adv={irrAdv} currency={currency} showTitle />}
          </AdvisoryPlate>
          <AdvisoryPlate adv={sowAdv} title={t('advisory.sow.title')}>
            {report.sowing?.length ? <SowingView windows={report.sowing} chosenMonth={sowingMonth} /> : <EmptyState layout="inline" title={t('advisory.empty.noSowing')} body={t('advisory.empty.noSowingBody')} />}
            {sowAdv && <Divider />}
            {sowAdv && <AdvisoryBody adv={sowAdv} currency={currency} showTitle />}
          </AdvisoryPlate>
          <AdvisoryPlate adv={phAdv} title={t('advisory.ph.title')}>
            {report.ph ? <PhView plan={report.ph} /> : <EmptyState layout="inline" title={t('advisory.empty.noPh')} body={t('advisory.empty.noPhBody')} />}
            {phAdv && <Divider />}
            {phAdv && <AdvisoryBody adv={phAdv} currency={currency} showTitle />}
          </AdvisoryPlate>
          {others.map((a) => (
            <AdvisoryCard key={a.id} adv={a} currency={currency} />
          ))}
        </div>
      </section>
    </>
  );
}

function Divider() {
  return <div aria-hidden className="my-4 h-px bg-line-1" />;
}
