import { useEffect, useRef } from 'react';
import type { BranchId, FieldRaster, ISODate, Parcel } from '@/contracts';
import { useMission } from '@/state/mission';
import { cn } from '@/ui/design';
import { displayRange } from '@/lib/raster';
import { drawFieldPicture, rasterFor, shapePath, singleColor } from './picture';

/**
 * Live field picture of one branch. It follows the timeline cursor by subscribing to the store
 * and redrawing the canvas (coalesced to one draw per animation frame): React does not re-render
 * while the timeline plays.
 */
export function LiveFieldCanvas({ branch, className, pad = 8 }: { branch: BranchId; className?: string; pad?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const s = useMission.getState();
      if (!s.parcel) return;
      const raster = rasterFor(s.rasters, branch);
      const t = s.timeline.cursor;
      const range = raster ? displayRange(raster, s.parcel.polygon, s.layers.stretch) : undefined;
      drawFieldPicture(canvas, { parcel: s.parcel, raster, t, range, fill: raster ? null : singleColor(s, branch, t), pad });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      schedule();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    fit();
    const unsub = useMission.subscribe((s, p) => {
      if (s.timeline.cursor !== p.timeline.cursor || s.layers.stretch !== p.layers.stretch || s.rasters !== p.rasters || s.telemetry !== p.telemetry || s.parcel !== p.parcel) schedule();
    });
    return () => {
      ro.disconnect();
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [branch, pad]);

  return <canvas ref={ref} aria-hidden className={cn('block h-full w-full', className)} />;
}

/** One fixed frame of a raster (filmstrip thumbnail). Drawn once per raster and size. */
export function FrameCanvas({ parcel, raster, t, className }: { parcel: Parcel; raster: FieldRaster; t: ISODate; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stretch = useMission((s) => s.layers.stretch);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    drawFieldPicture(canvas, { parcel, raster, t, blend: false, pad: 4, range: displayRange(raster, parcel.polygon, stretch) });
  }, [parcel, raster, t, stretch]);
  return <canvas ref={ref} aria-hidden className={cn('block h-full w-full', className)} />;
}

/** Small field-shaped outline for lists. */
export function ShapeThumb({ parcel, size = 40, className, light }: { parcel: Pick<Parcel, 'polygon'>; size?: number; className?: string; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className={cn('shrink-0', className)}>
      <path d={shapePath(parcel, size, size, 3)} fill="#58c26b" fillOpacity={light ? 0.9 : 0.75} stroke={light ? '#ffffff' : 'var(--color-ink-1)'} strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  );
}
