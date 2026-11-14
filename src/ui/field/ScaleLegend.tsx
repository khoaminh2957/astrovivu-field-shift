/**
 * Legend of a field picture: ramp, the low and high values of the scale in use with the unit,
 * which scale is on (fixed, or stretched to this field), and the no-data swatch.
 */
import type { FieldRaster } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { displayRange } from '@/lib/raster';
import { useMission } from '@/state/mission';
import { Segmented, cn } from '@/ui/design';
import { fmtNum } from '@/ui/hud/format';
import { rampGradient } from './picture';
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

export function ScaleLegend({ raster, compact, className }: { raster: FieldRaster; compact?: boolean; className?: string }) {
  const t = useT();
  const lang = useLang();
  const polygon = useMission((s) => s.parcel?.polygon);
  const stretch = useMission((s) => s.layers.stretch);
  const range = displayRange(raster, polygon, stretch);
  const dated = raster.frames.length > 1;
  const fieldOn = dated && stretch !== 'fixed' && range !== raster.range;
  const d = range[1] - range[0] < 5 ? 2 : 0;
  const unit = raster.unit || pick(raster.label, lang).split(',')[0];
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span aria-hidden className="h-1.5 rounded-full" style={{ background: rampGradient(raster.ramp) }} />
      <span className="t-meta flex justify-between gap-2">
        <span>{fmtNum(range[0], d)}</span>
        <span className="truncate">{unit}</span>
        <span>{fmtNum(range[1], d)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="t-caption">{dated ? (fieldOn ? t('field.scale.fieldOn') : t('field.scale.fixedOn')) : t('field.scale.static')}</span>
        <span className="t-caption inline-flex items-center gap-1">
          <span aria-hidden className="inline-block size-2.5 rounded-xs border border-line-2 bg-[#3a3a3c]" />
          {t('field.scale.noData')}
        </span>
      </span>
      {dated && !compact && <StretchToggle className="self-start" />}
    </div>
  );
}
