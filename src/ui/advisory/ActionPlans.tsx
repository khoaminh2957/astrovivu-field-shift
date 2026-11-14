/**
 * Action advisories: irrigation schedule, pH plan, sowing window and the rest. Every card shows
 * the same anatomy: what to do and when, the impact, the evidence, confidence and caveats.
 */
import type { ReactNode } from 'react';
import type { Advisory, IrrigationPlan, ISODate, Lang, PhPlan, SowingWindow } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { addDays, diffDays } from '@/lib/time';
import { ConfidenceBadge, Panel, Stat, cn, confidenceLevel } from '@/ui/design';
import { type CurrencyCode, clamp, fmtDate, fmtDayMonth, fmtNum, fmtSigned, monthLong, monthShort, money } from './format';
import { EvidenceList, LocalReviewTag, TextList, factorName } from './shared';

// ---------------------------------------------------------------------------------------------
// Shared advisory anatomy
// ---------------------------------------------------------------------------------------------

export function AdvisoryBody({ adv, currency, hideSummary, showTitle }: { adv: Advisory; currency: CurrencyCode; hideSummary?: boolean; showTitle?: boolean }) {
  const t = useT();
  const lang = useLang();
  const { scoreDelta, waterSavedMm, marginDeltaUsdPerHa } = adv.impact;
  const hasImpact = scoreDelta != null || waterSavedMm != null || marginDeltaUsdPerHa != null;
  const margin = money(marginDeltaUsdPerHa, currency, lang, { compact: true, signed: true });
  return (
    <div className="flex flex-col gap-3">
      {showTitle && <h3 className="t-heading">{pick(adv.title, lang)}</h3>}
      {!hideSummary && <p className="t-body max-w-[68ch] text-ink-1">{pick(adv.summary, lang)}</p>}
      {adv.actions.length > 0 && (
        <ol className="flex list-none flex-col p-0">
          {adv.actions.map((a, i) => (
            <li key={i} className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 border-b border-line-1 py-1.5 text-sm last:border-b-0">
              <span className="font-medium text-ink-1">{pick(a.when, lang)}</span>
              <span className="text-ink-2">{pick(a.what, lang)}</span>
              <span className="t-value text-xs text-ink-1">{a.amount ? pick(a.amount, lang) : ''}</span>
            </li>
          ))}
        </ol>
      )}
      {hasImpact && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-line-1 py-2">
          {scoreDelta != null && <Stat size="sm" label={t('advisory.impact.score')} value={fmtSigned(scoreDelta, lang)} unit={t('advisory.pts')} />}
          {waterSavedMm != null && <Stat size="sm" label={t('advisory.impact.water')} value={fmtNum(waterSavedMm, lang)} unit="mm" />}
          {marginDeltaUsdPerHa != null && <Stat size="sm" label={t('advisory.impact.margin')} value={margin.value} unit={`${margin.unit}/ha`} />}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h4 className="t-label">{t('advisory.list.evidence')}</h4>
          <EvidenceList items={adv.evidence} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="t-label">{t('advisory.caveats')}</h4>
            <ConfidenceBadge level={confidenceLevel(adv.confidence)} score={adv.confidence} footnote={t('advisory.confFoot')} />
          </div>
          <TextList items={adv.caveats} glyph="info" empty={t('advisory.noCaveats')} />
        </div>
      </div>
    </div>
  );
}

/** A plate for one advisory. Advisories that need local review tint their whole border. */
export function AdvisoryPlate({ adv, title, meta, children, className }: { adv?: Advisory; title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  const t = useT();
  return (
    <Panel
      as="article"
      title={title}
      meta={meta}
      actions={
        adv && (
          <>
            {adv.needsLocalReview && <LocalReviewTag />}
            <span className="t-meta" title={t('advisory.priorityHint')}>
              P{adv.priority}
            </span>
          </>
        )
      }
      className={cn(adv?.needsLocalReview && 'border-watch/45!', className)}
    >
      {children}
    </Panel>
  );
}

export function AdvisoryCard({ adv, currency }: { adv: Advisory; currency: CurrencyCode }) {
  const t = useT();
  const lang = useLang();
  return (
    <AdvisoryPlate adv={adv} title={pick(adv.title, lang)} meta={t(`advisory.kindAdv.${adv.kind}`)}>
      <AdvisoryBody adv={adv} currency={currency} />
    </AdvisoryPlate>
  );
}

// ---------------------------------------------------------------------------------------------
// Irrigation: calendar strip
// ---------------------------------------------------------------------------------------------

export function IrrigationView({ plan, today }: { plan: IrrigationPlan; today: ISODate }) {
  const t = useT();
  const lang = useLang();
  const events = [...plan.events].sort((a, b) => (a.t < b.t ? -1 : 1));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat label={t('advisory.irr.total')} value={fmtNum(plan.totalMm, lang)} unit="mm" hint={t('advisory.irr.events', { n: events.length })} />
        <Stat label={t('advisory.irr.saved')} value={fmtNum(plan.savedVsFixedMm, lang)} unit="mm" hint={t('advisory.irr.savedHint')} />
      </div>
      {events.length ? <IrrigationStrip events={events} today={today} lang={lang} /> : <p className="t-caption">{t('advisory.irr.none')}</p>}
      {events.length > 0 && (
        <ul className="flex list-none flex-col p-0">
          {events.map((e) => (
            <li key={e.t} className="grid grid-cols-[5.5rem_3.5rem_1fr] items-baseline gap-x-3 border-b border-line-1 py-1 text-sm last:border-b-0">
              <span className="t-value text-xs text-ink-1">{fmtDate(e.t, lang)}</span>
              <span className="t-value text-right text-xs text-ink-1">
                {fmtNum(e.mm, lang)} <span className="t-unit">mm</span>
              </span>
              <span className="truncate text-ink-2" title={pick(e.reason, lang)}>
                {pick(e.reason, lang)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="t-caption">
        {pick(plan.method, lang)} · {pick(plan.basis, lang)}
      </p>
    </div>
  );
}

function IrrigationStrip({ events, today, lang }: { events: IrrigationPlan['events']; today: ISODate; lang: Lang }) {
  const t = useT();
  const first = events[0].t < today ? events[0].t : today;
  const start = `${first.slice(0, 8)}01`;
  const lastEv = events.at(-1)!.t;
  const end = addDays(lastEv, 20);
  const days = Math.max(30, diffDays(start, end));
  const W = 600;
  const H = 64;
  const base = 46;
  const maxMm = Math.max(10, ...events.map((e) => e.mm));
  const x = (d: ISODate) => (clamp(diffDays(start, d), 0, days) / days) * W;
  const ticks: ISODate[] = [];
  for (let d = start; d <= end; ) {
    ticks.push(d);
    const [y, m] = d.split('-').map(Number);
    d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('advisory.irr.stripSummary', { n: events.length, from: fmtDate(events[0].t, lang), to: fmtDate(lastEv, lang) })}>
      <rect x={0} y={base} width={W} height={1} fill="var(--color-line-2)" />
      {ticks.map((d) => (
        <g key={d}>
          <rect x={x(d)} y={8} width={1} height={base - 8} fill="var(--color-line-1)" />
          <text x={x(d) + 3} y={H - 4} fill="var(--color-ink-4)" fontSize={10} fontFamily="var(--font-sans)">
            {monthShort(Number(d.slice(5, 7)), lang)}
          </text>
        </g>
      ))}
      {today >= start && today <= end && (
        <g>
          <rect x={x(today)} y={2} width={1.5} height={base - 2} fill="var(--color-signal)" />
          <text x={x(today) + 4} y={10} fill="var(--color-ink-2)" fontSize={10}>
            {t('advisory.today')}
          </text>
        </g>
      )}
      {events.map((e) => {
        const h = Math.max(3, (e.mm / maxMm) * (base - 16));
        return (
          <g key={e.t}>
            <title>{`${fmtDayMonth(e.t, lang)} · ${fmtNum(e.mm, lang)} mm · ${pick(e.reason, lang)}`}</title>
            <rect x={x(e.t) - 3} y={base - h} width={6} height={h} fill="var(--color-ink-1)" />
            <text x={x(e.t)} y={base - h - 3} textAnchor="middle" fill="var(--color-ink-2)" fontSize={9.5} fontFamily="var(--font-sans)">
              {Math.round(e.mm)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// pH plan
// ---------------------------------------------------------------------------------------------

export function PhView({ plan }: { plan: PhPlan }) {
  const t = useT();
  const lang = useLang();
  const lo = 3.5;
  const hi = 8.5;
  const pct = (v: number) => ((clamp(v, lo, hi) - lo) / (hi - lo)) * 100;
  const a = Math.min(plan.current, plan.target);
  const b = Math.max(plan.current, plan.target);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <Stat label={t('advisory.ph.current')} value={fmtNum(plan.current, lang, 1)} unit="pH" />
        <Stat label={t('advisory.ph.target')} value={fmtNum(plan.target, lang, 1)} unit="pH" />
        <Stat label={t('advisory.ph.amendment')} value={t(`advisory.ph.${plan.amendment}`)} size="sm" />
        <Stat
          label={t('advisory.ph.rate')}
          value={plan.rateTHa ? `${fmtNum(plan.rateTHa[0], lang, 1)}-${fmtNum(plan.rateTHa[1], lang, 1)}` : null}
          unit="t/ha"
          hint={plan.rateTHa ? t('advisory.ph.indicative') : t('advisory.ph.noRate')}
          size="sm"
        />
      </div>
      <div className="flex flex-col gap-1" role="img" aria-label={t('advisory.ph.scaleSummary', { from: fmtNum(plan.current, lang, 1), to: fmtNum(plan.target, lang, 1) })}>
        <div className="relative h-6">
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 bg-line-1" />
          <span aria-hidden className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-ink-4/60" style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} />
          <span aria-hidden title={t('advisory.ph.current')} className="absolute top-1/2 size-3 -translate-1/2 rotate-45 border-2 border-ink-1 bg-surface-1" style={{ left: `${pct(plan.current)}%` }} />
          <span aria-hidden title={t('advisory.ph.target')} className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-signal" style={{ left: `${pct(plan.target)}%` }} />
        </div>
        <div aria-hidden className="relative h-3.5">
          {[4, 5, 6, 7, 8].map((v) => (
            <span key={v} className="t-meta absolute -translate-x-1/2" style={{ left: `${pct(v)}%` }}>
              {v}
            </span>
          ))}
        </div>
        <div className="flex gap-4">
          <span className="t-caption inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rotate-45 border-[1.5px] border-ink-1" />
            {t('advisory.ph.current')}
          </span>
          <span className="t-caption inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-0.5 bg-signal" />
            {t('advisory.ph.target')}
          </span>
        </div>
      </div>
      <p className="t-caption">{pick(plan.basis, lang)}</p>
      {plan.caveats.length > 0 && <TextList items={plan.caveats} glyph="info" />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Sowing window: twelve monthly scores with reliability
// ---------------------------------------------------------------------------------------------

export function SowingView({ windows, chosenMonth }: { windows: SowingWindow[]; chosenMonth: number | null }) {
  const t = useT();
  const lang = useLang();
  const byMonth = new Map(windows.map((w) => [w.month, w]));
  const frac = windows.every((w) => w.score <= 1);
  const sc = (w?: SowingWindow) => (w == null ? null : frac ? w.score * 100 : w.score);
  const rel = (w?: SowingWindow) => (w?.reliability == null ? null : w.reliability <= 1 ? w.reliability * 100 : w.reliability);
  const best = windows.reduce<SowingWindow | null>((a, w) => (a == null || (sc(w) ?? 0) > (sc(a) ?? 0) ? w : a), null);
  const limits = [...new Set(windows.filter((w) => w.limiting && (sc(w) ?? 0) < 60).map((w) => w.limiting!))];

  return (
    <div className="flex flex-col gap-3">
      {best && (
        <p className="text-sm text-ink-1">
          {t('advisory.sow.best', { month: monthLong(best.month, lang), score: fmtNum(sc(best), lang), rel: rel(best) == null ? '--' : fmtNum(rel(best), lang) })}
        </p>
      )}
      <div className="grid grid-cols-12 items-end gap-1" role="list" aria-label={t('advisory.sow.title')}>
        {Array.from({ length: 12 }, (_, i) => {
          const w = byMonth.get(i + 1);
          const s = sc(w);
          const r = rel(w);
          const isBest = best?.month === i + 1;
          return (
            <div
              key={i}
              role="listitem"
              aria-label={`${monthLong(i + 1, lang)}: ${s == null ? '--' : fmtNum(s, lang)}/100, ${t('advisory.sow.reliability')} ${r == null ? '--' : fmtNum(r, lang)} %`}
              title={w?.limiting ? `${t('advisory.sow.limitedBy')}: ${factorName(t, w.limiting)}` : undefined}
              className="flex min-w-0 flex-col items-center gap-1"
            >
              <span className={cn('t-value text-2xs', isBest ? 'text-ink-1' : 'text-ink-3')}>{s == null ? '--' : fmtNum(s, lang)}</span>
              <div className="relative flex h-20 w-full items-end justify-center bg-inset">
                {s != null && <span aria-hidden className={cn('w-full max-w-6', isBest ? 'bg-signal' : 'bg-ink-3')} style={{ height: `${clamp(s, 0, 100)}%` }} />}
              </div>
              {/* Reliability: share of years in which that sowing month would have worked. */}
              <span aria-hidden className="relative h-1 w-full bg-line-1">
                {r != null && <span className="absolute inset-y-0 left-0 bg-ink-2" style={{ width: `${clamp(r, 0, 100)}%` }} />}
              </span>
              <span className={cn('text-2xs', chosenMonth === i + 1 ? 'font-semibold text-ink-1 underline decoration-signal underline-offset-2' : 'text-ink-3')}>{monthShort(i + 1, lang)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="t-caption inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2 bg-ink-3" />
          {t('advisory.sow.score')}
        </span>
        <span className="t-caption inline-flex items-center gap-1.5">
          <span aria-hidden className="h-1 w-3 bg-ink-2" />
          {t('advisory.sow.reliabilityLegend')}
        </span>
        {chosenMonth != null && <span className="t-caption">{t('advisory.sow.yours', { month: monthShort(chosenMonth, lang) })}</span>}
      </div>
      {limits.length > 0 && <p className="t-caption">{t('advisory.sow.limits', { list: limits.map((l) => factorName(t, l)).join(', ') })}</p>}
    </div>
  );
}
