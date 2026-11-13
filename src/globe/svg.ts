/** Tiny helpers for the vector overlay drawn above the WebGL canvas. */
import type { LngLat } from '@/contracts';
import type { Map as MapLibreMap } from 'maplibre-gl';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

export interface ScreenRing {
  /** `x0,y0,x1,y1,…` in CSS pixels of the map container. */
  points: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** False when any point could not be projected (behind the camera). */
  finite: boolean;
}

/** Projects a ring to the screen. `map.project` follows 3D terrain, so the ring hugs the relief. */
export function projectRing(map: MapLibreMap, ring: LngLat[], out?: ScreenRing): ScreenRing {
  const n = ring.length;
  const r: ScreenRing = out && out.points.length === n * 2 ? out : { points: new Float64Array(n * 2), minX: 0, minY: 0, maxX: 0, maxY: 0, finite: true };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let finite = true;
  for (let i = 0; i < n; i++) {
    const p = map.project(ring[i]);
    r.points[i * 2] = p.x;
    r.points[i * 2 + 1] = p.y;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e5 || Math.abs(p.y) > 1e5) finite = false;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  r.minX = minX;
  r.minY = minY;
  r.maxX = maxX;
  r.maxY = maxY;
  r.finite = finite && n > 0;
  return r;
}

/** SVG path data for a projected ring; one decimal is finer than any display can show. */
export function ringPath(r: ScreenRing, close: boolean): string {
  const p = r.points;
  if (p.length < 4) return '';
  let d = `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  for (let i = 2; i < p.length; i += 2) d += `L${p[i].toFixed(1)} ${p[i + 1].toFixed(1)}`;
  return close ? `${d}Z` : d;
}

const RAD = Math.PI / 180;

/**
 * Whether a point of the globe faces the camera. `map.project` answers for hidden points too
 * (it returns where they would be if the planet were glass), so anything drawn from projected
 * coordinates has to ask first. Exact for a sphere; terrain is ignored.
 */
export function facesCamera(map: MapLibreMap, at: LngLat): boolean {
  const zoom = map.getZoom();
  // From about here the horizon is far outside the frame: anything on screen is in front.
  if (zoom >= 8.5) return true;
  const center = map.getCenter();
  const height = map.getContainer().clientHeight || 1;
  const fov = map.getVerticalFieldOfView() * RAD;
  const cameraToCenter = (0.5 / Math.tan(fov / 2)) * height;
  const globeRadius = (512 * 2 ** zoom) / (2 * Math.PI) / Math.cos(center.lat * RAD);
  // Camera position in globe-radius units, built the way MapLibre builds it: start above the
  // centre point, apply roll, pitch and bearing, then turn with the centre's latitude and longitude.
  let x = 0;
  let y = 0;
  let z = cameraToCenter / globeRadius;
  const rotZ = (a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    [x, y] = [x * c - y * s, x * s + y * c];
  };
  const rotX = (a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    [y, z] = [y * c - z * s, y * s + z * c];
  };
  const rotY = (a: number) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    [x, z] = [z * s + x * c, z * c - x * s];
  };
  rotZ(-map.getRoll() * RAD);
  rotX(map.getPitch() * RAD);
  rotZ(-map.getBearing() * RAD);
  z += 1;
  rotX(-center.lat * RAD);
  rotY(center.lng * RAD);
  const lat = at[1] * RAD;
  const lng = at[0] * RAD;
  const px = Math.sin(lng) * Math.cos(lat);
  const py = Math.sin(lat);
  const pz = Math.cos(lng) * Math.cos(lat);
  // In front of the horizon when the camera is above the plane tangent to the sphere at the point.
  return px * x + py * y + pz * z > 1.0005;
}
