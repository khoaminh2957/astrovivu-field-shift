/**
 * The MapLibre style of the globe: sources, the fixed part of the layer stack, sky and light.
 * Layers that depend on mission state (NASA overlays, labels, the dimming mask) are added by
 * their own modules; `LAYER` fixes the order they are inserted in.
 */
import type { FeatureCollection } from 'geojson';
import type { LayerSpecification, RasterDEMSourceSpecification, RasterSourceSpecification, SkySpecification, StyleSpecification } from 'maplibre-gl';
import type { LngLat } from '@/contracts';
import { COLOR } from '@/ui/design/tokens';
import { viaScheduler } from './net';
import { GIBS_BASE } from './overlays';

/** Layer ids, bottom to top. */
export const LAYER = {
  stars: 'stars',
  ocean: 'ocean',
  blueMarble: 'blue-marble',
  satFallback: 'sat-fallback',
  sat: 'sat',
  hillshade: 'relief',
  overlayA: 'overlay-a',
  overlayB: 'overlay-b',
  dim: 'parcel-dim',
  halo: 'halo',
} as const;

export const SOURCE = {
  blueMarble: 'blue-marble',
  sat: 'sat',
  satFallback: 'sat-fallback',
  dem: 'dem',
  demRelief: 'dem-relief',
  overlayA: 'overlay-a',
  overlayB: 'overlay-b',
  dim: 'parcel-dim',
  labels: 'labels',
  labelsRaster: 'labels-raster',
} as const;

/** True elevation plus a quarter: enough for relief to read at a glance without lying about slope. */
export const TERRAIN_EXAGGERATION = 1.25;

export const CREDIT = {
  blueMarble: 'NASA Blue Marble (GIBS)',
  esri: 'Esri, Maxar, Earthstar Geographics',
  sentinel2: 'Sentinel-2 cloudless 2020 by EOX (modified Copernicus Sentinel data)',
  terrain: 'Terrain Tiles on AWS (SRTM, NASA/USGS)',
  gibs: 'NASA EOSDIS GIBS',
  labels: 'OpenFreeMap, OpenMapTiles, OpenStreetMap contributors',
  labelsRaster: 'Esri reference layer',
} as const;

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const SAT_FALLBACK_SOURCE: RasterSourceSpecification = {
  type: 'raster',
  tiles: [viaScheduler('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg')],
  tileSize: 256,
  maxzoom: 14,
  attribution: CREDIT.sentinel2,
};

export const DEM_SOURCE: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: [viaScheduler(TERRARIUM)],
  tileSize: 256,
  encoding: 'terrarium',
  // Level 12 is 38 m at the equator, about SRTM's native 30 m. Deeper levels are resampled,
  // three times heavier and add noise, not relief.
  maxzoom: 12,
  attribution: CREDIT.terrain,
};

/**
 * Near the ground the upper sky stays the navy of the interface while the horizon carries a
 * pale haze, so pitched terrain reads against it. From orbit MapLibre fades this out and its
 * scattering atmosphere takes over. That model is kept faint (at full strength it veils the
 * whole disc in white); the glow and the shading of the sphere come from the halo layer.
 */
export const SKY: SkySpecification = {
  'sky-color': '#0d2140',
  'horizon-color': '#a9c8e6',
  'fog-color': '#b9cfe2',
  'sky-horizon-blend': 0.55,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.82,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.24, 5, 0.24, 8, 0.12, 11, 0],
};

const raster = (id: string, source: string, paint: Record<string, unknown> = {}, extra: Partial<LayerSpecification> = {}): LayerSpecification =>
  ({ id, type: 'raster', source, paint: { 'raster-fade-duration': 260, ...paint }, ...extra }) as LayerSpecification;

export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Astrovivu globe',
    projection: { type: 'globe' },
    // MapLibre's atmosphere takes its sun from the light. Polar 180 is straight behind the
    // viewer; a few degrees off keeps the whole visible disc in daylight (its terminator is a
    // hard line) while the upper-left limb catches a little more light. Fixed to the viewport,
    // so it does not sweep across the planet as the globe turns.
    light: { anchor: 'viewport', position: [1.5, 315, 170], intensity: 0.4 },
    sky: SKY,
    sources: {
      [SOURCE.blueMarble]: {
        type: 'raster',
        tiles: [viaScheduler(`${GIBS_BASE}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`)],
        tileSize: 256,
        maxzoom: 8,
        attribution: CREDIT.blueMarble,
      },
      [SOURCE.sat]: {
        type: 'raster',
        tiles: [viaScheduler('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')],
        tileSize: 256,
        // Level 19 exists in the US and in cities; where it does not, the scheduler rejects
        // Esri's placeholder and MapLibre keeps the level below.
        maxzoom: 19,
        attribution: CREDIT.esri,
      },
      [SOURCE.dem]: DEM_SOURCE,
      [SOURCE.dim]: { type: 'geojson', data: dimMask(null), tolerance: 0.1 },
    },
    layers: [
      // A globe with no tile yet (or no network) is still a planet, not a hole in the stars.
      { id: LAYER.ocean, type: 'background', paint: { 'background-color': '#0a1b30' } },
      raster(LAYER.blueMarble, SOURCE.blueMarble),
      // Loaded from the first frame but transparent, so that entering explore is a fade, not a wait.
      raster(LAYER.sat, SOURCE.sat, { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 } }),
      {
        id: LAYER.dim,
        type: 'fill',
        source: SOURCE.dim,
        minzoom: 9,
        paint: {
          // A fixed dark, not the theme's void: the interface theme is light, the dimming must stay dark.
          'fill-color': '#03050b',
          'fill-antialias': false,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0, 13, 0.14],
        },
      },
    ],
  };
}

/** Everything outside the parcel, as one polygon with the parcel cut out of it. */
export function dimMask(ring: LngLat[] | null): FeatureCollection {
  if (!ring || ring.length < 4) return { type: 'FeatureCollection', features: [] };
  const world: LngLat[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ring] } }],
  };
}
