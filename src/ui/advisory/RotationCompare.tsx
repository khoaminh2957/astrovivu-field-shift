/**
 * "Show all numbers": every strategy on every criterion as a plain table, for the reader who wants
 * the figures behind the cards and the trade-off chart. The current practice is the first column;
 * the other columns carry their difference from it.
 */
import type { FarmerPriority, RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { cn } from '@/ui/design';
import { type CurrencyCode, fmtNum, fmtSigned } from './format';
import { metricDelta, metricUnit, metricValue, orderStrategies, tradeOffRows } from './metrics';

interface Props {
  rotations: RotationStrategy[];
  priorities: FarmerPriority[];
  currency: CurrencyCode;
}

export function RotationCompare({ rotations, priorities, currency }: Props) {
  const t = useT();
  const lang = useLang();
  const cols = orderStrategies(rotations);
  const current = cols.find((r) => r.kind === 'current') ?? null;
  if (!cols.length) return null;
  // Same order as the trade-off rows: the farmer's priorities first.
  const defs = tradeOffRows(current, cols[0], cols, priorities).map((r) => r.def);
  const th = 'px-2 py-1.5 text-left align-bottom font-medium';
  const td = 'px-2 py-1.5 text-right align-top';

  return (
    <div className="overflow-x-auto rounded-sm border border-line-1" tabIndex={0} role="region" aria-label={t('advisory.trade.tableCaption')}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{t('advisory.trade.tableCaption')}</caption>
        <thead>
          <tr className="border-b border-line-2 bg-surface-2">
            <th scope="col" className={cn(th, 't-label min-w-36')}>
              {t('advisory.metrics')}
            </th>
            {cols.map((r) => (
              <th key={r.id} scope="col" className={cn(th, 'min-w-28 text-right text-xs text-ink-1')}>
                {pick(r.name, lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line-1">
            <th scope="row" className={cn(th, 'text-ink-1')}>
              {t('advisory.score')} <span className="t-unit">/100</span>
            </th>
            {cols.map((r) => (
              <td key={r.id} className={td}>
                <span className="t-value text-ink-1">{fmtNum(r.score, lang)}</span>
                {current && r.id !== current.id && <span className="t-caption t-value block">{fmtSigned(Math.round(r.score) - Math.round(current.score), lang)}</span>}
              </td>
            ))}
          </tr>
          {defs.map((def) => {
            const vals = cols.map(def.get);
            const known = vals.filter((v): v is number => v != null);
            const best = new Set(known).size > 1 ? (def.better === 'higher' ? Math.max(...known) : Math.min(...known)) : null;
            const cur = current ? def.get(current) : null;
            return (
              <tr key={def.key} className="border-b border-line-1 last:border-b-0">
                <th scope="row" className={th}>
                  <span className="block text-ink-1">{t(`advisory.metric.${def.key}`)}</span>
                  <span className="t-caption block font-normal">
                    {metricUnit(def, lang, currency)} · {t(def.better === 'higher' ? 'advisory.higherBetter' : 'advisory.lowerBetter')}
                  </span>
                </th>
                {cols.map((r, i) => {
                  const v = vals[i];
                  const isBest = v != null && v === best;
                  return (
                    <td key={r.id} className={td}>
                      <span className={cn('t-value', isBest ? 'font-bold text-ink-1' : 'text-ink-2')}>{metricValue(def, v, lang, currency)}</span>
                      {isBest && <span className="t-caption ml-1">{t('advisory.best')}</span>}
                      {current && r.id !== current.id && v != null && cur != null && <span className="t-caption t-value block">{metricDelta(def, v - cur, lang, currency)}</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
