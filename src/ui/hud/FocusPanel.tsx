import { latencyDaysOf } from '@/data/sources';
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { BRANCH_SIDE, type BranchId, type Series, pick } from '@/contracts';
import { paintForSeries, parcelReadingAt } from '@/globe';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES, primarySeries, sampleAt } from '@/lib/series';
import { addDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { BranchIcon, ConfidenceBadge, IconButton, KeyValue, ProvenanceTag, RampLegend, ScrollArea, Sparkline, StatusTag, cn } from '@/ui/design';
import { digitsFor, fmtDate, fmtNum, fmtRes, unitFor } from './format';
import { readBranch } from './readings';
import './strings';

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-line-1 pt-3">
      <h3 className="t-heading">{title}</h3>
      {children}
    </section>
  );
}

function SeriesRow({ series, branch }: { series: Series; branch: BranchId }) {
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry)!;
  const cursor = useMission((s) => s.timeline.cursor);
  const at = sampleAt(series, cursor, latencyDaysOf(series.sourceId, telemetry.sources[series.sourceId]));
  const src = telemetry.sources[series.sourceId];
  const sim = telemetry.mode === 'mock';
  const forecast = series.branch === 'risk';
  const from = forecast ? addDays(telemetry.window.today, -45) : telemetry.window.start;
  const end = forecast ? (telemetry.window.forecastEnd ?? telemetry.window.today) : telemetry.window.end;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-label truncate">{pick(series.label, lang)}</span>
        <span className="flex shrink-0 items-baseline gap-1">
          <span className={cn('t-value text-base', at.stale && 'text-ink-3')}>{fmtNum(at.sample?.v, digitsFor(series.unit, series.key))}</span>
          <span className="t-unit">{unitFor(series.unit, series.key)}</span>
        </span>
      </div>
      <Sparkline
        samples={forecast ? [] : series.samples}
        forecast={forecast ? series.samples : undefined}
        domain={[from, end]}
        range={series.range}
        cadence={series.cadence}
        baseline={series.baseline}
        cursor={cursor >= from ? cursor : null}
        today={telemetry.window.today}
        tone={series.primary ? branch : 'ink'}
        variant={series.key === 'rain' ? 'bars' : 'line'}
        provenance={sim ? 'simulated' : undefined}
        height={32}
        points={false}
        label={pick(series.label, lang)}
        unit={series.unit}
      />
      <ProvenanceTag compact provenance={sim ? 'simulated' : (src?.provenance ?? 'derived')} source={src?.name ?? series.sourceId} detail={[fmtRes(src?.resolutionM), series.cadence].filter(Boolean).join(' · ')} />
    </div>
  );
}

/**
 * Expanded reading of the branch in focus. It opens over the opposite column, so the focused
 * callout, its leader line and the recoloured parcel stay in view together.
 */
export function FocusPanel({ branch: id }: { branch: BranchId }) {
  const t = useT();
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry);
  const parcel = useMission((s) => s.parcel);
  const cursor = useMission((s) => s.timeline.cursor);
  const insights = useMission((s) => s.insights);
  const groundTruth = useMission((s) => s.groundTruth);
  const setFocus = useMission((s) => s.setFocusBranch);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFocus]);

  const branch = telemetry?.branches[id];
  const title = pick(branch?.title ?? BRANCH_TITLES[id], lang);
  const side = BRANCH_SIDE[id] === 'left' ? 'right' : 'left';
  if (!telemetry || !parcel || !branch) return null;

  const r = readBranch({ telemetry, branch, cursor, parcel, insights, groundTruth, lang, t });
  const primary = primarySeries(branch);
  const paint = primary ? parcelReadingAt(primary, cursor) : null;
  const paintSpec = primary ? paintForSeries(primary) : null;
  const sources = branch.sources.map((sid) => telemetry.sources[sid]).filter(Boolean);
  const days = (n: number | null) => (n == null ? t('hud.src.static') : t('hud.src.days', { n }));

  return (
    <aside
      aria-label={title}
      className={cn(
        'plate-raised absolute z-(--z-panel) flex flex-col',
        'top-[calc(var(--topbar-h)+8px)] bottom-[calc(var(--timeline-h)+8px)] w-[calc(var(--hud-callout-w)+40px)]',
        side === 'right' ? 'right-(--hud-gutter)' : 'left-(--hud-gutter)',
      )}
    >
      <header className="flex items-start gap-2 border-b border-line-1 px-(--panel-pad) py-3">
        <BranchIcon branch={id} colored className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h2 className="t-title">{title}</h2>
          <p className="t-meta">{fmtDate(cursor, lang)}</p>
        </div>
        <IconButton label={t('hud.focus.close')} icon={<X />} size="sm" onClick={() => setFocus(null)} />
      </header>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-(--panel-pad) pb-4">
        <div className="flex flex-col gap-3 pt-3">
          <div className="flex items-baseline gap-2">
            <span className={cn('t-value text-3xl', r.status === 'ground-truth' && 'rounded-xs bg-signal px-1.5 text-on-signal', r.status === 'stale' && 'text-ink-3')}>{r.value ?? '--'}</span>
            <span className="t-unit">{r.unit}</span>
            {r.estimate && <s className="t-meta">{r.estimate}</s>}
            {r.status && r.status !== 'nominal' && <StatusTag status={r.status} className="ml-auto self-center" />}
          </div>
          <p className="t-caption -mt-2">{r.delta}</p>

          <Section title={t('hud.focus.confidence')}>
            <ConfidenceBadge badge={r.badge} variant="full" footnote={r.ageDays != null ? t('hud.focus.held', { n: r.ageDays }) : undefined} />
          </Section>

          {branch.series.length > 0 && (
            <Section title={t('hud.focus.series')}>
              <div className="flex flex-col gap-3">
                {branch.series.map((s) => (
                  <SeriesRow key={s.key} series={s} branch={id} />
                ))}
              </div>
            </Section>
          )}

          {branch.events && branch.events.length > 0 && (
            <Section title={t('hud.focus.events')}>
              <ul className="flex flex-col gap-2">
                {branch.events.map((e) => (
                  <li key={e.id} className="flex flex-col">
                    <span className="text-sm text-ink-1">{pick(e.title, lang)}</span>
                    <span className="t-meta">
                      {fmtDate(e.start, lang, false)} – {fmtDate(e.end, lang, false)}
                    </span>
                    <span className="t-caption">{pick(e.detail, lang)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {branch.facts.length > 0 && (
            <Section title={t('hud.focus.facts')}>
              <dl>
                {branch.facts.map((f) => (
                  <KeyValue key={f.key} label={pick(f.label, lang)} numeric={typeof f.value === 'number'}>
                    {f.value == null ? '--' : typeof f.value === 'number' ? fmtNum(f.value, Number.isInteger(f.value) ? 0 : 1) : f.value}
                    {f.unit ? <span className="t-unit ml-1">{f.unit}</span> : null}
                    {f.uncertainty && <span className="t-meta ml-1">({fmtNum(f.uncertainty[0], 1)}–{fmtNum(f.uncertainty[1], 1)})</span>}
                  </KeyValue>
                ))}
              </dl>
            </Section>
          )}

          <Section title={t('hud.focus.legend')}>
            {paintSpec ? (
              <RampLegend metric={paintSpec.metric} mode={paintSpec.mode} min={paintSpec.domain[0]} max={paintSpec.domain[1]} unit={primary ? unitFor(primary.unit, primary.key) : undefined} label={primary ? pick(primary.label, lang) : undefined} value={paint?.value ?? null} />
            ) : (
              <p className="t-caption">{t('hud.focus.noPaint')}</p>
            )}
          </Section>

          <Section title={t('hud.focus.sources')}>
            {sources.map((s) => (
              <div key={s.id} className="flex flex-col gap-0.5">
                <span className="text-sm text-ink-1">{s.name}</span>
                {s.resourceName && <span className="t-meta">{s.resourceName}</span>}
                <dl>
                  <KeyValue label={t('hud.src.agency')}>{s.agency}</KeyValue>
                  <KeyValue label={t('hud.src.pixel')} numeric>{fmtRes(s.resolutionM) ?? '--'}</KeyValue>
                  <KeyValue label={t('hud.src.revisit')} numeric>{days(s.cadenceDays)}</KeyValue>
                  <KeyValue label={t('hud.src.latency')} numeric>{s.latencyDays == null ? '--' : t('hud.src.days', { n: s.latencyDays })}</KeyValue>
                  <KeyValue label={t('hud.src.access')}>{s.access}</KeyValue>
                </dl>
                <ProvenanceTag provenance={telemetry.mode === 'mock' ? 'simulated' : s.provenance} source={s.name} />
              </div>
            ))}
          </Section>

          {(branch.notes?.length ?? 0) > 0 && (
            <Section title={t('hud.focus.caveats')}>
              <ul className="flex list-none flex-col gap-1.5">
                {branch.notes!.map((n, i) => (
                  <li key={i} className="t-body text-ink-2">
                    {pick(n, lang)}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
