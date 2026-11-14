/**
 * The selected strategy against the current practice, criterion by criterion, as a dumbbell chart.
 * Every row uses an axis where right is better, so a segment running right is a gain and one
 * running left is a loss, whichever way the underlying number goes. The signed difference in the
 * criterion's own unit stands at the end of the row.
 */
import { useState } from 'react';
import { Check, ChevronDown, Minus, TriangleAlert } from 'lucide-react';
import type { FarmerPriority, RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { Button, cn } from '@/ui/design';
import type { CurrencyCode } from './format';
import { type TradeRow, isMoney, metricDelta, metricUnit, metricValue, tradeOffRows } from './metrics';
import { RotationCompare } from './RotationCompare';

interface Props {
  rotations: RotationStrategy[];
  current: RotationStrategy | null;
  selected: RotationStrategy;
  priorities: FarmerPriority[];
  currency: CurrencyCode;
  usesReference: boolean;
}

export function TradeOffs({ rotations, current, selected, priorities, currency, usesReference }: Props) {
  const t = useT();
  const lang = useLang();
  const [showAll, setShowAll] = useState(false);
  const comparing = current != null && current.id !== selected.id;
  const rows = tradeOffRows(current, selected, rotations, priorities);
  const count = (v: TradeRow['verdict']) => rows.filter((r) => r.verdict === v).length;

  return (
    <div className="flex flex-col gap-3">
      {comparing ? (
        <>
          <p className="text-sm text-ink-2">{t('advisory.trade.summary', { name: pick(selected.name, lang), better: count('better'), worse: count('worse'), same: count('same') })}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-hidden>
            <span className="t-caption inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border-2 border-ink-3 bg-surface-0" />
              {t('advisory.current')}
            </span>
            <span className="t-caption inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-ink-1" />
              {t('advisory.cal.selected')}
            </span>
            <span className="t-caption ml-auto">{t('advisory.trade.axis')}</span>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink-2">{current ? t('advisory.trade.baseline') : t('advisory.noCurrent')}</p>
      )}

      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((row) => (
          <Row key={row.def.key} row={row} comparing={comparing} currency={currency} usesReference={usesReference} />
        ))}
      </ul>

      <div>
        <Button size="sm" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} iconRight={<ChevronDown size={14} aria-hidden className={cn('transition-transform', showAll && 'rotate-180')} />}>
          {showAll ? t('advisory.trade.hideAll') : t('advisory.trade.showAll')}
        </Button>
      </div>
      {showAll && <RotationCompare rotations={rotations} priorities={priorities} currency={currency} />}
    </div>
  );
}

const TONE = { better: 'text-nominal', worse: 'text-alert', same: 'text-ink-3' } as const;
const FILL = { better: 'bg-nominal', worse: 'bg-alert', same: 'bg-ink-3' } as const;
const ICON = { better: Check, worse: TriangleAlert, same: Minus } as const;

function Row({ row, comparing, currency, usesReference }: { row: TradeRow; comparing: boolean; currency: CurrencyCode; usesReference: boolean }) {
  const t = useT();
  const lang = useLang();
  const { def, verdict } = row;
  const unit = metricUnit(def, lang, currency);
  const label = t(`advisory.metric.${def.key}`);
  const val = (v: number | null) => metricValue(def, v, lang, currency);
  const Icon = verdict ? ICON[verdict] : null;
  const a = row.currentPos;
  const b = row.selectedPos;
  const pct = (p: number) => `${p * 100}%`;
  const spoken =
    comparing && verdict
      ? t('advisory.trade.rowAria', { label, from: val(row.current), to: val(row.selected), unit, verdict: t(`advisory.verdict.${verdict}`) })
      : `${label}: ${val(row.selected)} ${unit}`;

  return (
    <li className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,9.5rem)] items-center gap-x-4 gap-y-1 border-b border-line-1 py-2 last:border-b-0 narrow:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-1.5">
        {row.rank >= 0 && (
          <span title={t('advisory.priorityN', { n: row.rank + 1 })} className="t-value inline-flex size-4 shrink-0 items-center justify-center rounded-xs bg-signal text-2xs font-bold text-on-signal">
            {row.rank + 1}
          </span>
        )}
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink-1">{label}</span>
          <span className="t-caption block">
            {unit} · {t(def.better === 'higher' ? 'advisory.higherBetter' : 'advisory.lowerBetter')}
          </span>
        </span>
      </div>

      {/* The track: on a narrow screen it drops under the label and the difference. */}
      <div role="img" aria-label={spoken} className="relative mx-2 h-5 narrow:order-3 narrow:col-span-2">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-2" />
        {comparing && a != null && b != null && verdict && <span className={cn('absolute top-1/2 h-1 -translate-y-1/2 rounded-full', FILL[verdict])} style={{ left: pct(Math.min(a, b)), width: pct(Math.abs(b - a)) }} />}
        {comparing && a != null && <span className="absolute top-1/2 size-3 -translate-1/2 rounded-full border-2 border-ink-3 bg-surface-0" style={{ left: pct(a) }} />}
        {b != null && <span className={cn('absolute top-1/2 size-3.5 -translate-1/2 rounded-full ring-2 ring-surface-0', comparing && verdict ? FILL[verdict] : 'bg-ink-1')} style={{ left: pct(b) }} />}
      </div>

      <div className="flex min-w-0 flex-col items-end text-right">
        {comparing && verdict && Icon ? (
          <>
            <span className={cn('t-value inline-flex items-center gap-1 text-sm', TONE[verdict])}>
              <Icon size={13} strokeWidth={2} aria-hidden className="shrink-0" />
              {metricDelta(def, row.delta, lang, currency)} <span className="font-normal">{t(`advisory.verdict.${verdict}`)}</span>
            </span>
            <span className="t-caption t-value whitespace-nowrap">{t('advisory.trade.fromTo', { from: val(row.current), to: val(row.selected) })}</span>
          </>
        ) : (
          <span className="t-value text-sm text-ink-1">{val(row.selected)}</span>
        )}
        {usesReference && isMoney(def) && <span className="t-caption">{t('advisory.refShort')}</span>}
      </div>
    </li>
  );
}
