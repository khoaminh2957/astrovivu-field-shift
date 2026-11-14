/**
 * Field report: relative vegetation zones of the field from one year of Sentinel-2 NDVI, the share
 * of the field that keeps its zone, the frames used (toggle to recompute), and three pictures side
 * by side. Zones come from `computeFieldZones` in `@/core/zones`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { FieldRaster, ISODate, Parcel } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { cn } from '@/ui/design';
import { fmtDate, fmtNum } from '@/ui/hud/format';
import { drawFieldPicture, rasterFor } from './picture';
import type { RampColor } from '@/lib/raster';
import { computeFieldZones } from '@/core/zones';
import { FrameCanvas, LiveFieldCanvas } from './FieldCanvas';
import './strings';

export const ZONE_HEX = { low: '#d7301f', medium: '#f2c12e', high: '#1a9850' } as const;
const zoneColor: RampColor = (p) => (p < 0.34 ? [215, 48, 31] : p < 0.67 ? [242, 193, 46] : [26, 152, 80]);

function ZonesCanvas({ parcel, raster, className }: { parcel: Parcel; raster: FieldRaster; className?: string }) {
  const [el, setEl] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.max(1, Math.round(el.clientWidth * dpr));
    el.height = Math.max(1, Math.round(el.clientHeight * dpr));
    const t = raster.frames[0]?.t;
    if (t) drawFieldPicture(el, { parcel, raster, t, blend: false, pad: 10, color: zoneColor });
  }, [el, parcel, raster]);
  return <canvas ref={setEl} aria-hidden className={cn('block h-full w-full', className)} />;
}

function Tile({ title, children, legend }: { title: string; children: React.ReactNode; legend?: React.ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <span className="relative block aspect-square overflow-hidden rounded-sm bg-ink-1">{children}</span>
      <figcaption className="text-xs font-medium text-ink-1">{title}</figcaption>
      {legend}
    </figure>
  );
}

export function FieldReport() {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const ndvi = useMission((s) => rasterFor(s.rasters, 'vegetation'));
  const rasterStatus = useMission((s) => s.rasterStatus);
  const [picked, setPicked] = useState<Set<ISODate> | null>(null);
  const [showAll, setShowAll] = useState(false);
  const result = useMemo(() => {
    if (!ndvi || !parcel) return null;
    try {
      return computeFieldZones(ndvi, parcel, picked ? { frames: [...picked] } : {});
    } catch {
      return null;
    }
  }, [ndvi, parcel, picked]);
  const selected = picked ?? new Set(result?.framesUsed ?? []);

  if (!parcel) return null;
  const waiting = !ndvi && rasterStatus === 'loading';
  const toggle = (d: ISODate) => {
    const next = new Set(selected);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    if (next.size >= 2) setPicked(next);
  };
  const frames = ndvi?.frames ?? [];
  const shown = showAll ? frames : frames.slice(0, 6);

  return (
    <div className="flex flex-col gap-6">
      <p className="t-caption rounded-md bg-surface-2 p-3 text-ink-2">{t('field.report.note')}</p>

      <section className="flex flex-col gap-3">
        <h3 className="t-title text-lg">{t('field.report.zones')}</h3>
        {waiting ? (
          <div className="flex gap-3">
            <span className="skeleton aspect-square w-40 shrink-0 rounded-sm" />
            <span className="skeleton h-24 flex-1 rounded-sm" />
          </div>
        ) : !result ? (
          <p className="t-caption">{t('field.report.noNdvi')}</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-4 narrow:grid-cols-1">
            <span className="relative block aspect-square overflow-hidden rounded-sm bg-ink-1">
              <ZonesCanvas parcel={parcel} raster={result.raster} />
            </span>
            <table className="w-full self-start text-sm">
              <thead>
                <tr className="t-caption text-left">
                  <th className="pb-1 font-normal">{t('field.report.zone')}</th>
                  <th className="pb-1 text-right font-normal">ha</th>
                  <th className="pb-1 text-right font-normal">%</th>
                  <th className="pb-1 text-right font-normal">{t('field.report.dev')}</th>
                </tr>
              </thead>
              <tbody>
                {[...result.zones].reverse().map((z) => (
                  <tr key={z.id} className="border-t border-line-1">
                    <td className="py-1.5">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="size-3 rounded-xs" style={{ background: ZONE_HEX[z.id as keyof typeof ZONE_HEX] ?? '#8e8e93' }} />
                        {t(`field.report.z.${z.id}`)}
                      </span>
                    </td>
                    <td className="t-value py-1.5 text-right">{fmtNum(z.areaHa, z.areaHa < 10 ? 2 : 1)}</td>
                    <td className="t-value py-1.5 text-right">{fmtNum(z.sharePct, 0)}</td>
                    <td className="t-value py-1.5 text-right">{z.deviationPct > 0 ? '+' : ''}{fmtNum(z.deviationPct, 1)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {result && (
        <dl className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5 rounded-md border border-line-1 p-3">
            <dt className="t-caption">{t('field.report.stable')}</dt>
            <dd className="t-value text-xl text-ink-1">{result.stableSharePct == null ? '--' : `${result.stableSharePct == null ? '--' : `${fmtNum(result.stableSharePct, 0)} %`}`}</dd>
            <dd className="t-caption">{t('field.report.stableNote')}</dd>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-line-1 p-3">
            <dt className="t-caption">{t('field.report.used')}</dt>
            <dd className="t-value text-xl text-ink-1">{result.framesUsed.length}</dd>
            <dd className="t-caption">{t('field.report.usedNote')}</dd>
          </div>
        </dl>
      )}

      {ndvi && frames.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="t-title text-lg">{t('field.report.images', { n: frames.length })}</h3>
          <p className="t-caption -mt-2">{t('field.report.imagesNote')}</p>
          <ul className="grid grid-cols-3 gap-2">
            {shown.map((f) => {
              const on = selected.has(f.t);
              return (
                <li key={f.t}>
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={t('field.report.toggle', { d: fmtDate(f.t, lang) })}
                    onClick={() => toggle(f.t)}
                    className={cn('relative flex w-full flex-col gap-1 rounded-md border p-1.5 text-left', on ? 'border-signal' : 'border-line-1 opacity-70')}
                  >
                    <span className="block aspect-square overflow-hidden rounded-sm bg-ink-1">
                      <FrameCanvas parcel={parcel} raster={ndvi} t={f.t} />
                    </span>
                    <span className="t-meta text-center">{fmtDate(f.t, lang)}</span>
                    <span className={cn('absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full', on ? 'bg-signal text-on-signal' : 'border border-line-2 bg-surface-0')}>
                      {on && <Check size={12} aria-hidden />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {frames.length > 6 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="self-start text-sm font-medium text-signal hover:underline">
              {showAll ? t('field.report.less') : t('field.report.more', { n: frames.length - 6 })}
            </button>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="t-title text-lg">{t('field.report.maps')}</h3>
        <div className="grid grid-cols-3 gap-2">
          <Tile title={t('field.report.zones')}>{result ? <ZonesCanvas parcel={parcel} raster={result.raster} /> : <span className="skeleton absolute inset-3 opacity-30" />}</Tile>
          <Tile title={t('field.report.moisture')}>
            <LiveFieldCanvas branch="soilMoisture" pad={6} />
          </Tile>
          <Tile title={t('field.report.elevation')}>
            <LiveFieldCanvas branch="terrain" pad={6} />
          </Tile>
        </div>
      </section>
    </div>
  );
}
