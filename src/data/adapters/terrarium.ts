/**
 * AWS Terrain Tiles, Terrarium encoding (CORS *). Decodes the tiles covering the parcel into a
 * DEM grid in Web Mercator pixel space: OffscreenCanvas/canvas in the browser, pngjs in Node.
 */
import type { LngLat, Parcel } from '@/contracts';
import { cached, TTL } from '../cache';
import { isNode, nodeImport } from '../env';
import { getBytes } from '../http';
import { pointInPolygon } from '../harmonize/zonal';
import { terrariumElevation, type DemGrid } from '../harmonize/terrain';

const TILE = 256;
const url = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const lngToX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z * TILE;
const latToY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z * TILE;
};
const xToLng = (x: number, z: number) => (x / (2 ** z * TILE)) * 360 - 180;
const yToLat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / (2 ** z * TILE);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

async function decodePng(bytes: Uint8Array): Promise<Uint8ClampedArray | Uint8Array> {
  if (isNode) {
    const { PNG } = await nodeImport<typeof import('pngjs')>('pngjs');
    // Buffer is a Node global here; pngjs wants one.
    const png = PNG.sync.read(Buffer.from(bytes));
    return png.data;
  }
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
}

/** Tiles are immutable; cache the decoded elevations (Float32 → number[]) per tile. */
async function tileElevations(z: number, x: number, y: number, signal?: AbortSignal): Promise<number[]> {
  return cached(`terrarium:${z}/${x}/${y}`, TTL.year, async () => {
    const rgba = await decodePng(await getBytes(url(z, x, y), { signal, timeoutMs: 15_000 }));
    const out = new Array<number>(TILE * TILE);
    for (let i = 0; i < TILE * TILE; i++) out[i] = Math.round(terrariumElevation(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) * 100) / 100;
    return out;
  });
}

/** Pick the finest zoom (≤ 14) whose window covers the parcel with at most 4 tiles. */
function pickZoom(bbox: Parcel['bbox']): number {
  for (let z = 14; z >= 8; z--) {
    const tx0 = Math.floor((lngToX(bbox[0], z) - 2) / TILE);
    const tx1 = Math.floor((lngToX(bbox[2], z) + 2) / TILE);
    const ty0 = Math.floor((latToY(bbox[3], z) - 2) / TILE);
    const ty1 = Math.floor((latToY(bbox[1], z) + 2) / TILE);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 4) return z;
  }
  return 8;
}

export async function terrariumDem(parcel: Pick<Parcel, 'bbox' | 'polygon' | 'centroid'>, signal?: AbortSignal): Promise<{ grid: DemGrid; zoom: number; pixelM: number; corners: [LngLat, LngLat, LngLat, LngLat] }> {
  // Data under the tiles is ~30 m SRTM outside the US; zoom 13 (≈19 m at the equator) samples it
  // without inventing detail, so cap there unless the parcel is tiny.
  const z = Math.min(13, pickZoom(parcel.bbox));
  const px0 = Math.floor(lngToX(parcel.bbox[0], z)) - 2;
  const px1 = Math.ceil(lngToX(parcel.bbox[2], z)) + 2;
  const py0 = Math.floor(latToY(parcel.bbox[3], z)) - 2;
  const py1 = Math.ceil(latToY(parcel.bbox[1], z)) + 2;
  const w = px1 - px0 + 1;
  const h = py1 - py0 + 1;
  const tiles = new Map<string, number[]>();
  const need: [number, number][] = [];
  for (let tx = Math.floor(px0 / TILE); tx <= Math.floor(px1 / TILE); tx++)
    for (let ty = Math.floor(py0 / TILE); ty <= Math.floor(py1 / TILE); ty++) need.push([tx, ty]);
  await Promise.all(need.map(async ([tx, ty]) => tiles.set(`${tx}/${ty}`, await tileElevations(z, tx, ty, signal))));
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const gx = px0 + c;
      const gy = py0 + r;
      const t = tiles.get(`${Math.floor(gx / TILE)}/${Math.floor(gy / TILE)}`);
      data[r * w + c] = t ? t[(gy % TILE) * TILE + (gx % TILE)] : NaN;
    }
  }
  const lat = parcel.centroid[1];
  const pixelM = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (2 ** z * TILE);
  const insideMask = new Uint8Array(w * h);
  let count = 0;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++)
      if (pointInPolygon([xToLng(px0 + c + 0.5, z), yToLat(py0 + r + 0.5, z)], parcel.polygon)) {
        insideMask[r * w + c] = 1;
        count++;
      }
  if (count === 0) {
    // Parcel smaller than a pixel: use the pixel under the centroid.
    const c = Math.floor(lngToX(parcel.centroid[0], z)) - px0;
    const r = Math.floor(latToY(parcel.centroid[1], z)) - py0;
    insideMask[r * w + c] = 1;
  }
  // Grid corners in lng/lat (outer pixel edges), for drawing the DEM as a field raster.
  const west = xToLng(px0, z);
  const east = xToLng(px0 + w, z);
  const north = yToLat(py0, z);
  const south = yToLat(py0 + h, z);
  const corners: [LngLat, LngLat, LngLat, LngLat] = [[west, north], [east, north], [east, south], [west, south]];
  return { grid: { width: w, height: h, data, cellX: pixelM, cellY: pixelM, inside: (c, r) => insideMask[r * w + c] === 1 }, zoom: z, pixelM, corners };
}
