/**
 * Camera arithmetic: where the camera should be for each mission state. Pure functions of the
 * viewport and the geometry, so the framing can be reasoned about (and tested) without a map.
 */
import type { LngLat } from '@/contracts';
import { metresPerDegree } from '@/lib/geo';
import { clamp } from './tween';

const RAD = Math.PI / 180;
/** MapLibre's world is 512 px wide at zoom 0. */
const WORLD_PX = 512;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** MapLibre's default vertical field of view, degrees. */
export const DEFAULT_FOV = 36.87;

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface CameraPose {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
  padding: Padding;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Zoom at which the globe's silhouette has a given radius on screen. MapLibre's zoom on a globe
 * is the mercator zoom at the centre latitude, so the same zoom shows a bigger planet nearer the
 * poles; this inverts that and the perspective (the silhouette is smaller than the sphere).
 */
export function zoomForGlobeRadius(radiusPx: number, lat: number, viewportHeight: number, fovDeg = DEFAULT_FOV): number {
  const cameraToCenter = (0.5 * viewportHeight) / Math.tan((fovDeg * RAD) / 2);
  const sinHalfAngle = Math.sin(Math.atan(radiusPx / cameraToCenter));
  const sphereRadius = (cameraToCenter * sinHalfAngle) / (1 - sinHalfAngle);
  return Math.log2((sphereRadius * 2 * Math.PI * Math.cos(lat * RAD)) / WORLD_PX);
}

export const metresPerPixel = (zoom: number, lat: number): number => (EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD)) / (WORLD_PX * 2 ** zoom);

export const zoomForMetresPerPixel = (mpp: number, lat: number): number => Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD)) / (WORLD_PX * mpp));

/** Height of the landing's controls along the bottom edge: the search, the two pills under it and their margins. */
const HERO_CONTROLS_PX = 150;
/** Clear space kept between the globe and the controls below it, and the corner row above it. */
const HERO_GAP_PX = 16;
const HERO_TOP_PX = 56;

function heroFrame(view: Viewport): { radius: number; middle: number } {
  const floor = view.height - HERO_CONTROLS_PX - HERO_GAP_PX;
  const radius = Math.max(60, Math.min(0.34 * view.height, 0.44 * view.width, (floor - HERO_TOP_PX) / 2));
  // Never above 30 % of the height: on a screen too short for both, the globe may pass behind the controls, but the padding stays sane.
  return { radius, middle: Math.max(0.3 * view.height, Math.min(0.47 * view.height, floor - radius)) };
}

/** Distance in px from the top of the screen to the middle of the landing's globe: where the landing sets its question. */
export const heroGlobeMiddle = (view: Viewport): number => heroFrame(view).middle;

/**
 * State 1: the planet centred across the screen and a little above the middle, about two thirds
 * of the short side, with its lower edge clear of the landing's search. On a short screen the
 * controls keep their size, so the globe moves up and, when it would reach the top row, shrinks.
 */
export function heroPose(view: Viewport, center: LngLat): CameraPose {
  const { radius, middle } = heroFrame(view);
  return {
    center,
    zoom: zoomForGlobeRadius(radius, center[1], view.height),
    pitch: 0,
    bearing: 0,
    // MapLibre puts the look-at point in the middle of what the padding leaves: this lifts it to `middle`.
    padding: { top: 0, bottom: Math.max(0, Math.round(view.height - 2 * middle)), left: 0, right: 0 },
  };
}

/**
 * State 2: one step closer. With `free` (what the panels leave uncovered, as a padding) the globe
 * is sized to that area and centred in it; without it, the earlier estimate that lifts the globe
 * to clear a dock along the bottom edge.
 */
export function explorePose(view: Viewport, center: LngLat, free?: Padding): CameraPose {
  const w = free ? Math.max(120, view.width - free.left - free.right) : view.width;
  const h = free ? Math.max(120, view.height - free.top - free.bottom) : view.height;
  const radius = Math.min(0.45 * h, (free ? 0.47 : 0.56) * w);
  const lat = clamp(center[1], -55, 55);
  return {
    center: [center[0], lat],
    zoom: zoomForGlobeRadius(radius, lat, view.height),
    pitch: 0,
    bearing: 0,
    padding: free ?? { top: 0, bottom: Math.round(0.15 * view.height), left: 0, right: 0 },
  };
}

/** Extent of a ring in metres along screen-right and screen-up for a camera bearing. */
export function ringExtentM(ring: LngLat[], bearingDeg: number): { across: number; along: number } {
  if (ring.length === 0) return { across: 0, along: 0 };
  const o = ring[0];
  const m = metresPerDegree(o[1]);
  const b = bearingDeg * RAD;
  // Screen-right points to compass bearing + 90 degrees, screen-up to the bearing itself.
  const rx = Math.cos(b);
  const ry = -Math.sin(b);
  const ux = Math.sin(b);
  const uy = Math.cos(b);
  let minA = Infinity;
  let maxA = -Infinity;
  let minU = Infinity;
  let maxU = -Infinity;
  for (const p of ring) {
    const e = (p[0] - o[0]) * m.lng;
    const n = (p[1] - o[1]) * m.lat;
    const a = e * rx + n * ry;
    const u = e * ux + n * uy;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
  }
  return { across: maxA - minA, along: maxU - minU };
}

/**
 * Zoom at which a ring fills `fill` of the free area left by the padding. Depth is foreshortened
 * by the pitch, so a pitched camera may come closer than a vertical one for the same shape.
 */
export function fitZoom(ring: LngLat[], lat: number, view: Viewport, padding: Padding, pitchDeg: number, bearingDeg: number, fill: number): number {
  const freeW = Math.max(120, view.width - padding.left - padding.right);
  const freeH = Math.max(120, view.height - padding.top - padding.bottom);
  const { across, along } = ringExtentM(ring, bearingDeg);
  const mpp = Math.max(across / (fill * freeW), (along * Math.cos(pitchDeg * RAD)) / (fill * freeH), 1e-3);
  return zoomForMetresPerPixel(mpp, lat);
}

/** At a pitched view the near edge grows more than the far edge. Centre the projected outline. */
export function centerParcelOutline(ring: LngLat[], pose: CameraPose, viewportHeight: number): LngLat {
  if (!ring.length) return pose.center;
  const [lng, lat] = pose.center;
  const degrees = metresPerDegree(lat);
  const mpp = metresPerPixel(pose.zoom, lat);
  const bearing = pose.bearing * RAD;
  const pitch = pose.pitch * RAD;
  const cosB = Math.cos(bearing);
  const sinB = Math.sin(bearing);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const distance = viewportHeight / (2 * Math.tan(DEFAULT_FOV * RAD / 2));
  const pixels = ring.map(([x, y]) => {
    const east = ((((x - lng) % 360) + 540) % 360 - 180) * degrees.lng / mpp;
    const south = (lat - y) * degrees.lat / mpp;
    return [east * cosB + south * sinB, -east * sinB + south * cosB];
  });
  let right = 0;
  let down = 0;
  for (let pass = 0; pass < 2; pass++) {
    let left = Infinity, top = Infinity, farRight = -Infinity, bottom = -Infinity;
    for (const [x, y] of pixels) {
      const scale = distance / Math.max(distance / 4, distance - (y - down) * sinP);
      const screenX = (x - right) * scale;
      const screenY = (y - down) * cosP * scale;
      left = Math.min(left, screenX);
      farRight = Math.max(farRight, screenX);
      top = Math.min(top, screenY);
      bottom = Math.max(bottom, screenY);
    }
    right += (left + farRight) / 2;
    down += (top + bottom) / (2 * cosP);
  }
  return [
    lng + (right * cosB - down * sinB) * mpp / degrees.lng,
    lat - (right * sinB + down * cosB) * mpp / degrees.lat,
  ];
}

/** Great-circle angle between two points, degrees. */
export function angularDistance(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / RAD;
}

/** Signed smallest rotation from one bearing to another, degrees. */
export function shortestAngle(delta: number): number {
  return ((((delta + 180) % 360) + 360) % 360) - 180;
}

/**
 * How long a flight should take: longer the more zoom levels it crosses and the further it
 * travels, within bounds that keep a short hop brisk and an orbit-to-field descent watchable.
 */
export function flightDurationMs(zoomDelta: number, distanceDeg: number): number {
  return clamp(1300 + 340 * Math.abs(zoomDelta) + 9 * distanceDeg, 1800, 7800);
}

/**
 * Descent profile: leaves gently, covers the high-altitude part quickly and spends almost half
 * the time on the last few zoom levels, where imagery tiles need time to arrive and the eye
 * wants to recognise the place.
 */
export function descentEase(t: number): number {
  return 1 - (1 - t ** 1.35) ** 2.4;
}

/** Reads a CSS length custom property in pixels; `fallback` when it is missing or not a px value. */
export function cssPx(name: string, fallback: number, el: Element = document.documentElement): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(raw);
  return m ? Number(m[1]) : fallback;
}
