/**
 * The eight metric cards. Each shows the field itself: the parcel's shape filled with the branch's
 * within-field raster at the cursor date (or one colour when the source is coarser than the field),
 * its headline value, a hairline sparkline and where the number comes from. Selecting a card paints
 * the same picture on the map and opens its detail.
 */
import { memo, useMemo } from 'react';
import { BRANCHES, type BranchId, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES, primarySeries } from '@/lib/series';
import { addDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { BranchIcon, ConfidenceBars, Sparkline, StatusGlyph, cn } from '@/ui/design';
import { fmtRes } from '@/ui/hud/format';
import { readBranch, riskHistory } from '@/ui/hud/readings';
import '@/ui/hud/strings';
import { LiveFieldCanvas } from './FieldCanvas';
import { RASTER_BRANCHES, rampGradient, rasterFor } from './picture';
import './strings';

/** Select a branch: focus it and paint the map with the same quantity as the card. */
export function useSelectBranch(): (id: BranchId | null) => void {
  const setFocusBranch = useMission((s) => s.setFocusBranch);
  const setParcelMetric = useMission((s) => s.setParcelMetric);
  return (id) => {
    setFocusBranch(id);
    if (!id) return;
    const s = useMission.getState();
    const raster = rasterFor(s.rasters, id);
    const b = s.telemetry?.branches[id];
    const key = raster?.key ?? (b ? primarySeries(b)?.key : undefined);
    if (key) setParcelMetric(key);
  };
}

/** What the picture area holds right now; changes only when rasters arrive, never per frame. */
export function usePictureState(id: BranchId): 'raster' | 'loading' | 'single' {
  return useMission((s) => {
    if (rasterFor(s.rasters, id)) return 'raster';
    if (s.rasterStatus === 'loading' && RASTER_BRANCHES.includes(id)) return 'loading';
    return 'single';
  });
}

/** Caption under the picture: the real pixel size behind it. */
export function usePictureCaption(id: BranchId): string {
  const t = useT();
  const cell = useMission((s) => rasterFor(s.rasters, id)?.cellM);
  const res = useMission((s) => {
    const b = s.telemetry?.branches[id];
    const src = b ? s.telemetry?.sources[primarySeries(b)?.sourceId ?? b.sources[0]] : undefined;
    return src?.resolutionM;
  });
  if (cell != null) return t('field.pic.raster', { r: fmtRes(cell) ?? '' });
  return res != null ? t('field.pic.single', { r: fmtRes(res) ?? '' }) : t('field.pic.singleNoRes');
}

const MetricCard = memo(function MetricCard({ id }: { id: BranchId }) {
  const t = useT();
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry);
  const status = useMission((s) => s.branchStatus[id]);
  const parcel = useMission((s) => s.parcel);
  const cursor = useMission((s) => s.timeline.cursor);
  const insights = useMission((s) => s.insights);
  const groundTruth = useMission((s) => s.groundTruth);
  const active = useMission((s) => s.focusBranch === id);
  const select = useSelectBranch();
  const pic = usePictureState(id);
  const caption = usePictureCaption(id);
  const ramp = useMission((s) => rasterFor(s.rasters, id)?.ramp);
  const riskPast = useMemo(() => (telemetry && id === 'risk' ? riskHistory(telemetry) : []), [telemetry, id]);

  const branch = telemetry?.branches[id];
  const title = pick(branch?.title ?? BRANCH_TITLES[id], lang);
  const loading = status === 'loading' || status === 'idle' || (!branch && status !== 'error');
  const r = !loading && branch && telemetry && parcel ? readBranch({ telemetry, branch, cursor, parcel, insights, groundTruth, lang, t }) : null;
  const series = r?.series;
  const forecast = id === 'risk';
  const from = telemetry ? (forecast ? addDays(telemetry.window.today, -45) : telemetry.window.start) : cursor;
  const end = telemetry ? (forecast ? (telemetry.window.forecastEnd ?? telemetry.window.today) : telemetry.window.end) : cursor;

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => select(active ? null : id)}
      className={cn(
        'group flex min-w-0 flex-col gap-2 rounded-md border bg-surface-0 p-2.5 text-left shadow-sm transition-colors duration-(--dur-fast)',
        active ? 'border-signal' : 'border-line-1 hover:border-line-2',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <BranchIcon branch={id} colored={active} size={14} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-1 [font-stretch:var(--stretch-semi)]">{title}</span>
        {r?.status && r.status !== 'nominal' && <StatusGlyph status={r.status} />}
      </span>

      <span className="relative block aspect-[4/3] overflow-hidden rounded-sm bg-ink-1">
        {pic === 'loading' || loading ? <span className="skeleton absolute inset-2 opacity-30" aria-hidden /> : <LiveFieldCanvas branch={id} pad={6} />}
      </span>
      {ramp && <span aria-hidden className="-mt-1 h-1 rounded-full" style={{ background: rampGradient(ramp) }} />}
      <span className="t-caption -mt-1 truncate">{pic === 'loading' ? t('field.pic.loading') : caption}</span>

      {loading ? (
        <span className="skeleton h-6 w-20" />
      ) : (
        <span className="flex min-w-0 items-baseline gap-1">
          <span className={cn('t-value text-xl leading-6', r?.status === 'ground-truth' && 'rounded-xs bg-signal px-1 text-on-signal', r?.status === 'stale' && 'text-ink-3')}>{r?.value ?? '--'}</span>
          <span className="t-unit truncate">{r?.unit}</span>
        </span>
      )}

      {series ? (
        <Sparkline
          samples={forecast ? riskPast : series.samples}
          forecast={forecast ? series.samples : undefined}
          domain={[from, end]}
          range={series.range}
          cadence={series.cadence}
          cursor={cursor >= from ? cursor : null}
          today={telemetry?.window.today}
          tone={active ? id : 'ink'}
          variant={series.key === 'rain' ? 'bars' : 'line'}
          provenance={telemetry?.mode === 'mock' ? 'simulated' : undefined}
          height={22}
          points={false}
          label={title}
          unit={series.unit}
        />
      ) : (
        <span className="t-caption line-clamp-2 min-h-[22px]">{r?.delta ?? ''}</span>
      )}

      <span className="flex min-w-0 items-center gap-1.5 text-ink-3">
        {r && <ConfidenceBars level={r.badge.level} />}
        <span className="t-meta min-w-0 truncate">{r ? [r.sourceName, r.ageDays != null ? t('field.age', { n: r.ageDays }) : null].filter(Boolean).join(' · ') : ''}</span>
      </span>
    </button>
  );
});

export function MetricGrid({ className }: { className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {BRANCHES.map((b) => (
        <MetricCard key={b} id={b} />
      ))}
    </div>
  );
}
