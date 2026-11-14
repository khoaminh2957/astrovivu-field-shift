/**
 * Map tools on the map's right edge. Wide screens get the full set; narrow screens keep zoom, fit
 * and layers. Popovers (layers, measure) open to the left of the stack.
 */
import { useEffect, useState } from 'react';
import { Box, Compass, Expand, Focus, Gauge, Layers, LocateFixed, Minimize, Minus, Plus, Ruler, SquareDashed, X } from 'lucide-react';
import { fitParcel, locateMe, resetNorth, setMotion, setTilt, startMeasure, stopMeasure, useMapView, useMeasure, zoomBy } from '@/globe';
import { useT } from '@/i18n';
import { IconButton, cn } from '@/ui/design';
import { fmtNum } from '@/ui/hud/format';
import { LayersPanel } from './LayersPanel';
import { useMissionUi, useNarrow } from './uiState';
import './strings';

function Group({ children }: { children: React.ReactNode }) {
  return <div className="plate flex flex-col p-0.5 shadow-md">{children}</div>;
}

function MeasureReadout() {
  const t = useT();
  const m = useMeasure();
  const setPopover = useMissionUi((s) => s.setMapPopover);
  if (!m.kind) return null;
  const value = m.value == null ? '--' : m.kind === 'area' ? `${fmtNum(m.value, m.value < 10 ? 2 : 1)} ha` : m.value >= 1000 ? `${fmtNum(m.value / 1000, 2)} km` : `${fmtNum(m.value, 0)} m`;
  return (
    <div role="status" className="plate-raised flex w-60 flex-col gap-1 p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="t-heading flex-1">{t(m.kind === 'area' ? 'map.measure.area' : 'map.measure.distance')}</span>
        <IconButton label={t('map.measure.stop')} icon={<X />} size="sm" onClick={() => (stopMeasure(), setPopover(null))} />
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

export function MapToolbar({ className }: { className?: string }) {
  const t = useT();
  const narrow = useNarrow();
  const view = useMapView();
  const measure = useMeasure();
  const popover = useMissionUi((s) => s.mapPopover);
  const setPopover = useMissionUi((s) => s.setMapPopover);
  const [fs, toggleFs] = useFullscreen();
  const [locating, setLocating] = useState(false);
  const side = narrow ? 'left' : 'left';

  const measureBtn = (kind: 'distance' | 'area') => {
    if (measure.kind === kind) {
      stopMeasure();
      setPopover(null);
    } else {
      startMeasure(kind);
      setPopover('measure');
    }
  };

  return (
    <div className={cn('pointer-events-none flex items-start gap-2', className)}>
      <div className="pointer-events-auto">
        {popover === 'layers' && <LayersPanel onClose={() => setPopover(null)} />}
        {popover === 'measure' && <MeasureReadout />}
      </div>
      <div role="toolbar" aria-label={t('map.tools')} aria-orientation="vertical" className="pointer-events-auto flex flex-col gap-2">
        <Group>
          <IconButton label={t('map.zoomIn')} icon={<Plus />} size={narrow ? 'lg' : 'md'} tooltipSide={side} onClick={() => zoomBy(1)} />
          <IconButton label={t('map.zoomOut')} icon={<Minus />} size={narrow ? 'lg' : 'md'} tooltipSide={side} onClick={() => zoomBy(-1)} />
          {!narrow && (
            <IconButton
              label={t('map.north', { b: Math.round(((view.bearing % 360) + 360) % 360) })}
              icon={<Compass style={{ transform: `rotate(${-view.bearing}deg)` }} />}
              tooltipSide={side}
              onClick={resetNorth}
            />
          )}
          {!narrow && <IconButton label={t('map.tilt')} icon={<Box />} pressed={view.tilted} tooltipSide={side} onClick={() => setTilt(!view.tilted)} />}
        </Group>
        <Group>
          <IconButton label={t('map.fit')} icon={<Focus />} size={narrow ? 'lg' : 'md'} tooltipSide={side} onClick={fitParcel} />
          {!narrow && (
            <IconButton
              label={t('map.locate')}
              icon={<LocateFixed />}
              loading={locating}
              tooltipSide={side}
              onClick={() => {
                setLocating(true);
                void locateMe().finally(() => setLocating(false));
              }}
            />
          )}
          <IconButton label={t('map.layers')} icon={<Layers />} size={narrow ? 'lg' : 'md'} pressed={popover === 'layers'} tooltipSide={side} onClick={() => setPopover(popover === 'layers' ? null : 'layers')} />
        </Group>
        {!narrow && (
          <Group>
            <IconButton label={t('map.measure.distance')} icon={<Ruler />} pressed={measure.kind === 'distance'} tooltipSide={side} onClick={() => measureBtn('distance')} />
            <IconButton label={t('map.measure.area')} icon={<SquareDashed />} pressed={measure.kind === 'area'} tooltipSide={side} onClick={() => measureBtn('area')} />
          </Group>
        )}
        {!narrow && (
          <Group>
            <IconButton label={t(view.motion === 'full' ? 'map.motion.off' : 'map.motion.on')} icon={<Gauge />} pressed={view.motion === 'reduced'} tooltipSide={side} onClick={() => setMotion(view.motion === 'full' ? 'reduced' : 'full')} />
            <IconButton label={t(fs ? 'map.fullscreen.exit' : 'map.fullscreen')} icon={fs ? <Minimize /> : <Expand />} tooltipSide={side} onClick={toggleFs} />
          </Group>
        )}
      </div>
    </div>
  );
}
