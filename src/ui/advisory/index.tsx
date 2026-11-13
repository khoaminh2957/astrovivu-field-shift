/**
 * State 5: the advisory view. Rotation strategies compared side by side (the current one always
 * present), the annual plan of the chosen strategy, and the action advisories. Everything here is
 * read from the mission store; the engine lives in src/core/advisory.
 */
import { useState } from 'react';
import { ClipboardList, Compass, MapPinned } from 'lucide-react';
import type { AdvisoryReport, FarmerPriority } from '@/contracts';
import { pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, EmptyState, Panel, Skeleton, SkeletonText, StatusGlyph, cn } from '@/ui/design';
import { AdvisoryCard, AdvisoryBody, AdvisoryPlate, IrrigationView, PhView, SowingView } from './ActionPlans';
import { AnnualPlanView } from './AnnualPlanView';
import { useFixture } from './fixture';
import { type CurrencyCode, fmtDate } from './format';
import { RotationCompare, orderStrategies } from './RotationCompare';
import { CurrencySwitch, FixtureTag, SectionHead, SupportLine } from './shared';
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
    <main aria-labelledby="adv-title" className="fixed inset-x-0 top-(--topbar-h) bottom-0 z-(--z-panel) overflow-y-auto bg-surface-0">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-6 pt-5 pb-28 compact:gap-6 compact:px-4 compact:pt-4">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 id="adv-title" className="t-title text-2xl leading-8">
              {t('advisory.title')}
            </h1>
            {parcel && <span className="text-base text-ink-2">{parcel.name}</span>}
            {crop && <span className="text-base text-ink-3">· {lang === 'vi' && crop.names.vi ? crop.names.vi : crop.names.en}</span>}
            {report && <span className="t-meta">{t('advisory.generated', { date: fmtDate(report.generatedAt, lang) })}</span>}
            {fixture && <FixtureTag />}
          </div>
          <SupportLine />
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
          <Body report={report} currency={currency} setCurrency={setCurrency} priorities={priorities} today={today} sowingMonth={groundTruth.sowingDate ? Number(groundTruth.sowingDate.slice(5, 7)) : null} />
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
                on ? 'border-signal bg-signal text-on-signal' : 'border-line-3 bg-inset text-ink-2 hover:bg-surface-2 hover:text-ink-1',
                'disabled:cursor-not-allowed disabled:opacity-45',
              )}
            >
              {on && <span className="t-value inline-flex size-4 items-center justify-center rounded-xs bg-on-signal text-2xs text-signal">{rank + 1}</span>}
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
      <div className="grid grid-cols-4 gap-px rounded-sm border border-line-1 bg-line-1">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 bg-surface-1 p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-16" />
            <SkeletonText lines={6} />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

interface BodyProps {
  report: AdvisoryReport | null;
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  priorities: FarmerPriority[];
  today: string;
  sowingMonth: number | null;
}

function Body({ report, currency, setCurrency, priorities, today, sowingMonth }: BodyProps) {
  const t = useT();
  const lang = useLang();
  const setPhase = useMission((s) => s.setPhase);
  const rotations = report?.rotations ?? [];
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

  const planStrategy = report.annualPlan ? rotations.find((r) => r.id === report.annualPlan!.strategyId) : undefined;
  const byKind = (k: string) => [...advisories].filter((a) => a.kind === k).sort((a, b) => a.priority - b.priority)[0];
  const irrAdv = byKind('irrigation');
  const phAdv = byKind('ph');
  const sowAdv = byKind('sowing');
  const shown = new Set([irrAdv?.id, phAdv?.id, sowAdv?.id]);
  const others = advisories.filter((a) => !shown.has(a.id)).sort((a, b) => a.priority - b.priority);
  const hasCurrent = rotations.some((r) => r.kind === 'current');
  const reviewCount = advisories.filter((a) => a.needsLocalReview).length + rotations.filter((r) => r.gaps.length || r.risks.length).length;

  return (
    <>
      <section aria-labelledby="adv-rot">
        <SectionHead
          id="adv-rot"
          title={t('advisory.compareTitle')}
          sub={t('advisory.compareSub', { n: rotations.length })}
          actions={
            <>
              {reviewCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm text-watch">
                  <StatusGlyph status="watch" />
                  {t('advisory.reviewCount', { n: reviewCount })}
                </span>
              )}
              <CurrencySwitch value={currency} onChange={setCurrency} />
            </>
          }
        />
        {rotations.length ? (
          <>
            {!hasCurrent && <p className="mb-2 text-sm text-watch">{t('advisory.noCurrent')}</p>}
            <RotationCompare rotations={orderStrategies(rotations)} priorities={priorities} currency={currency} planStrategyId={report.annualPlan?.strategyId} />
          </>
        ) : (
          <EmptyState layout="block" icon={<Compass />} title={t('advisory.empty.noRotations')} body={t('advisory.empty.noRotationsBody')} />
        )}
      </section>

      <div className="grid items-start gap-6 compact:gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section aria-labelledby="adv-plan">
          <Panel
            title={
              <span id="adv-plan">
                {t('advisory.plan.title')}
                {planStrategy && <span className="font-normal text-ink-2"> · {pick(planStrategy.name, lang)}</span>}
              </span>
            }
            actions={<CurrencySwitch value={currency} onChange={setCurrency} />}
          >
            {report.annualPlan ? (
              <AnnualPlanView plan={report.annualPlan} currency={currency} />
            ) : (
              <EmptyState layout="inline" icon={<ClipboardList />} title={t('advisory.empty.noPlan')} body={t('advisory.empty.noPlanBody')} />
            )}
          </Panel>
        </section>

        <section aria-label={t('advisory.actionsTitle')} className="flex flex-col gap-4">
          <AdvisoryPlate adv={irrAdv} title={t('advisory.irr.title')}>
            {report.irrigation ? <IrrigationView plan={report.irrigation} today={today} /> : <EmptyState layout="inline" title={t('advisory.empty.noIrrigation')} body={t('advisory.empty.noIrrigationBody')} />}
            {irrAdv && <Divider />}
            {irrAdv && <AdvisoryBody adv={irrAdv} currency={currency} showTitle />}
          </AdvisoryPlate>
          <AdvisoryPlate adv={phAdv} title={t('advisory.ph.title')}>
            {report.ph ? <PhView plan={report.ph} /> : <EmptyState layout="inline" title={t('advisory.empty.noPh')} body={t('advisory.empty.noPhBody')} />}
            {phAdv && <Divider />}
            {phAdv && <AdvisoryBody adv={phAdv} currency={currency} showTitle />}
          </AdvisoryPlate>
          <AdvisoryPlate adv={sowAdv} title={t('advisory.sow.title')}>
            {report.sowing?.length ? <SowingView windows={report.sowing} chosenMonth={sowingMonth} /> : <EmptyState layout="inline" title={t('advisory.empty.noSowing')} body={t('advisory.empty.noSowingBody')} />}
            {sowAdv && <Divider />}
            {sowAdv && <AdvisoryBody adv={sowAdv} currency={currency} showTitle />}
          </AdvisoryPlate>
        </section>
      </div>

      {others.length > 0 && (
        <section aria-labelledby="adv-other">
          <SectionHead id="adv-other" title={t('advisory.otherTitle')} sub={t('advisory.otherSub')} />
          <div className="grid gap-4 lg:grid-cols-2">
            {others.map((a) => (
              <AdvisoryCard key={a.id} adv={a} currency={currency} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function Divider() {
  return <div aria-hidden className="my-4 h-px bg-line-1" />;
}
