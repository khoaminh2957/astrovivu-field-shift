/**
 * Detail of the selected metric card: a larger field picture with its legend, the gallery of the
 * real frames by date (clicking one moves the timeline there), the series, facts, sources and the
 * reasons to trust the reading or not.
 */
import { type ReactNode, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { type BranchId, type Series, pick } from '@/contracts';
import { latencyDaysOf } from '@/data/sources';
import { paintForSeries, parcelReadingAt, rampCss } from '@/globe';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES, primarySeries, sampleAt } from '@/lib/series';
import { addDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { BranchIcon, Button, ConfidenceBadge, KeyValue, ProvenanceTag, Sparkline, StatusTag, cn } from '@/ui/design';
import { useMissionUi } from '@/ui/chrome/uiState';
import { digitsFor, fmtDate, fmtNum, fmtRes, unitFor } from '@/ui/hud/format';
import { readBranch } from '@/ui/hud/readings';
import '@/ui/hud/strings';
import { FrameCanvas, LiveFieldCanvas } from './FieldCanvas';
import { usePictureCaption, usePictureState } from './MetricCards';
import { frameShown, rampGradient, rasterFor } from './picture';
import './strings';

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line-1 pt-4">
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

/** Ramp, range, unit, and the date of the frame actually shown with its age. */
function PictureLegend({ id }: { id: BranchId }) {
  const t = useT();
  const lang = useLang();
  const cursor = useMission((s) => s.timeline.cursor);
  const raster = useMission((s) => rasterFor(s.rasters, id));
  const branch = useMission((s) => s.telemetry?.branches[id]);
  if (raster) {
    const shown = frameShown(raster, cursor);
    const d = raster.range[1] - raster.range[0] < 5 ? 2 : 0;
    return (
      <div className="flex flex-col gap-1">
        <span aria-hidden className="h-2 w-full rounded-xs border border-line-2" style={{ background: rampGradient(raster.ramp) }} />
        <span className="t-meta flex justify-between">
          <span>{fmtNum(raster.range[0], d)}</span>
          <span>{pick(raster.label, lang)}{raster.unit ? ` · ${raster.unit}` : ''}</span>
          <span>{fmtNum(raster.range[1], d)}</span>
        </span>
        {shown ? (
          <span className="t-caption">
            {t('field.frame.shown', { d: fmtDate(shown.date, lang) })}
            {shown.ageDays > 0 ? ` · ${t('field.frame.age', { n: shown.ageDays })}` : ''}
          </span>
        ) : (
          <span className="t-caption">{t('field.frame.none')}</span>
        )}
      </div>
    );
  }
  const primary = branch ? primarySeries(branch) : undefined;
  const paint = primary ? paintForSeries(primary) : null;
  const reading = primary ? parcelReadingAt(primary, cursor) : null;
  if (!paint || !primary) return <p className="t-caption">{t('field.legend.none')}</p>;
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden className="h-2 w-full rounded-xs border border-line-2" style={{ background: rampCss(paint) }} />
      <span className="t-meta flex justify-between">
        <span>{fmtNum(paint.domain[0], digitsFor(primary.unit, primary.key))}</span>
        <span>{unitFor(primary.unit, primary.key)}</span>
        <span>{fmtNum(paint.domain[1], digitsFor(primary.unit, primary.key))}</span>
      </span>
      <span className="t-caption">{reading?.value != null ? t('field.legend.single', { v: fmtNum(reading.value, digitsFor(primary.unit, primary.key)) }) : t('field.frame.none')}</span>
    </div>
  );
}

/** Gallery of the real frames by date, like a contact sheet; the frame in force is outlined. */
function Filmstrip({ id }: { id: BranchId }) {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const raster = useMission((s) => rasterFor(s.rasters, id));
  const shownDate = useMission((s) => frameShown(raster, s.timeline.cursor)?.date);
  const setCursor = useMission((s) => s.setCursor);
  const setPlaying = useMissionUi((s) => s.setPlaying);
  if (!raster || !parcel || raster.frames.length < 2) return null;
  return (
    <Section title={t('field.frames', { n: raster.frames.length })}>
      <ul className="grid grid-cols-4 gap-1.5 narrow:grid-cols-3">
        {raster.frames.map((f) => {
          const on = f.t === shownDate;
          return (
            <li key={f.t}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={t('field.frame.go', { d: fmtDate(f.t, lang) })}
                onClick={() => (setPlaying(false), setCursor(f.t))}
                className={cn('flex w-full flex-col gap-0.5 rounded-xs border p-1 text-left hover:border-ink-3', on ? 'border-signal bg-surface-2' : 'border-line-1')}
              >
                <span className="block aspect-square">
                  <FrameCanvas parcel={parcel} raster={raster} t={f.t} />
                </span>
                <span className="t-meta truncate text-center">{fmtDate(f.t, lang, false)}</span>
                {f.coverage < 0.6 && <span className="t-meta truncate text-center text-ink-3">{t('field.frame.cover', { p: Math.round(f.coverage * 100) })}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function CardDetail({ branch: id, onBack, backLabel }: { branch: BranchId; onBack?: () => void; backLabel?: string }) {
  const t = useT();
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry);
  const parcel = useMission((s) => s.parcel);
  const cursor = useMission((s) => s.timeline.cursor);
  const insights = useMission((s) => s.insights);
  const groundTruth = useMission((s) => s.groundTruth);
  const setFocus = useMission((s) => s.setFocusBranch);
  const pic = usePictureState(id);
  const caption = usePictureCaption(id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFocus]);

  const branch = telemetry?.branches[id];
  const title = pick(branch?.title ?? BRANCH_TITLES[id], lang);
  if (!telemetry || !parcel || !branch) return null;
  const r = readBranch({ telemetry, branch, cursor, parcel, insights, groundTruth, lang, t });
  const sources = branch.sources.map((sid) => telemetry.sources[sid]).filter(Boolean);
  const days = (n: number | null) => (n == null ? t('hud.src.static') : t('hud.src.days', { n }));

  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        {onBack && (
          <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack}>
            {backLabel ?? t('field.detail.back')}
          </Button>
        )}
        <BranchIcon branch={id} colored size={18} className="ml-auto" />
        <h2 className="t-title truncate">{title}</h2>
      </header>

      <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-ink-1">
        {pic === 'loading' ? <span className="skeleton absolute inset-3" aria-hidden /> : <LiveFieldCanvas branch={id} pad={14} />}
      </div>
      <p className="t-caption -mt-2">{pic === 'loading' ? t('field.pic.loading') : caption}</p>
      <PictureLegend id={id} />

      <div className="flex items-baseline gap-2">
        <span className={cn('t-value text-3xl', r.status === 'ground-truth' && 'rounded-xs bg-signal px-1.5 text-on-signal', r.status === 'stale' && 'text-ink-3')}>{r.value ?? '--'}</span>
        <span className="t-unit">{r.unit}</span>
        {r.estimate && <s className="t-meta">{r.estimate}</s>}
        {r.status && r.status !== 'nominal' && <StatusTag status={r.status} className="ml-auto self-center" />}
      </div>
      <p className="t-caption -mt-3">{r.delta}</p>

      <Filmstrip id={id} />

      <Section title={t('hud.focus.confidence')}>
        <ConfidenceBadge badge={r.badge} variant="full" footnote={r.ageDays != null ? t('hud.focus.held', { n: r.ageDays }) : undefined} />
      </Section>

      {branch.series.length > 0 && (
        <Section title={t('hud.focus.series')}>
          <div className="flex flex-col gap-4">
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
              </KeyValue>
            ))}
          </dl>
        </Section>
      )}

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
    </section>
  );
}
