/**
 * What floats on the map, drawn the way the reference product draws it: dark pills with white
 * icons (#1c1c1e, 40 px, fully rounded, one soft shadow).
 *   MapToolbar    the tool stack on the map's right edge, centred vertically; buttons that belong
 *                 together are joined into one pill (zoom in and out, as in the reference).
 *                 Narrow screens keep zoom, fit and layers. Popovers open to the left of the stack.
 *   MapLayerPill  top-left: what the field is coloured by (a metric selector) and the frame date.
 *   MapLegend     bottom-left: the ramp and range of that colouring with the scale switch, under a
 *                 "Hide legend / Show legend" text button.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { Box, Compass, Expand, Focus, Gauge, Layers, LoaderCircle, LocateFixed, Minimize, Minus, Plus, Ruler, SlidersHorizontal, SquareDashed, X } from 'lucide-react';
import { BRANCHES, type BranchId, pick } from '@/contracts';
import {
  fitParcel,
  isFieldRange,
  locateMe,
  rasterRampCss,
  resetNorth,
  setMotion,
  setTilt,
  startMeasure,
  stopMeasure,
  useMapView,
  useMeasure,
  useParcelPaint,
  zoomBy,
} from '@/globe';
import { useLang, useT } from '@/i18n';
import { displayRange } from '@/lib/raster';
import { BRANCH_TITLES } from '@/lib/series';
import { useMission } from '@/state/mission';
import { Button, Select, Tooltip, cn } from '@/ui/design';
import { useSelectBranch } from '@/ui/field/MetricCards';
import { fmtDate, fmtNum } from '@/ui/hud/format';
import { LayersPanel } from './LayersPanel';
import { WeatherChip } from './Weather';
import { useMissionUi, useNarrow } from './uiState';
import './strings';

/** The dark surface every map control shares. */
const DARK = 'bg-ink-1 text-white shadow-map';

/** Buttons that belong together, joined into one pill. */
function Group({ children }: { children: ReactNode }) {
  return <div className={cn('flex flex-col overflow-hidden rounded-[20px]', DARK)}>{children}</div>;
}

function MapButton({ label, icon, pressed, loading, onClick }: { label: string; icon: ReactNode; pressed?: boolean; loading?: boolean; onClick: () => void }) {
  return (
    <Tooltip content={label} side="left">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-busy={loading || undefined}
        disabled={loading}
        onClick={onClick}
        className={cn(
          'flex size-10 items-center justify-center -outline-offset-2 transition-colors duration-(--dur-instant) hover:bg-black/90 narrow:size-11 [&_svg]:size-5 [&_svg]:stroke-[1.5]',
          pressed && 'text-signal-bright',
        )}
      >
        {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      </button>
    </Tooltip>
  );
}

function MeasureReadout() {
  const t = useT();
  const m = useMeasure();
  const setPopover = useMissionUi((s) => s.setMapPopover);
  useEffect(() => {
    if (!m.kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopMeasure();
        setPopover(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m.kind, setPopover]);
  if (!m.kind) return null;
  const value = m.value == null ? '--' : m.kind === 'area' ? `${fmtNum(m.value, m.value < 10 ? 2 : 1)} ha` : m.value >= 1000 ? `${fmtNum(m.value / 1000, 2)} km` : `${fmtNum(m.value, 0)} m`;
  return (
    <div role="status" className="plate-raised flex w-60 flex-col gap-1 p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="t-heading flex-1">{t(m.kind === 'area' ? 'map.measure.area' : 'map.measure.distance')}</span>
        <Button size="sm" variant="secondary" icon={<X />} onClick={() => (stopMeasure(), setPopover(null))}>
          {t('map.measure.stopShort')}
        </Button>
      </div>
      <span className="t-value text-xl text-ink-1">{value}</span>
      <span className="t-caption">{t('map.measure.howto')}</span>
    </div>
  );
}

function useFullscreen(): [boolean, () => void] {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  return [on, toggle];
}

export function MapToolbar({ className, workspace = false }: { className?: string; workspace?: boolean }) {
  const t = useT();
  const narrow = useNarrow();
  const view = useMapView();
  const measure = useMeasure();
  const popover = useMissionUi((s) => s.mapPopover);
  const setPopover = useMissionUi((s) => s.setMapPopover);
  const [fs, toggleFs] = useFullscreen();
  const [locating, setLocating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const legendOpen = useMissionUi((s) => s.legendOpen);
  const setLegendOpen = useMissionUi((s) => s.setLegendOpen);

  const measureBtn = (kind: 'distance' | 'area') => {
    if (measure.kind === kind) {
      stopMeasure();
      setPopover(null);
    } else {
      startMeasure(kind);
      setPopover('measure');
    }
  };
  const locate = () => {
    setLocating(true);
    void locateMe().finally(() => setLocating(false));
  };
  const layersBtn = <MapButton label={t('map.layers')} icon={<Layers />} pressed={popover === 'layers'} onClick={() => setPopover(popover === 'layers' ? null : 'layers')} />;

  const stacks = (
    <div className={cn('pointer-events-none flex gap-2', workspace || narrow ? 'items-start' : 'items-center', workspace ? 'workspace-extra-tools' : className)}>
      <div className="pointer-events-auto">
        {popover === 'layers' && <LayersPanel onClose={() => setPopover(null)} />}
        {popover === 'measure' && <MeasureReadout />}
      </div>
      <div role="toolbar" aria-label={t('map.tools')} aria-orientation="vertical" className="pointer-events-auto flex flex-col gap-2.5">
        {narrow ? (
          <Group>{layersBtn}</Group>
        ) : (
          <>
            <Group>
              {layersBtn}
              <MapButton label={t('map.tilt')} icon={<Box />} pressed={view.tilted} onClick={() => setTilt(!view.tilted)} />
            </Group>
            <Group>
              <MapButton label={t('map.measure.distance')} icon={<Ruler />} pressed={measure.kind === 'distance'} onClick={() => measureBtn('distance')} />
              <MapButton label={t('map.measure.area')} icon={<SquareDashed />} pressed={measure.kind === 'area'} onClick={() => measureBtn('area')} />
            </Group>
          </>
        )}
        {!workspace && (
          <Group>
            <MapButton label={t('map.zoomIn')} icon={<Plus />} onClick={() => zoomBy(1)} />
            <MapButton label={t('map.zoomOut')} icon={<Minus />} onClick={() => zoomBy(-1)} />
          </Group>
        )}
        <Group>
          {!workspace && <MapButton label={t('map.fit')} icon={<Focus />} onClick={fitParcel} />}
          {!narrow && <MapButton label={t('map.locate')} icon={<LocateFixed />} loading={locating} onClick={locate} />}
          {workspace && <MapButton label={t(legendOpen ? 'map.legend.hide' : 'map.legend.show')} icon={<Layers />} pressed={legendOpen} onClick={() => setLegendOpen(!legendOpen)} />}
        </Group>
        {/* The compass shows the bearing and resets it. Turning is a gesture: two fingers on a touch screen, Alt + swipe on a touchpad. */}
        {!narrow && (
          <Group>
            <MapButton label={t('map.north', { b: Math.round(((view.bearing % 360) + 360) % 360) })} icon={<Compass style={{ transform: `rotate(${-view.bearing}deg)` }} />} onClick={resetNorth} />
          </Group>
        )}
        {!narrow && (
          <Group>
            <MapButton label={t(view.motion === 'full' ? 'map.motion.off' : 'map.motion.on')} icon={<Gauge />} pressed={view.motion === 'reduced'} onClick={() => setMotion(view.motion === 'full' ? 'reduced' : 'full')} />
            <MapButton label={t(fs ? 'map.fullscreen.exit' : 'map.fullscreen')} icon={fs ? <Minimize /> : <Expand />} onClick={toggleFs} />
          </Group>
        )}
      </div>
    </div>
  );
  if (!workspace) return stacks;
  return (
    <div className={className}>
      <button className="workspace-map-button" type="button" onClick={fitParcel}><Focus size={17} aria-hidden />{t('map.fitShort')}</button>
      <div className="workspace-zoom">
        <button type="button" aria-label={t('map.zoomIn')} onClick={() => zoomBy(1)}><Plus size={20} aria-hidden /></button>
        <button type="button" aria-label={t('map.zoomOut')} onClick={() => zoomBy(-1)}><Minus size={20} aria-hidden /></button>
      </div>
      <button className="workspace-map-button" type="button" aria-expanded={expanded} onClick={() => { if (expanded) setPopover(null); setExpanded(!expanded); }}>
        <SlidersHorizontal size={17} aria-hidden />{t('map.tools')}
      </button>
      {expanded && <>{stacks}<WeatherChip className="pointer-events-none absolute top-full right-14" /></>}
    </div>
  );
}

/** Top-left of the map: the metric the field is coloured by (a selector) over the date of the frame shown. */
export function MapLayerPill({ className, workspace: _workspace = false }: { className?: string; workspace?: boolean }) {
  const t = useT();
  const lang = useLang();
  const paint = useParcelPaint();
  const focus = useMission((s) => s.focusBranch);
  const titles = useMission((s) => s.telemetry?.branches);
  const select = useSelectBranch();
  const branch: BranchId = focus ?? 'vegetation';
  const title = (b: BranchId) => pick(titles?.[b]?.title ?? BRANCH_TITLES[b], lang);
  const what = paint ? (paint.label ? pick(paint.label, lang).split(',')[0] : paint.unit || paint.key) : null;
  return (
    <Select<BranchId>
      ariaLabel={t('map.painted')}
      value={branch}
      onValueChange={select}
      options={BRANCHES.map((b) => ({ value: b, label: title(b) }))}
      triggerIcon={<Layers size={20} strokeWidth={1.5} aria-hidden className="shrink-0" />}
      caption={[what, paint?.date ? fmtDate(paint.date, lang) : null].filter(Boolean).join(' · ') || '--'}
      className={cn('workspace-theme workspace-layer-control', className)}
      contentClassName="workspace-theme workspace-layer-menu"
    />
  );
}

/** "Field range / Fixed scale" on a dark surface: the chosen one is a white tile. */
function DarkStretchToggle() {
  const t = useT();
  const stretch = useMission((s) => s.layers.stretch ?? 'field');
  const setStretch = useMission((s) => s.setStretch);
  return (
    <div role="radiogroup" aria-label={t('field.scale.label')} className="flex gap-0.5 self-start rounded-sm bg-[#3a3a3c] p-0.5">
      {(['field', 'fixed'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={stretch === v}
          onClick={() => setStretch(v)}
          className={cn('h-6 rounded-[6px] px-2 text-xs font-medium whitespace-nowrap narrow:h-9', stretch === v ? 'bg-white text-ink-1' : 'text-white/75 hover:text-white')}
        >
          {t(`field.scale.${v}`)}
        </button>
      ))}
    </div>
  );
}

/** Bottom-left of the map: the legend of what the field is painted with, and the button that hides it. */
export function MapLegend({ className, workspace = false }: { className?: string; workspace?: boolean }) {
  const t = useT();
  const lang = useLang();
  const paint = useParcelPaint();
  const open = useMissionUi((s) => s.legendOpen);
  const setOpen = useMissionUi((s) => s.setLegendOpen);
  const raster = useMission((s) => (paint?.source === 'raster' ? s.rasters.find((r) => r.key === paint.key) : undefined));
  const polygon = useMission((s) => s.parcel?.polygon);
  const stretch = useMission((s) => s.layers.stretch);
  if (!paint) return null;
  // The map paints rasters on the same scale as the cards; the legend follows it.
  const range = raster ? displayRange(raster, polygon, stretch) : paint.range;
  const d = range[1] - range[0] < 5 ? 2 : 0;
  const title = paint.label ? pick(paint.label, lang).split(',')[0] : paint.key;
  return (
    <div className={cn('flex shrink-0 flex-col items-start gap-1', className)}>
      {open && (
        <div className={cn('flex w-52 flex-col gap-1.5 rounded-lg px-3 py-2.5', DARK, workspace && 'workspace-legend-card')}>
          <span className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium">{title}</span>
            {paint.date && <span className="t-value shrink-0 font-normal text-ink-4">{fmtDate(paint.date, lang)}</span>}
          </span>
          {/* The bar is the ramp the map is painted with: the field-range ramp when the scale is stretched to this field. */}
          <span aria-hidden className="h-1.5 rounded-full" style={{ background: raster ? rasterRampCss(raster.ramp, isFieldRange(raster, range)) : paint.rampCss }} />
          <span className="t-value flex justify-between text-xs font-normal text-[#b9b9bd]">
            <span>{fmtNum(range[0], d)}</span>
            {/* An index is its own unit: do not print NDVI under a title that already says NDVI. */}
            <span>{title === paint.unit ? '' : paint.unit}</span>
            <span>{fmtNum(range[1], d)}</span>
          </span>
          {raster && raster.frames.length > 1 && <DarkStretchToggle />}
        </div>
      )}
      {!workspace && <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium whitespace-nowrap text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)] hover:bg-black/40 narrow:h-11"
      >
        <Layers size={16} strokeWidth={1.5} aria-hidden />
        {t(open ? 'map.legend.hide' : 'map.legend.show')}
      </button>}
    </div>
  );
}
