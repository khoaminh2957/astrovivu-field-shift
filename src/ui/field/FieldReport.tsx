/**
 * Field report: relative vegetation zones of the field from one year of Sentinel-2 NDVI, the share
 * of the field that keeps its zone, the frames used (toggle to recompute), and three pictures side
 * by side. Zones come from `computeFieldZones` in `@/core/zones`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { FieldRaster, ISODate, Parcel } from '@/contracts';
import { computeFieldZones } from '@/core/zones';
import { useLang, useT } from '@/i18n';
import type { RampColor } from '@/lib/raster';
import { useMission } from '@/state/mission';
import { RAMP_ZONES, cn } from '@/ui/design';
import { fmtDate, fmtNum } from '@/ui/hud/format';
import { FrameCanvas, LiveFieldCanvas } from './FieldCanvas';
import { drawFieldPicture, rasterFor } from './picture';
import { SatelliteCanvas } from './SatelliteCanvas';
import './strings';

/** Low, medium and high zone in the blue ramp of the design tokens, light to strong. */
const [LOW, MEDIUM, HIGH] = RAMP_ZONES.stops;
export const ZONE_HEX = { low: LOW, medium: MEDIUM, high: HIGH } as const;
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ZONE_RGB = [rgb(LOW), rgb(MEDIUM), rgb(HIGH)];
const zoneColor: RampColor = (p) => ZONE_RGB[p < 0.34 ? 0 : p < 0.67 ? 1 : 2];

function ZonesCanvas({ parcel, raster, className, pad = 10 }: { parcel: Parcel; raster: FieldRaster; className?: string; pad?: number }) {
  const [el, setEl] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = Math.max(1, Math.round(el.clientWidth * dpr));
      el.height = Math.max(1, Math.round(el.clientHeight * dpr));
      const t = raster.frames[0]?.t;
      if (t) drawFieldPicture(el, { parcel, raster, t, blend: false, pad, color: zoneColor, outline: false });
    };
    // The tile stretches with its row, so the canvas is redrawn when its box changes.
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    draw();
    return () => ro.disconnect();
  }, [el, parcel, raster, pad]);
  return <canvas ref={setEl} aria-hidden className={cn('block h-full w-full', className)} />;
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="relative aspect-square min-w-0 overflow-hidden rounded-sm bg-tile">
      {children}
      <figcaption className="absolute top-2 right-2 left-2.5 truncate text-xs font-medium text-white">{title}</figcaption>
    </figure>
  );
}

/** A dark figure card: one large number, its name, one sentence; optionally a share drawn as a bar. */
function DarkStat({ value, title, note, share, accent }: { value: React.ReactNode; title: string; note: string; share?: number | null; accent?: boolean }) {
  return (
    <div className="flex min-w-0 gap-2 rounded-lg bg-ink-1 p-4 text-white">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className={cn('t-value text-[32px] leading-none', accent && 'text-signal-bright')}>{value}</span>
        <span className="text-base leading-5 font-medium">{title}</span>
        <span className="mt-auto pt-1 text-xs leading-[17px] text-[#b9b9bd]">{note}</span>
      </div>
      {share != null && (
        <span aria-hidden className="relative w-2 shrink-0 overflow-hidden rounded-sm bg-signal-bright/30">
          <span className="absolute inset-x-0 bottom-0 bg-signal" style={{ height: `${Math.max(0, Math.min(100, share))}%` }} />
        </span>
      )}
    </div>
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
      <section className="flex flex-col gap-2">
        {waiting ? (
          <div className="grid grid-cols-2 gap-2">
            <span className="skeleton aspect-square rounded-sm" />
            <span className="skeleton aspect-square rounded-sm" />
          </div>
        ) : !result ? (
          <p className="t-caption">{t('field.report.noNdvi')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 narrow:grid-cols-1">
            <figure className="relative min-h-72 overflow-hidden rounded-sm bg-tile narrow:aspect-square">
              <SatelliteCanvas parcel={parcel} pad={28} className="absolute inset-0" />
              <ZonesCanvas parcel={parcel} raster={result.raster} pad={28} className="absolute inset-0 opacity-90" />
              <figcaption className="absolute top-4 left-4 text-md leading-6 font-medium text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)]">{t('field.report.zones')}</figcaption>
              <span className="absolute bottom-2 left-3 flex flex-col gap-0.5 text-[11px] leading-[14px] text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.7)] narrow:text-xs">
                {(['high', 'medium', 'low'] as const).map((z) => (
                  <span key={z} className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ background: ZONE_HEX[z] }} />
                    {t(`field.report.z.${z}`)}
                  </span>
                ))}
              </span>
            </figure>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <DarkStat
                  accent
                  value={result.stableSharePct == null ? '--' : `${fmtNum(result.stableSharePct, 0)}%`}
                  share={result.stableSharePct}
                  title={t('field.report.stableShort')}
                  note={t('field.report.stableNote')}
                />
                <DarkStat
                  value={
                    <>
                      {result.framesUsed.length}
                      <span className="text-ink-3">/{frames.length}</span>
                    </>
                  }
                  title={t('field.report.usedShort')}
                  note={t('field.report.usedNote')}
                />
              </div>
              <section className="flex flex-1 flex-col gap-1 rounded-lg border border-line-1 px-4 pt-3 pb-1">
                <h4 className="text-md leading-6 font-medium text-ink-1">{t('field.report.dist')}</h4>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left font-medium text-ink-3">
                      <th className="py-1.5 font-medium">{t('field.report.zone')}</th>
                      <th className="py-1.5 font-medium">{t('field.report.area')}</th>
                      <th className="py-1.5 text-right font-medium">{t('field.report.dev')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.zones].reverse().map((z) => (
                      <tr key={z.id} className="border-t border-line-1">
                        <td className="py-2 text-base font-medium text-ink-1">
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: ZONE_HEX[z.id] }} />
                            {t(`field.report.z.${z.id}`)}
                          </span>
                        </td>
                        <td className="t-value py-2 font-normal text-ink-1">
                          {fmtNum(z.areaHa, z.areaHa < 10 ? 2 : 1)} ha, {fmtNum(z.sharePct, 1)}%
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={cn(
                              't-value inline-block min-w-14 rounded-[5px] px-2 py-1.5 text-center text-base',
                              z.deviationPct > 2 ? 'bg-nominal/12 text-nominal' : z.deviationPct < -2 ? 'bg-alert/10 text-alert' : 'bg-watch/12 text-watch',
                            )}
                          >
                            {z.deviationPct > 0 ? '+' : ''}
                            {fmtNum(z.deviationPct, 0)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </div>
        )}
        <p className="t-caption">{t('field.report.note')}</p>
      </section>

      {ndvi && frames.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="workspace-card-title">{t('field.report.images', { n: frames.length })}</h3>
            <p className="t-caption">{t('field.report.imagesNote')}</p>
          </div>
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
                    className={cn('relative flex w-full flex-col rounded-sm bg-surface-2 p-2 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3', !on && 'opacity-60')}
                  >
                    <span className="t-value text-xs font-normal text-ink-2">{fmtDate(f.t, lang)}</span>
                    <span className="block aspect-[4/3]">
                      <FrameCanvas parcel={parcel} raster={ndvi} t={f.t} />
                    </span>
                    <span className={cn('absolute top-2 right-2 flex size-4 items-center justify-center rounded-full', on ? 'bg-signal text-on-signal' : 'border border-line-3 bg-surface-0')}>
                      {on && <Check size={11} strokeWidth={2.5} aria-hidden />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {frames.length > 6 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="self-start text-xs font-medium text-signal-strong hover:underline narrow:min-h-11 narrow:text-base">
              {showAll ? t('field.report.less') : t('field.report.more', { n: frames.length - 6 })}
            </button>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="workspace-card-title">{t('field.report.maps')}</h3>
        <div className="grid grid-cols-3 gap-2">
          <Tile title={t('field.report.zones')}>{result ? <ZonesCanvas parcel={parcel} raster={result.raster} pad={30} /> : <span className="skeleton absolute inset-8 opacity-20" />}</Tile>
          <Tile title={t('field.report.moisture')}>
            <LiveFieldCanvas branch="soilMoisture" pad={30} />
          </Tile>
          <Tile title={t('field.report.elevation')}>
            <LiveFieldCanvas branch="terrain" pad={30} />
          </Tile>
        </div>
      </section>
    </div>
  );
}
