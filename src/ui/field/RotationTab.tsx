/**
 * "What should I grow": the strategy that scores highest for this field, how it differs from what
 * the grower does now on the criteria they care about first, and the way into the full comparison.
 * Everything shown is the advisory report's; nothing is ranked or computed again here.
 */
import { ArrowRight } from 'lucide-react';
import { pick, type RotationStrategy } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { type CurrencyCode, cropNameOnly, monthSpan } from '@/ui/advisory/format';
import { bestStrategyId, defaultSelection, metricDelta, metricUnit, metricValue, tradeOffRows, type TradeRow } from '@/ui/advisory/metrics';
import '@/ui/advisory/strings';
import { useMissionUi } from '@/ui/chrome/uiState';
import { Button, cn } from '@/ui/design';
import './strings';

/** The seasons of a strategy in order, as `Rice (Dec-Mar) → Mung bean (Apr-Jun)`. */
function Sequence({ strategy }: { strategy: RotationStrategy }) {
  const lang = useLang();
  const t = useT();
  if (!strategy.seasons.length) return <p className="t-caption">{t('advisory.card.noSeasons')}</p>;
  // A perennial stand is the same season year after year: said once, with how many times.
  const runs: { season: RotationStrategy['seasons'][number]; n: number }[] = [];
  for (const s of strategy.seasons) {
    const last = runs.at(-1);
    if (last && last.season.cropId === s.cropId && last.season.startMonth === s.startMonth && last.season.endMonth === s.endMonth) last.n += 1;
    else runs.push({ season: s, n: 1 });
  }
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-1">
      {runs.map(({ season: s, n }, i) => (
        <li key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-ink-4">
              →
            </span>
          )}
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5">
            {cropNameOnly(pick(s.label, lang))} <span className="text-ink-3">{monthSpan(s.startMonth, s.endMonth, lang)}</span>
            {n > 1 && <span className="t-value ml-1 text-ink-2">{t('field.rot.times', { n })}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DiffRow({ row, currency }: { row: TradeRow; currency: CurrencyCode }) {
  const t = useT();
  const lang = useLang();
  const tone = row.verdict === 'better' ? 'text-signal-strong' : row.verdict === 'worse' ? 'text-alert' : 'text-ink-3';
  return (
    <tr className="border-t border-line-1">
      <th scope="row" className="py-2 pr-2 text-left font-normal text-ink-2">
        {t(`advisory.metric.${row.def.key}`)}
        <span className="t-unit ml-1">{metricUnit(row.def, lang, currency)}</span>
      </th>
      <td className="t-value py-2 pr-2 text-right text-ink-3">{metricValue(row.def, row.current, lang, currency)}</td>
      <td className="t-value py-2 pr-2 text-right text-ink-1">{metricValue(row.def, row.selected, lang, currency)}</td>
      <td className={cn('t-value py-2 text-right', tone)}>
        {row.delta == null ? '--' : metricDelta(row.def, row.delta, lang, currency)}
        <span className="sr-only"> {row.verdict ? t(`field.rot.${row.verdict}`) : ''}</span>
      </td>
    </tr>
  );
}

export function RotationTab() {
  const t = useT();
  const lang = useLang();
  const advisory = useMission((s) => s.advisory);
  const priorities = useMission((s) => s.priorities);
  const gtCurrency = useMission((s) => s.groundTruth.currency);
  // Nothing was entered about today's crops and no crop record exists for the field (the engine reads the
  // Cropland Data Layer in the US): its "current practice" is then its own assumption.
  const assumed = useMission((s) => !s.cropId && !s.groundTruth.currentRotation?.length && !s.telemetry?.cropHistory?.length);
  const setPhase = useMission((s) => s.setPhase);
  const setTab = useMissionUi((s) => s.setFieldTab);
  const open = () => setPhase('advisory');

  if (!advisory) {
    return (
      <div aria-busy className="flex flex-col gap-3">
        <span className="skeleton h-6 w-2/3" />
        <span className="skeleton h-40 rounded-sm" />
        <p className="t-caption">{t('field.rot.loading')}</p>
      </div>
    );
  }
  const all = advisory.rotations;
  const top = all.find((r) => r.id === defaultSelection(all));
  if (!top) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-ink-2">{t('field.rot.none')}</p>
        <Button variant="secondary" onClick={() => setTab('soil')}>
          {t('field.rot.tellCrop')}
        </Button>
      </div>
    );
  }
  const current = all.find((r) => r.kind === 'current') ?? null;
  const currency: CurrencyCode = gtCurrency ?? (lang === 'vi' ? 'VND' : 'USD');
  const rows = current ? tradeOffRows(current, top, all, priorities).filter((r) => r.delta != null).slice(0, 4) : [];
  const currentIsBest = current != null && bestStrategyId(all) === current.id;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-2">{t(!current ? 'field.rot.ledeNoCurrent' : assumed ? 'field.rot.ledeAssumed' : 'field.rot.lede', { n: all.length })}</p>

      <section className="flex flex-col gap-3 rounded-sm border border-line-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs text-ink-3">{t(currentIsBest ? 'field.rot.alt' : 'field.rot.top')}</span>
            <h3 className="text-lg leading-6 font-medium text-ink-1">{pick(top.name, lang)}</h3>
          </div>
          <span className="shrink-0 text-right">
            <span className="t-value text-xl leading-7 text-ink-1">{Math.round(top.score)}</span>
            <span className="t-unit ml-0.5">/100</span>
          </span>
        </div>
        <Sequence strategy={top} />
        {top.why[0] && <p className="text-sm text-ink-2">{pick(top.why[0], lang)}</p>}
      </section>

      {current ? (
        <section className="flex flex-col gap-2">
          <h3 className="t-heading">{t(assumed ? 'field.rot.vsAssumed' : 'field.rot.vs')}</h3>
          {assumed && (
            <div className="flex flex-col items-start gap-2 rounded-sm bg-surface-2 px-3 py-2.5">
              <p className="text-sm text-ink-1">{t('field.rot.assumedNote')}</p>
              <Button variant="secondary" size="sm" onClick={() => setTab('soil')}>
                {t('field.rot.tellCrop')}
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-ink-3">
              {t(assumed ? 'field.rot.nowAssumed' : 'field.rot.now')}: <span className="text-ink-1">{pick(current.name, lang)}</span>
            </span>
            <Sequence strategy={current} />
          </div>
          {currentIsBest && <p className="t-caption text-ink-2">{t('field.rot.currentBest')}</p>}
          {rows.length > 0 ? (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="t-label text-right">
                  <th className="pb-1 text-left font-medium" />
                  <th className="pb-1 pr-2 font-medium">{t('field.rot.colNow')}</th>
                  <th className="pb-1 pr-2 font-medium">{t('field.rot.colTop')}</th>
                  <th className="pb-1 font-medium">{t('field.rot.colDiff')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <DiffRow key={r.def.key} row={r} currency={currency} />
                ))}
              </tbody>
            </table>
          ) : (
            <p className="t-caption">{t('advisory.card.noDiff')}</p>
          )}
        </section>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="t-caption text-ink-2">{t('field.rot.noCurrent')}</p>
          <Button variant="ghost" onClick={() => setTab('soil')}>
            {t('field.rot.tellCrop')}
          </Button>
        </div>
      )}

      <div>
        <Button variant="primary" iconRight={<ArrowRight />} onClick={open}>
          {t('field.rot.open', { n: all.length })}
        </Button>
        <p className="t-caption mt-2">{t('field.rot.openNote')}</p>
      </div>
    </div>
  );
}
