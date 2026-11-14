/**
 * One card per rotation strategy, the current practice first as the baseline. A card says, without
 * a table, what the strategy grows, how it scores for the farmer's priorities and the few things
 * that change most against today. Choosing a card drives the rest of the page.
 */
import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Award, Check, TriangleAlert } from 'lucide-react';
import type { FarmerPriority, RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { Tag, cn } from '@/ui/design';
import { FALLOW_HATCH, GROUP_SOLID, cropGroup } from './cropGroups';
import { type CurrencyCode, cropNameOnly, fmtNum, fmtSigned } from './format';
import { METRICS, type TradeRow, metricDelta, metricUnit, metricValue, topDifferences, tradeOffRows } from './metrics';
import { layoutRotation } from './seasonLayout';

interface Props {
  /** Already ordered: current first, then by score. */
  rotations: RotationStrategy[];
  current: RotationStrategy | null;
  bestId: string | null;
  selectedId: string;
  onSelect: (id: string) => void;
  priorities: FarmerPriority[];
  currency: CurrencyCode;
  planStrategyId?: string;
}

export function StrategyCards({ rotations, current, bestId, selectedId, onSelect, priorities, currency, planStrategyId }: Props) {
  const t = useT();
  const refs = useRef(new Map<string, HTMLButtonElement>());

  // Radio group keys: arrows move the choice, as they do between native radio buttons.
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = rotations[(i + step + rotations.length) % rotations.length];
    onSelect(next.id);
    const el = refs.current.get(next.id);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div role="radiogroup" aria-label={t('advisory.compareTitle')} className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pt-1 pb-2">
      {rotations.map((r, i) => (
        <Card
          key={r.id}
          strategy={r}
          rows={tradeOffRows(current, r, rotations, priorities)}
          current={current}
          best={r.id === bestId}
          selected={r.id === selectedId}
          inPlan={r.id === planStrategyId}
          currency={currency}
          onSelect={() => onSelect(r.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
          buttonRef={(el) => (el ? refs.current.set(r.id, el) : refs.current.delete(r.id))}
        />
      ))}
    </div>
  );
}

interface CardProps {
  strategy: RotationStrategy;
  rows: TradeRow[];
  current: RotationStrategy | null;
  best: boolean;
  selected: boolean;
  inPlan: boolean;
  currency: CurrencyCode;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

function Card({ strategy: r, rows, current, best, selected, inPlan, currency, onSelect, onKeyDown, buttonRef }: CardProps) {
  const t = useT();
  const lang = useLang();
  const isCurrent = r.kind === 'current';
  const scoreDelta = !isCurrent && current ? Math.round(r.score) - Math.round(current.score) : null;
  const nameId = useId();
  const crops = [...new Set(r.seasons.map((s) => cropNameOnly(pick(s.label, lang))))].join(' · ');

  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-labelledby={nameId}
      aria-describedby={`${nameId}-d`}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        // `relative` keeps the visually hidden words inside the card, so they scroll with it.
        'relative flex min-w-60 flex-[1_0_15rem] snap-start flex-col gap-2.5 rounded-sm border p-3 text-left transition-colors duration-(--dur-instant)',
        selected ? 'border-signal bg-signal/8 ring-1 ring-signal' : best ? 'border-signal-strong bg-surface-0 hover:bg-surface-2' : 'border-line-2 bg-surface-0 hover:bg-surface-2',
      )}
    >
      <span className="flex min-h-5 items-center gap-1.5">
        <Tag tone="neutral" variant={isCurrent ? 'solid' : 'outline'}>
          {isCurrent ? t('advisory.card.baseline') : t(`advisory.kind.${r.kind}`)}
        </Tag>
        {best && (
          <Tag tone="ground-truth" variant="soft" icon={<Award size={12} strokeWidth={2} aria-hidden />}>
            {t('advisory.card.best')}
          </Tag>
        )}
        {/* The radio mark: selection is a shape, not only the green rim. */}
        <span aria-hidden className={cn('ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-signal bg-signal text-on-signal' : 'border-line-3 bg-surface-0')}>
          {selected && <Check size={11} strokeWidth={3} />}
        </span>
      </span>

      <span id={nameId} className="t-heading line-clamp-2 min-h-9 text-ink-1">
        {pick(r.name, lang)}
      </span>

      {/* Read after the name: the card is named by its strategy and described by the rest. */}
      <span id={`${nameId}-d`} className="flex flex-col gap-2.5">
        <span className="flex flex-col gap-1">
          <Ribbon strategy={r} />
          <span className="t-caption truncate" title={crops}>
            {crops || t('advisory.card.noSeasons')}
            {r.years > 1 && ` · ${t('advisory.card.years', { n: r.years })}`}
          </span>
        </span>

        <span className="flex items-baseline gap-1.5">
          <span className="t-value text-2xl text-ink-1">{fmtNum(r.score, lang)}</span>
          <span className="t-unit">/100</span>
          {scoreDelta != null && (
            <span className={cn('t-value ml-auto text-xs', scoreDelta > 0 ? 'text-nominal' : scoreDelta < 0 ? 'text-alert' : 'text-ink-3')}>
              {fmtSigned(scoreDelta, lang)} {t('advisory.card.vsCurrent')}
            </span>
          )}
          {isCurrent && <span className="t-caption ml-auto">{t('advisory.card.yourToday')}</span>}
        </span>

        <span className="flex flex-col gap-1 border-t border-line-1 pt-2">
          {isCurrent || !current ? <Anchors strategy={r} currency={currency} /> : <Differences rows={topDifferences(rows)} currency={currency} />}
        </span>

        {inPlan && <span className="t-caption">{t('advisory.card.inPlan')}</span>}
      </span>
    </button>
  );
}

/** The baseline has nothing to differ from: it shows the numbers the other cards are measured against. */
function Anchors({ strategy, currency }: { strategy: RotationStrategy; currency: CurrencyCode }) {
  const t = useT();
  const lang = useLang();
  return (
    <>
      {METRICS.filter((m) => m.key === 'margin' || m.key === 'waterUse' || m.key === 'soilHealth').map((m) => (
        <span key={m.key} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-ink-3">{t(`advisory.metric.${m.key}`)}</span>
          <span className="t-value shrink-0 text-ink-1">
            {metricValue(m, m.get(strategy), lang, currency)} <span className="t-unit">{metricUnit(m, lang, currency)}</span>
          </span>
        </span>
      ))}
    </>
  );
}

function Differences({ rows, currency }: { rows: TradeRow[]; currency: CurrencyCode }) {
  const t = useT();
  const lang = useLang();
  if (!rows.length) return <span className="t-caption">{t('advisory.card.noDiff')}</span>;
  return (
    <>
      {rows.map((row) => {
        const good = row.verdict === 'better';
        const Icon = good ? Check : TriangleAlert;
        return (
          <span key={row.def.key} className={cn('flex items-start gap-1.5 text-xs font-medium', good ? 'text-nominal' : 'text-alert')}>
            <Icon size={13} strokeWidth={2} aria-hidden className="mt-px shrink-0" />
            <span className="min-w-0">
              <span className="t-value">{t(`advisory.diff.${row.def.key}`, { v: metricDelta(row.def, row.delta, lang, currency), unit: metricUnit(row.def, lang, currency) })}</span>
              <span className="sr-only">, {t(`advisory.verdict.${row.verdict}`)}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}

/** The rotation as a thin strip, all its years end to end; the calendar below carries the names. */
function Ribbon({ strategy }: { strategy: RotationStrategy }) {
  const rows = layoutRotation(strategy.seasons, strategy.years);
  return (
    <span aria-hidden className="flex gap-1">
      {rows.map((row) => (
        <span key={row.year} className="grid flex-1 grid-cols-12 gap-y-px overflow-hidden rounded-xs bg-surface-3" style={{ gridTemplateRows: `repeat(${Math.max(1, row.lanes.length)}, 6px)` }}>
          {row.lanes.map((lane, li) =>
            lane.map((seg) => {
              const group = cropGroup(seg.season.cropId);
              return (
                <span
                  key={`${seg.index}-${seg.col}`}
                  className={cn('border-r border-surface-0 last:border-r-0', GROUP_SOLID[group])}
                  style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: li + 1, ...(group === 'fallow' ? { backgroundImage: FALLOW_HATCH } : null) }}
                />
              );
            }),
          )}
        </span>
      ))}
    </span>
  );
}
