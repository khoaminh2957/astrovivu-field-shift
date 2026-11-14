/**
 * Rotation strategies side by side. The current rotation is the left-most column and the reference
 * tick on every meter, so each other column reads as "better or worse than what you do now".
 * The five mandatory lists close the table; information gaps and risks sit in a flagged band.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { FarmerPriority, Lang, RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { Meter, Tag, cn } from '@/ui/design';
import { type CurrencyCode, fmtNum, fmtSigned, money } from './format';
import { RotationCalendar } from './RotationCalendar';
import { EvidenceList, LocalReviewTag, TextList } from './shared';

type Better = 'higher' | 'lower';

interface MetricDef {
  key: string;
  better: Better;
  unit: (lang: Lang, cur: CurrencyCode) => string;
  get: (r: RotationStrategy) => number | null;
  /** Fixed 0..100 scale, or derived from the strategies being compared. */
  scale: 'pct' | 'data';
  fmt: (v: number, lang: Lang, cur: CurrencyCode) => string;
  digits?: number;
  priorities: FarmerPriority[];
}

/** Engines may publish 0..1 fractions or 0..100 scores; the table always shows 0..100. */
function asPct(values: (number | null)[]): (v: number | null) => number | null {
  const fractional = values.every((v) => v == null || Math.abs(v) <= 1);
  return (v) => (v == null ? null : fractional ? v * 100 : v);
}

const n0 = (v: number, lang: Lang) => fmtNum(v, lang, 0);

const METRICS: MetricDef[] = [
  { key: 'suitability', better: 'higher', unit: () => '/100', get: (r) => r.metrics.suitability, scale: 'pct', fmt: n0, priorities: ['yield'] },
  { key: 'soilHealth', better: 'higher', unit: () => '/100', get: (r) => r.metrics.soilHealth, scale: 'pct', fmt: n0, priorities: ['soil'] },
  { key: 'waterUse', better: 'lower', unit: () => 'mm/yr', get: (r) => r.metrics.waterUseMm, scale: 'data', fmt: n0, priorities: ['water'] },
  { key: 'waterFit', better: 'higher', unit: () => '/100', get: (r) => r.metrics.waterFit, scale: 'pct', fmt: n0, priorities: ['water'] },
  {
    key: 'margin',
    better: 'higher',
    unit: (lang, cur) => `${money(0, cur, lang, { compact: true }).unit}/ha·yr`,
    get: (r) => r.metrics.marginUsdPerHaYr,
    scale: 'data',
    fmt: (v, lang, cur) => money(v, cur, lang, { compact: true }).value,
    priorities: ['profit'],
  },
  {
    key: 'cost',
    better: 'lower',
    unit: (lang, cur) => `${money(0, cur, lang, { compact: true }).unit}/yr`,
    get: (r) => r.economics?.perYear?.costUsd ?? null,
    scale: 'data',
    fmt: (v, lang, cur) => money(v, cur, lang, { compact: true }).value,
    priorities: ['cost'],
  },
  { key: 'risk', better: 'lower', unit: () => '/100', get: (r) => r.metrics.risk, scale: 'pct', fmt: n0, priorities: ['risk'] },
  { key: 'nitrogen', better: 'higher', unit: () => 'kg N/ha·yr', get: (r) => r.metrics.nitrogenKgHaYr, scale: 'data', fmt: n0, priorities: ['soil', 'cost'] },
  { key: 'groundCover', better: 'higher', unit: () => '%', get: (r) => r.metrics.groundCoverPct, scale: 'pct', fmt: n0, priorities: ['soil'] },
  { key: 'pestBreak', better: 'higher', unit: () => '/100', get: (r) => r.metrics.pestBreak, scale: 'pct', fmt: n0, priorities: ['risk'] },
];

/** Current first (it is the reference), then by priority-weighted score. */
export function orderStrategies(rotations: RotationStrategy[]): RotationStrategy[] {
  const current = rotations.filter((r) => r.kind === 'current');
  const rest = rotations.filter((r) => r.kind !== 'current').sort((a, b) => b.score - a.score);
  return [...current, ...rest];
}

interface Props {
  rotations: RotationStrategy[];
  priorities: FarmerPriority[];
  currency: CurrencyCode;
  planStrategyId?: string;
}

export function RotationCompare({ rotations, priorities, currency, planStrategyId }: Props) {
  const t = useT();
  const lang = useLang();
  const cols = orderStrategies(rotations);
  const current = cols.find((r) => r.kind === 'current') ?? null;
  const scorePct = asPct(rotations.map((r) => r.score));
  const ranked = [...rotations].sort((a, b) => b.score - a.score).map((r) => r.id);
  const grid: CSSProperties = { gridTemplateColumns: `minmax(148px, 184px) repeat(${cols.length}, minmax(212px, 1fr))` };
  const isCur = (r: RotationStrategy) => r.kind === 'current';
  const colCls = (r: RotationStrategy) => cn('min-w-0 px-3 py-2.5', isCur(r) && 'bg-surface-2/55');

  return (
    <div className="overflow-x-auto rounded-sm border border-line-1 bg-surface-1" tabIndex={-1}>
      <div role="table" aria-label={t('advisory.compareTitle')} className="min-w-fit">
        {/* Head: rank, name, score. */}
        <div role="row" className="grid border-b border-line-2" style={grid}>
          <div role="columnheader" className="flex flex-col justify-end gap-1 px-3 py-2.5">
            <span className="t-label">{t('advisory.strategy')}</span>
            <span className="t-caption">{t('advisory.refHint')}</span>
          </div>
          {cols.map((r) => {
            const rank = ranked.indexOf(r.id) + 1;
            const s = scorePct(r.score);
            return (
              <div role="columnheader" key={r.id} className={cn(colCls(r), 'flex flex-col gap-2')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn('t-value inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1 text-xs', rank === 1 ? 'bg-signal font-bold text-on-signal' : 'border border-line-2 text-ink-2')}>
                    {rank}
                  </span>
                  {isCur(r) ? (
                    <Tag tone="neutral" variant="solid">
                      {t('advisory.current')}
                    </Tag>
                  ) : (
                    <Tag>{t(`advisory.kind.${r.kind}`)}</Tag>
                  )}
                  {r.id === planStrategyId && <Tag tone="ground-truth">{t('advisory.inPlan')}</Tag>}
                </div>
                <p className="t-heading line-clamp-2 min-h-10 text-ink-1">{pick(r.name, lang)}</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="t-value text-3xl leading-10 text-ink-1">{fmtNum(s, lang)}</span>
                  <span className="t-unit">/100</span>
                  {!isCur(r) && current && s != null && <span className="t-value ml-auto text-xs text-ink-3">{fmtSigned(s - (scorePct(current.score) ?? 0), lang)}</span>}
                </div>
                <Meter value={s} reference={current && !isCur(r) ? scorePct(current.score) : null} tone={rank === 1 ? 'signal' : 'ink'} ariaLabel={t('advisory.score')} />
              </div>
            );
          })}
        </div>

        <Row grid={grid} label={t('advisory.calendar')} hint={t('advisory.calendarHint')}>
          {cols.map((r) => (
            <div role="cell" key={r.id} className={colCls(r)}>
              <RotationCalendar seasons={r.seasons} years={r.years} compactLabels />
            </div>
          ))}
        </Row>

        <GroupHead grid={grid} label={t('advisory.metrics')} />
        {METRICS.map((m) => (
          <MetricRow key={m.key} def={m} cols={cols} current={current} grid={grid} priorities={priorities} currency={currency} colCls={colCls} />
        ))}

        <GroupHead grid={grid} label={t('advisory.rationale')} />
        <Row grid={grid} label={t('advisory.list.why')}>
          {cols.map((r) => (
            <div role="cell" key={r.id} className={colCls(r)}>
              <TextList items={r.why} empty={t('advisory.none')} />
            </div>
          ))}
        </Row>
        <Row grid={grid} label={t('advisory.list.evidence')}>
          {cols.map((r) => (
            <div role="cell" key={r.id} className={colCls(r)}>
              <EvidenceList items={r.evidence} />
            </div>
          ))}
        </Row>
        <Row grid={grid} label={t('advisory.list.benefits')}>
          {cols.map((r) => (
            <div role="cell" key={r.id} className={colCls(r)}>
              <TextList items={r.benefits} empty={t('advisory.none')} />
            </div>
          ))}
        </Row>

        {/* Gaps and risks are the part the challenge asks local expertise to review: flagged band. */}
        <div className="border-t border-watch/55 bg-watch/[0.04]">
          <div role="row" className="grid" style={grid}>
            <div role="rowheader" className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-2.5 pb-1">
              <LocalReviewTag />
              <span className="text-sm text-ink-2">{t('advisory.localReviewHint')}</span>
            </div>
          </div>
          <Row grid={grid} label={t('advisory.list.gaps')} flagged>
            {cols.map((r) => (
              <div role="cell" key={r.id} className={colCls(r)}>
                <TextList items={r.gaps} glyph="info" empty={t('advisory.noGaps')} />
              </div>
            ))}
          </Row>
          <Row grid={grid} label={t('advisory.list.risks')} flagged last>
            {cols.map((r) => (
              <div role="cell" key={r.id} className={colCls(r)}>
                <TextList items={r.risks} glyph="watch" empty={t('advisory.noRisks')} />
              </div>
            ))}
          </Row>
        </div>
      </div>
    </div>
  );
}

function Row({ grid, label, hint, children, flagged, last }: { grid: CSSProperties; label: ReactNode; hint?: ReactNode; children: ReactNode; flagged?: boolean; last?: boolean }) {
  return (
    <div role="row" className={cn('grid', !last && (flagged ? 'border-b border-watch/20' : 'border-b border-line-1'))} style={grid}>
      <div role="rowheader" className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <span className={cn('t-label', flagged && 'text-ink-1')}>{label}</span>
        {hint != null && <span className="t-caption">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function GroupHead({ grid, label }: { grid: CSSProperties; label: ReactNode }) {
  return (
    <div role="row" className="grid border-b border-line-1 bg-inset/60" style={grid}>
      <div role="rowheader" className="col-span-full px-3 py-1.5">
        <span className="t-heading text-ink-2">{label}</span>
      </div>
    </div>
  );
}

function MetricRow({
  def,
  cols,
  current,
  grid,
  priorities,
  currency,
  colCls,
}: {
  def: MetricDef;
  cols: RotationStrategy[];
  current: RotationStrategy | null;
  grid: CSSProperties;
  priorities: FarmerPriority[];
  currency: CurrencyCode;
  colCls: (r: RotationStrategy) => string;
}) {
  const t = useT();
  const lang = useLang();
  const raw = cols.map(def.get);
  const norm = def.scale === 'pct' ? asPct(raw) : (v: number | null) => v;
  const vals = raw.map(norm);
  const known = vals.filter((v): v is number => v != null);
  const lo = def.scale === 'pct' ? 0 : Math.min(0, ...known);
  const hi = def.scale === 'pct' ? 100 : Math.max(1, ...known) * 1.12;
  const best = known.length > 1 && new Set(known).size > 1 ? (def.better === 'higher' ? Math.max(...known) : Math.min(...known)) : null;
  const curVal = current ? norm(def.get(current)) : null;
  const rank = priorities.findIndex((p) => def.priorities.includes(p));
  const label = t(`advisory.metric.${def.key}`);

  return (
    <div role="row" className="grid border-b border-line-1" style={grid}>
      <div role="rowheader" className="flex min-w-0 items-start gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="t-label">{label}</span>
          <span className="t-caption">
            {def.unit(lang, currency)} · {t(def.better === 'higher' ? 'advisory.higherBetter' : 'advisory.lowerBetter')}
          </span>
        </div>
        {rank >= 0 && (
          <span title={t('advisory.priorityN', { n: rank + 1 })} className="t-value mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-xs border border-ink-2 text-2xs text-ink-1">
            {rank + 1}
          </span>
        )}
      </div>
      {cols.map((r, i) => {
        const v = vals[i];
        const isBest = v != null && best != null && v === best;
        const delta = v != null && curVal != null && r.kind !== 'current' ? v - curVal : null;
        const text = v == null ? '--' : def.fmt(v, lang, currency);
        return (
          <div role="cell" key={r.id} className={cn(colCls(r), 'flex flex-col gap-1.5 py-2')}>
            <div className="flex items-baseline gap-2">
              <span className={cn('t-value text-sm', isBest ? 'font-semibold text-ink-1' : 'text-ink-2', v == null && 'text-ink-4')}>{text}</span>
              {isBest && <span className="t-status text-ink-1">{t('advisory.best')}</span>}
              {delta != null && (
                <span className="t-value ml-auto text-2xs text-ink-3">
                  {def.key === 'margin' || def.key === 'cost' ? money(delta, currency, lang, { compact: true, signed: true }).value : fmtSigned(delta, lang)}
                </span>
              )}
            </div>
            <Meter
              value={v}
              min={lo}
              max={hi}
              reference={r.kind === 'current' ? null : curVal}
              ariaLabel={`${label}: ${text} ${def.unit(lang, currency)}`}
            />
          </div>
        );
      })}
    </div>
  );
}


