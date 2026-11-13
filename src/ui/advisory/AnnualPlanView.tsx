/** Twelve-month plan for the chosen strategy: tasks, money in and out, and the cash position. */
import type { AnnualPlan, Lang } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { Stat, cn } from '@/ui/design';
import { type CurrencyCode, fmtNum, monthLong, monthShort, money } from './format';
import { TextList } from './shared';

export function AnnualPlanView({ plan, currency }: { plan: AnnualPlan; currency: CurrencyCode }) {
  const t = useT();
  const lang = useLang();
  const m = (v: number | null | undefined, compact = true) => money(v, currency, lang, { compact });
  const months = [...plan.months].sort((a, b) => a.month - b.month);
  const lowCash = months.reduce((lo, x) => Math.min(lo, x.cashUsd), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat label={t('advisory.plan.revenue')} value={m(plan.totals.revenueUsd).value} unit={m(plan.totals.revenueUsd).unit} />
        <Stat label={t('advisory.plan.cost')} value={m(plan.totals.costUsd).value} unit={m(plan.totals.costUsd).unit} />
        <Stat label={t('advisory.plan.margin')} value={m(plan.totals.marginUsd).value} unit={m(plan.totals.marginUsd).unit} hint={`${fmtNum(plan.totals.marginPct, lang, 0)} % ${t('advisory.plan.ofRevenue')}`} />
        <Stat
          label={t('advisory.plan.lowestCash')}
          value={m(lowCash).value}
          unit={m(lowCash).unit}
          hint={lowCash < 0 ? t('advisory.plan.needsCredit') : t('advisory.plan.noCredit')}
          tone={lowCash < 0 ? 'watch' : undefined}
        />
      </div>

      <CashChart months={months} lang={lang} currency={currency} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <caption className="sr-only">{t('advisory.plan.table')}</caption>
          <thead>
            <tr className="border-b border-line-2 text-left">
              <th scope="col" className="t-label w-14 py-1.5 pr-2 font-medium">{t('advisory.plan.month')}</th>
              <th scope="col" className="t-label py-1.5 pr-2 font-medium">{t('advisory.plan.tasks')}</th>
              <th scope="col" className="t-label py-1.5 pr-2 text-right font-medium">{t('advisory.plan.cost')}</th>
              <th scope="col" className="t-label py-1.5 pr-2 text-right font-medium">{t('advisory.plan.revenue')}</th>
              <th scope="col" className="t-label py-1.5 text-right font-medium">{t('advisory.plan.cash')}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((x) => (
              <tr key={x.month} className="border-b border-line-1 align-top">
                <th scope="row" className="py-1.5 pr-2 text-left font-medium text-ink-1" title={monthLong(x.month, lang)}>
                  {monthShort(x.month, lang)}
                </th>
                <td className="py-1.5 pr-2 text-ink-2">{x.tasks.length ? x.tasks.map((task) => pick(task, lang)).join(' · ') : <span className="text-ink-3">--</span>}</td>
                <td className="t-value py-1.5 pr-2 text-right text-ink-2">{x.costUsd ? `−${m(x.costUsd).value}` : '--'}</td>
                <td className="t-value py-1.5 pr-2 text-right text-ink-1">{x.revenueUsd ? m(x.revenueUsd).value : '--'}</td>
                <td className={cn('t-value py-1.5 text-right', x.cashUsd < 0 ? 'text-watch' : 'text-ink-1')}>{m(x.cashUsd).value}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-2">
              <th scope="row" colSpan={2} className="t-label py-2 pr-2 text-left font-medium">
                {t('advisory.plan.total')} <span className="t-unit">{m(0).unit}</span>
              </th>
              <td className="t-value py-2 pr-2 text-right text-ink-1">−{m(plan.totals.costUsd).value}</td>
              <td className="t-value py-2 pr-2 text-right text-ink-1">{m(plan.totals.revenueUsd).value}</td>
              <td className="t-value py-2 text-right font-semibold text-ink-1">{m(plan.totals.marginUsd).value}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {plan.assumptions.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line-1 pt-3">
          <h4 className="t-label">{t('advisory.plan.assumptions')}</h4>
          <TextList items={plan.assumptions} className="text-xs" />
        </div>
      )}
    </div>
  );
}

/** Revenue up, cost down, cumulative cash as a line: when the money goes out and comes back. */
function CashChart({ months, lang, currency }: { months: AnnualPlan['months']; lang: Lang; currency: CurrencyCode }) {
  const t = useT();
  const W = 600;
  const H = 150;
  const padL = 4;
  const padR = 4;
  const top = 10;
  const bottom = 18;
  const maxBar = Math.max(1, ...months.map((x) => Math.max(x.revenueUsd, x.costUsd)));
  const cashAbs = Math.max(1, ...months.map((x) => Math.abs(x.cashUsd)));
  const scale = Math.max(maxBar, cashAbs);
  const mid = top + (H - top - bottom) / 2;
  const half = (H - top - bottom) / 2;
  const y = (v: number) => mid - (v / scale) * half;
  const slot = (W - padL - padR) / 12;
  const bw = Math.min(18, slot * 0.34);
  const cx = (mo: number) => padL + slot * (mo - 0.5);
  const line = months.map((x, i) => `${i ? 'L' : 'M'}${cx(x.month).toFixed(1)},${y(x.cashUsd).toFixed(1)}`).join('');
  const peak = months.reduce((a, b) => (b.revenueUsd > a.revenueUsd ? b : a), months[0]);
  const summary = t('advisory.plan.chartSummary', {
    peak: peak ? monthLong(peak.month, lang) : '--',
    end: money(months.at(-1)?.cashUsd ?? null, currency, lang, { compact: true }).value + ' ' + money(0, currency, lang, { compact: true }).unit,
  });

  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
        <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--color-line-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {months.map((x) => (
          <g key={x.month}>
            {x.revenueUsd > 0 && <rect x={cx(x.month) - bw - 1} y={y(x.revenueUsd)} width={bw} height={mid - y(x.revenueUsd)} fill="var(--color-ink-2)" />}
            {x.costUsd > 0 && <rect x={cx(x.month) + 1} y={mid} width={bw} height={y(-x.costUsd) - mid} fill="var(--color-ink-4)" />}
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--color-signal)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {months.map((x) => (
          <circle key={x.month} cx={cx(x.month)} cy={y(x.cashUsd)} r={2.25} fill={x.cashUsd < 0 ? 'var(--color-watch)' : 'var(--color-signal)'} />
        ))}
      </svg>
      <div aria-hidden className="grid grid-cols-12">
        {months.map((x) => (
          <span key={x.month} className="t-meta text-center">
            {monthShort(x.month, lang)}
          </span>
        ))}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Legend swatch="bg-ink-2" label={t('advisory.plan.revenue')} />
        <Legend swatch="bg-ink-4" label={t('advisory.plan.cost')} />
        <Legend swatch="bg-signal h-0.5" label={t('advisory.plan.cash')} />
      </figcaption>
    </figure>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="t-caption inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('inline-block h-2 w-3', swatch)} />
      {label}
    </span>
  );
}
