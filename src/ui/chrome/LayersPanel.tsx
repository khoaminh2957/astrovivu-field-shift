import { Layers, X } from 'lucide-react';
import { type OverlayId, pick } from '@/contracts';
import { OVERLAYS, getOverlay, overlayLegendCss, useGlobeStatus } from '@/globe';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { IconButton, Slider, StatusTag, Toggle, cn } from '@/ui/design';
import { fmtDate, fmtNum, fmtRes } from '@/ui/hud/format';
import './strings';

/** What the overlay on the map really is: its date after snapping, its age, or why there is none. */
function OverlayState() {
  const t = useT();
  const lang = useLang();
  const status = useGlobeStatus((s) => s.overlay);
  if (status.state === 'off') return null;
  if (status.state === 'loading') return <span className="t-meta">{t('map.layers.loading')}</span>;
  if (status.state === 'no-data' || !status.date) return <StatusTag status="stale" label={t('map.layers.noData')} />;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="t-value text-xs text-ink-1">{t('map.layers.date', { d: fmtDate(status.date, lang) })}</span>
      {status.ageDays != null && status.ageDays > 0 && <span className="t-meta">{t('map.layers.age', { n: status.ageDays })}</span>}
      {status.stale && <StatusTag status="stale" label={t('map.layers.stale')} />}
    </span>
  );
}

function Legend({ id }: { id: OverlayId }) {
  const t = useT();
  const lang = useLang();
  const o = getOverlay(id);
  const css = overlayLegendCss(o);
  return (
    <div className="flex flex-col gap-1.5">
      {css && o.legend && (
        <div className="flex flex-col gap-0.5">
          <span aria-hidden className="h-2 w-full rounded-xs border border-line-2" style={{ background: css }} />
          <span className="t-meta flex justify-between">
            <span>{fmtNum(o.legend.min, o.legend.min % 1 ? 1 : 0)}</span>
            <span>{o.legend.unit}</span>
            <span>{fmtNum(o.legend.max, o.legend.max % 1 ? 1 : 0)}</span>
          </span>
        </div>
      )}
      <p className="t-caption">{pick(o.note, lang)}</p>
      <OverlayState />
      {o.resolutionM != null && <span className="t-meta">{t('map.layers.res', { r: fmtRes(o.resolutionM) ?? '' })} · {o.cadence}</span>}
    </div>
  );
}

/** Base map switches and one NASA GIBS overlay at a time, with its legend, opacity and the date really shown. */
export function LayersPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const layers = useMission((s) => s.layers);
  const setBaseLayer = useMission((s) => s.setBaseLayer);
  const setOverlay = useMission((s) => s.setOverlay);
  const setOverlayOpacity = useMission((s) => s.setOverlayOpacity);
  return (
    <aside
      aria-label={t('map.layers.title')}
      className="plate-raised flex max-h-[min(560px,calc(100dvh-120px))] w-72 flex-col shadow-lg narrow:max-h-[calc(var(--map-h)-24px)] narrow:w-64"
    >
      <header className="flex items-center gap-2 border-b border-line-1 py-2 pr-2 pl-3">
        <Layers size={16} strokeWidth={1.5} aria-hidden className="text-ink-3" />
        <h2 className="t-heading flex-1">{t('map.layers.title')}</h2>
        <IconButton label={t('map.layers.hideAria')} icon={<X />} size="sm" onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        <section className="flex flex-col gap-1.5">
          <h3 className="t-label">{t('map.layers.base')}</h3>
          <Toggle trailing label={t('map.layers.satellite')} checked={layers.base.satellite} onCheckedChange={(v) => setBaseLayer('satellite', v)} />
          <Toggle trailing label={t('map.layers.terrain')} checked={layers.base.terrain} onCheckedChange={(v) => setBaseLayer('terrain', v)} />
          <Toggle trailing label={t('map.layers.labels')} checked={layers.base.labels} onCheckedChange={(v) => setBaseLayer('labels', v)} />
        </section>
        <section className="flex flex-col gap-1.5 border-t border-line-1 pt-3">
          <h3 className="t-label" id="overlay-label">
            {t('map.layers.overlay')}
          </h3>
          <div role="radiogroup" aria-labelledby="overlay-label" className="flex flex-col">
            {OVERLAYS.map((o) => {
              const on = layers.overlay === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setOverlay(o.id)}
                  className={cn('flex min-h-8 items-center gap-2 rounded-xs px-1.5 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink-1', on && 'text-ink-1')}
                >
                  <span aria-hidden className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border', on ? 'border-signal' : 'border-ink-4')}>
                    {on && <span className="size-1.5 rounded-full bg-signal" />}
                  </span>
                  <span className="min-w-0 flex-1">{pick(o.label, lang)}</span>
                </button>
              );
            })}
          </div>
          {layers.overlay !== 'none' && (
            <div className="flex flex-col gap-2 border-t border-line-1 pt-2">
              <Legend id={layers.overlay} />
              <div className="flex flex-col gap-1">
                <span className="t-label flex justify-between">
                  {t('map.layers.opacity')}
                  <span className="t-value text-xs text-ink-2">{Math.round(layers.overlayOpacity * 100)} %</span>
                </span>
                <Slider ariaLabel={t('map.layers.opacity')} value={Math.round(layers.overlayOpacity * 100)} min={0} max={100} step={5} fill onValueChange={(v) => setOverlayOpacity(v / 100)} formatValue={(v) => `${v} %`} />
              </div>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
