/**
 * Legends of a field picture: the ramp, the low and high values of the scale in use with the unit,
 * which scale is on (fixed, or stretched to this field), and the no-data swatch.
 *   ScaleLegend  a horizontal bar with captions, under a picture on a light surface.
 *   TileLegend   a short vertical bar for the corner of a dark picture tile.
 */
import type { FieldRaster } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { displayRange } from '@/lib/raster';
import { useMission } from '@/state/mission';
import { Segmented, cn } from '@/ui/design';
import { fmtNum } from '@/ui/hud/format';
import { isRelative, rampGradient } from './picture';
import './strings';

export function StretchToggle({ className }: { className?: string }) {
  const t = useT();
  const stretch = useMission((s) => s.layers.stretch ?? 'field');
  const setStretch = useMission((s) => s.setStretch);
  return (
    <Segmented<'field' | 'fixed'>
      ariaLabel={t('field.scale.label')}
      size="sm"
      value={stretch}
      onValueChange={setStretch}
      className={className}
      options={[
        { value: 'field', label: t('field.scale.field') },
        { value: 'fixed', label: t('field.scale.fixed') },
      ]}
    />
  );
}

/** What a legend needs to say about a raster under the current scale choice. */
function useScale(raster: FieldRaster) {
  const lang = useLang();
  const polygon = useMission((s) => s.parcel?.polygon);
  const stretch = useMission((s) => s.layers.stretch);
  const range = displayRange(raster, polygon, stretch);
  const relative = isRelative(raster, range);
  const d = range[1] - range[0] < 5 ? 2 : 0;
  return {
    range,
    relative,
    dated: raster.frames.length > 1,
    lo: fmtNum(range[0], d),
    hi: fmtNum(range[1], d),
    unit: raster.unit || pick(raster.label, lang).split(',')[0],
  };
}

export function ScaleLegend({ raster, compact, className }: { raster: FieldRaster; compact?: boolean; className?: string }) {
  const t = useT();
  const s = useScale(raster);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span aria-hidden className="h-1.5 rounded-full" style={{ background: rampGradient(raster.ramp, s.relative) }} />
      <span className="t-meta flex justify-between gap-2">
        <span>{s.lo}</span>
        <span className="truncate">{s.unit}</span>
        <span>{s.hi}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="t-caption">{s.dated ? (s.relative ? t('field.scale.fieldOn') : t('field.scale.fixedOn')) : t('field.scale.static')}</span>
        <span className="t-caption inline-flex items-center gap-1">
          <span aria-hidden className="inline-block size-2.5 rounded-xs border border-line-2 bg-[#3a3a3c]" />
          {t('field.scale.noData')}
        </span>
      </span>
      {s.dated && !compact && <StretchToggle className="self-start" />}
    </div>
  );
}

/** Vertical legend in the corner of a dark tile: high at the top, the scale in use named under it. */
export function TileLegend({ raster, className }: { raster: FieldRaster; className?: string }) {
  const t = useT();
  const s = useScale(raster);
  const scale = s.dated ? (s.relative ? t('field.scale.field') : t('field.scale.fixed')) : t('field.scale.own');
  return (
    <div className={cn('flex flex-col gap-1.5 text-[11px] leading-[14px] text-[#b9b9bd] narrow:text-xs', className)} title={s.dated ? (s.relative ? t('field.scale.fieldOn') : t('field.scale.fixedOn')) : t('field.scale.static')}>
      <div className="flex items-stretch gap-2">
        <span aria-hidden className="w-2.5 rounded-full border border-ink-1" style={{ background: rampGradient(raster.ramp, s.relative, 'up') }} />
        <span className="t-value flex h-[74px] flex-col justify-between text-xs leading-3 font-normal text-white">
          <span>{s.hi}</span>
          <span>{s.lo}</span>
        </span>
      </div>
      <span className="max-w-40 truncate">
        {s.unit} · {scale}
      </span>
    </div>
  );
}
