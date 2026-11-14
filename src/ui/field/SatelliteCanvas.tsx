/**
 * The field's own satellite picture: Esri World Imagery tiles (the imagery the map already uses)
 * at the zoom where the parcel spans about 256-512 px, drawn to a canvas, with the parcel outlined.
 */
import { useEffect, useRef, useState } from 'react';
import type { LngLat, Parcel } from '@/contracts';
import { cn } from '@/ui/design';
import { ringsOf } from './picture';

const TILE = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

/** Web Mercator pixel at zoom z (256 px tiles). */
function merc([lng, lat]: LngLat, z: number): [number, number] {
  const n = 256 * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();
function loadTile(url: string): Promise<HTMLImageElement | null> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 10_000);
      img.onload = () => (clearTimeout(timer), resolve(img));
      img.onerror = () => (clearTimeout(timer), resolve(null));
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}

export function SatelliteCanvas({ parcel, className, pad = 12 }: { parcel: Parcel; className?: string; pad?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let alive = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = (canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr)));
    const h = (canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr)));
    const [west, south, east, north] = parcel.bbox;
    let z = 19;
    for (let k = 10; k <= 19; k++) {
      const [ax, ay] = merc([west, north], k);
      const [bx, by] = merc([east, south], k);
      const span = Math.max(bx - ax, by - ay);
      if (span >= 256) {
        z = k;
        break;
      }
    }
    const [x0, y0] = merc([west, north], z);
    const [x1, y1] = merc([east, south], z);
    const k = Math.min((w - 2 * pad * dpr) / Math.max(1, x1 - x0), (h - 2 * pad * dpr) / Math.max(1, y1 - y0));
    const ox = (w - (x1 - x0) * k) / 2 - x0 * k;
    const oy = (h - (y1 - y0) * k) / 2 - y0 * k;
    // Visible extent in mercator pixels, so the tiles fill the whole tile frame, not just the bbox.
    const vx0 = -ox / k, vy0 = -oy / k, vx1 = (w - ox) / k, vy1 = (h - oy) / k;
    const tiles: [number, number][] = [];
    for (let tx = Math.floor(vx0 / 256); tx <= Math.floor(vx1 / 256); tx++) for (let ty = Math.floor(vy0 / 256); ty <= Math.floor(vy1 / 256); ty++) tiles.push([tx, ty]);
    if (tiles.length > 25) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    void Promise.all(tiles.map(([tx, ty]) => loadTile(TILE(z, tx, ty)).then((img) => ({ img, tx, ty })))).then((loaded) => {
      if (!alive) return;
      ctx.clearRect(0, 0, w, h);
      let any = false;
      for (const { img, tx, ty } of loaded) {
        if (!img) continue;
        any = true;
        ctx.drawImage(img, tx * 256 * k + ox, ty * 256 * k + oy, 256 * k + 0.5, 256 * k + 0.5);
      }
      setFailed(!any);
      const path = new Path2D();
      for (const ring of ringsOf(parcel)) {
        ring.forEach((p, i) => {
          const [mx, my] = merc(p, z);
          if (i) path.lineTo(mx * k + ox, my * k + oy);
          else path.moveTo(mx * k + ox, my * k + oy);
        });
        path.closePath();
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3 * dpr;
      ctx.stroke(path);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.25 * dpr;
      ctx.stroke(path);
    });
    return () => {
      alive = false;
    };
  }, [parcel, pad]);

  return (
    <>
      <canvas ref={ref} aria-hidden className={cn('block h-full w-full', className)} />
      {failed && <span className="t-caption absolute inset-0 flex items-center justify-center p-3 text-center text-white/80">--</span>}
    </>
  );
}
