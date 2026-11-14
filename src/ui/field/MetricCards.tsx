/**
 * The eight metric cards. Each shows the field itself: the parcel's shape filled with the branch's
 * within-field raster at the cursor date (or one colour when the source is coarser than the field),
 * its headline value, a hairline sparkline and where the number comes from. Selecting a card paints
 * the same picture on the map and opens its detail.
 */
import { memo } from 'react';
import { BRANCHES, type BranchId, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES, primarySeries } from '@/lib/series';
import { useMission } from '@/state/mission';
import { BranchIcon, cn } from '@/ui/design';
import { fmtRes } from '@/ui/hud/format';
import { readBranch } from '@/ui/hud/readings';
import '@/ui/hud/strings';
import { LiveFieldCanvas } from './FieldCanvas';
import { RASTER_BRANCHES, frameShown, rampGradient, rasterFor } from './picture';
import { fmtDate } from '@/ui/hud/format';
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
  const frameDate = useMission((s) => frameShown(rasterFor(s.rasters, id), s.timeline.cursor)?.date);

  const branch = telemetry?.branches[id];
  const title = pick(branch?.title ?? BRANCH_TITLES[id], lang);
  const loading = status === 'loading' || status === 'idle' || (!branch && status !== 'error');
  const unavailable = !loading && (status === 'error' || branch?.status === 'unavailable');
  const r = !loading && branch && telemetry && parcel ? readBranch({ telemetry, branch, cursor, parcel, insights, groundTruth, lang, t }) : null;

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => select(active ? null : id)}
      className={cn(
        'group flex min-w-0 flex-col gap-2 rounded-lg border bg-surface-2 p-3 text-left transition-colors duration-(--dur-fast)',
        active ? 'border-signal' : 'border-transparent hover:bg-surface-3',
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1 text-xs text-ink-3">
          <BranchIcon branch={id} size={12} />
          {fmtDate(frameDate ?? cursor, lang)}
        </span>
        <span className="truncate text-sm font-semibold text-ink-1">{title}</span>
      </span>
      <span className="relative block aspect-square overflow-hidden">
        {unavailable ? null : pic === 'loading' || loading ? <span className="skeleton absolute inset-4 opacity-30" aria-hidden /> : <LiveFieldCanvas branch={id} pad={14} />}
      </span>
      {unavailable ? null : ramp ? <span aria-hidden className="h-1.5 rounded-full" style={{ background: rampGradient(ramp) }} /> : <span className="t-caption truncate">{caption}</span>}
      {unavailable ? (
        <span className="t-caption">{t('field.unavailable')}</span>
      ) : loading ? (
        <span className="skeleton h-6 w-20" />
      ) : (
        <span className="flex min-w-0 items-baseline gap-1">
          <span className={cn('t-value text-xl leading-6 text-ink-1', r?.status === 'stale' && 'text-ink-3')}>{r?.value ?? '--'}</span>
          <span className="t-unit truncate">{r?.unit}</span>
        </span>
      )}
    </button>
  );
});

/** Pictures from within-field rasters first, then the branches that are one value per field. */
const PICTURES: BranchId[] = ['vegetation', 'soilMoisture', 'thermal', 'terrain'];
const VALUES: BranchId[] = BRANCHES.filter((b) => !PICTURES.includes(b));

export function MetricGrid({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {(
        [
          ['field.data.pictures', PICTURES],
          ['field.data.values', VALUES],
        ] as const
      ).map(([key, ids]) => (
        <section key={key} className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold text-ink-1">{t(key)}</h3>
          <div className="grid grid-cols-2 gap-3">
            {ids.map((b) => (
              <MetricCard key={b} id={b} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
