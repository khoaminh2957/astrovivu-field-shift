/**
 * The base map: which imagery is shown, how it is blended, and what happens when a server
 * stops answering.
 *
 * From orbit the globe is NASA's Blue Marble (a seamless 500 m mosaic with relief and
 * bathymetry). Esri World Imagery, sharper but paler and patchy at world scale, fades in over
 * it between two zoom levels and carries the view down to the field. Sentinel-2 at 10 m is held
 * in reserve under Esri, and the Blue Marble stays under both, so a missing tile shows the next
 * coarser picture rather than a hole.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { onTileResult, type HostStats } from './net';
import type { ImagerySource } from './status';
import { CREDIT, DEM_SOURCE, LAYER, SAT_FALLBACK_SOURCE, SOURCE } from './style';
import { easeInOutCubic, lerp, tween, type Tween } from './tween';

/** Esri is invisible below the first zoom and fully in by the second. */
const SAT_FADE_ZOOM: [number, number] = [4.2, 6.2];
/** Below this the Esri source is not even requested. */
const SAT_MIN_ZOOM = 4;
const ESRI_HOST = 'server.arcgisonline.com';
const EOX_HOST = 'tiles.maps.eox.at';
const GIBS_HOST = 'gibs.earthdata.nasa.gov';
/** This many failures in a row, with no success between them, and a host is treated as down. */
const FAIL_STREAK = 6;

export interface ImageryLook {
  /** 0..1: how much of the high-resolution imagery is let through (0 when satellite is switched off). */
  sat: number;
  /** 0..1: the subdued hero look, a backdrop behind the title; 0 is full contrast. */
  soft: number;
  /** 0..1: satellite off, the base becomes a dark grey relief for NASA overlays to sit on. */
  dim: number;
}

export class BaseImagery {
  private look: ImageryLook = { sat: 0, soft: 0, dim: 0 };
  private target: ImageryLook = { sat: 0, soft: 0, dim: 0 };
  private anim: Tween | null = null;
  private source: ImagerySource = 'esri';
  private gibsDown = false;
  private blueMarbleSeen = false;
  private reliefAdded = false;
  private readonly stop: () => void;

  constructor(
    private readonly map: MapLibreMap,
    private readonly host: {
      reducedMotion: () => boolean;
      /** Something a credit line or a notice depends on has changed. */
      onChange: (notice: string | null) => void;
    },
  ) {
    map.setLayerZoomRange(LAYER.sat, SAT_MIN_ZOOM, 24);
    map.on('sourcedata', (e) => {
      if (e.sourceId === SOURCE.blueMarble && e.tile) this.blueMarbleSeen = true;
    });
    this.stop = onTileResult(this.onTileResult);
  }

  get imagery(): ImagerySource {
    return this.source;
  }

  get satelliteVisible(): boolean {
    return this.target.sat > 0;
  }

  get reliefVisible(): boolean {
    return this.target.dim > 0;
  }

  /** True from the zoom at which the high-resolution imagery starts to show. */
  sharpAt(zoom: number): boolean {
    return this.satelliteVisible && (this.gibsDown || zoom >= SAT_FADE_ZOOM[0]);
  }

  /** Credit for the imagery actually on screen at a zoom. */
  credit(zoom: number): string {
    if (!this.sharpAt(zoom)) return CREDIT.blueMarble;
    const sharp = this.source === 'esri' ? CREDIT.esri : this.source === 'sentinel2' ? CREDIT.sentinel2 : null;
    return sharp ? `${sharp} · ${CREDIT.blueMarble}` : CREDIT.blueMarble;
  }

  /** Moves to a new look over `durationMs` (cut down to a short fade under reduced motion). */
  set(target: ImageryLook, durationMs: number): void {
    const t = this.target;
    if (target.sat === t.sat && target.soft === t.soft && target.dim === t.dim && durationMs > 0) return;
    this.target = { ...target };
    this.anim?.cancel();
    const from = { ...this.look };
    if (target.dim > 0) this.ensureRelief();
    if (target.sat > 0) this.map.setLayoutProperty(LAYER.sat, 'visibility', 'visible');
    if (this.reliefAdded && target.dim > 0) this.map.setLayoutProperty(LAYER.hillshade, 'visibility', 'visible');
    this.anim = tween(
      this.host.reducedMotion() ? Math.min(durationMs, 120) : durationMs,
      (k) => {
        this.look = { sat: lerp(from.sat, target.sat, k), soft: lerp(from.soft, target.soft, k), dim: lerp(from.dim, target.dim, k) };
        this.paint();
      },
      easeInOutCubic,
    );
    void this.anim.done.then((completed) => {
      if (!completed) return;
      // A layer that ended up invisible must stop requesting tiles as the camera moves.
      if (this.look.sat === 0) this.map.setLayoutProperty(LAYER.sat, 'visibility', 'none');
      if (this.reliefAdded && this.look.dim === 0) this.map.setLayoutProperty(LAYER.hillshade, 'visibility', 'none');
    });
    this.host.onChange(null);
  }

  destroy(): void {
    this.anim?.cancel();
    this.stop();
  }

  private paint(): void {
    const { map } = this;
    const { sat, soft, dim } = this.look;
    if (!map.getLayer(LAYER.sat)) return;
    // With the Blue Marble unavailable there is nothing to blend from: Esri carries every zoom.
    map.setPaintProperty(LAYER.sat, 'raster-opacity', this.gibsDown ? sat : ['interpolate', ['linear'], ['zoom'], SAT_FADE_ZOOM[0], 0, SAT_FADE_ZOOM[1], sat]);
    map.setPaintProperty(LAYER.blueMarble, 'raster-brightness-max', lerp(lerp(1, 0.84, soft), 0.5, dim));
    map.setPaintProperty(LAYER.blueMarble, 'raster-saturation', lerp(lerp(0, -0.14, soft), -0.75, dim));
    if (this.reliefAdded) map.setPaintProperty(LAYER.hillshade, 'hillshade-exaggeration', 0.45 * dim);
  }

  /** Hillshade for the satellite-off base. A second DEM source on purpose: terrain changes the tile size of the source it owns. */
  private ensureRelief(): void {
    if (this.reliefAdded) return;
    this.reliefAdded = true;
    this.map.addSource(SOURCE.demRelief, DEM_SOURCE);
    this.map.addLayer(
      {
        id: LAYER.hillshade,
        type: 'hillshade',
        source: SOURCE.demRelief,
        minzoom: 6,
        paint: { 'hillshade-exaggeration': 0, 'hillshade-shadow-color': '#02040a', 'hillshade-highlight-color': '#9fb2c8', 'hillshade-accent-color': '#0b1524' },
      },
      LAYER.dim,
    );
  }

  private onTileResult = (host: string, s: HostStats): void => {
    const { map } = this;
    if (host === ESRI_HOST && s.streak >= FAIL_STREAK && this.source === 'esri') {
      // Sentinel-2 goes underneath Esri: wherever an Esri tile is missing, 10 m imagery shows.
      this.source = 'sentinel2';
      if (!map.getSource(SOURCE.satFallback)) {
        map.addSource(SOURCE.satFallback, SAT_FALLBACK_SOURCE);
        map.addLayer({ id: LAYER.satFallback, type: 'raster', source: SOURCE.satFallback, minzoom: SAT_MIN_ZOOM, paint: { 'raster-fade-duration': 260 } }, LAYER.sat);
      }
      this.host.onChange('globe.imagery.fallback');
    } else if (host === EOX_HOST && s.streak >= FAIL_STREAK && this.source === 'sentinel2') {
      this.source = 'bluemarble';
      this.host.onChange('globe.imagery.coarse');
    } else if (host === GIBS_HOST && s.streak >= 4 && !this.blueMarbleSeen && !this.gibsDown) {
      // The orbital imagery itself is down: let the high-resolution layer cover every zoom.
      this.gibsDown = true;
      map.setLayerZoomRange(LAYER.sat, 0, 24);
      this.paint();
      this.host.onChange(null);
    }
  };
}
