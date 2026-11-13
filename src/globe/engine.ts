/**
 * The globe engine: one MapLibre map driven imperatively from the mission store.
 *
 * React mounts it once and never re-renders for it. Every reaction to state (camera flights,
 * layer changes, parcel colour) is a direct MapLibre or DOM call made from a store subscription,
 * and everything that follows the camera is recomputed inside MapLibre's own render event.
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import './globe.css';
import './strings';
import { Map as MapLibreMap, setMaxParallelImageRequests, setWorkerUrl, type ErrorEvent, type GeoJSONSource, type MapMovementEvent } from 'maplibre-gl';
// MapLibre 6 ships its worker as a separate module and finds it next to its own file, which a
// bundler moves. Vite's `?url` gives the address the file really has, in dev and in the build.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Lang, LngLat, Parcel, ParcelDraft, Series } from '@/contracts';
import { BRANCHES } from '@/contracts';
import { SAMPLE_PARCELS } from '@/data';
import { translate } from '@/i18n';
import { closeRing } from '@/lib/geo';
import { primarySeries } from '@/lib/series';
import { useMission, type MissionState } from '@/state/mission';
import { Beacons } from './beacons';
import {
  angularDistance,
  cssPx,
  descentEase,
  explorePose,
  fitZoom,
  flightDurationMs,
  heroPose,
  shortestAngle,
  type CameraPose,
  type Padding,
  type Viewport,
} from './camera';
import { framingBearing, meanPoint, openRing } from './draft';
import { DraftEditor } from './draw';
import { createHaloLayer } from './halo';
import { BaseImagery, type ImageryLook } from './imagery';
import { GLYPHS, Labels } from './labels';
import { registerTileScheduler } from './net';
import { OverlayController } from './overlayLayer';
import { getOverlay } from './overlays';
import { ParcelOverlay, type FillTexture } from './parcelOverlay';
import { paintForSeries, parcelReadingAt } from './ramps';
import { createStarsLayer } from './stars';
import { setGlobeStatus, useGlobeStatus } from './status';
import { CREDIT, LAYER, SOURCE, TERRAIN_EXAGGERATION, baseStyle, dimMask } from './style';
import { svgEl } from './svg';
import { clamp, easeInOutCubic, smoothstep } from './tween';

export type MotionPref = 'auto' | 'full' | 'reduced';
type View = 'hero' | 'explore' | 'parcel';
type FlightShape = 'descend' | 'ascend' | 'level';

/** Where the hero globe starts: South-East Asia in view, two of the demo fields under it. */
const HERO_CENTER: LngLat = [112, 16];
/** One revolution in a little over two minutes: visibly alive, never distracting. */
const ROTATE_DEG_PER_S = 2.8;
const ROTATE_RESUME_MS = 3500;
const ROTATE_RAMP_MS = 1400;
/** 3D terrain is switched on below orbit only: from space relief is sub-pixel and costs a texture cache. */
const TERRAIN_ON_ZOOM = 9.5;
const TERRAIN_OFF_ZOOM = 8.6;
const LOCK_PITCH = 54;
/** Share of the free area (between the HUD columns, top bar and timeline) the parcel may span. */
const LOCK_FILL = 0.5;
const LOCK_ZOOM_RANGE: [number, number] = [13.4, 18.4];
const DRAFT_ZOOM_RANGE: [number, number] = [12.5, 18.6];
const FIELD_ZOOM = 15.6;
const MAX_PIXEL_RATIO = 2;
/** Above this many device pixels the fill rate, not the scene, decides the frame time. */
const MAX_CANVAS_PIXELS = 5_200_000;

let workerConfigured = false;
let active: GlobeEngine | null = null;

/** The engine currently on screen, for the bench and for the imperative helpers in `GlobeCanvas`. */
export const getActiveGlobe = (): GlobeEngine | null => active;

const viewOf = (s: Pick<MissionState, 'parcel' | 'phase'>): View => (s.parcel ? 'parcel' : s.phase === 'hero' ? 'hero' : 'explore');

function cappedPixelRatio(view: Viewport): number {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const pixels = view.width * view.height * dpr * dpr;
  return pixels > MAX_CANVAS_PIXELS ? Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / (view.width * view.height))) : dpr;
}

export class GlobeEngine {
  readonly map: MapLibreMap;
  private readonly host: HTMLElement;
  private readonly mapEl: HTMLDivElement;
  private readonly creditsEl: HTMLDivElement;
  private svg!: SVGSVGElement;

  private state: MissionState = useMission.getState();
  private view: View = viewOf(this.state);
  private motion: MotionPref;
  private readonly reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private ready = false;
  private destroyed = false;

  private imagery!: BaseImagery;
  private parcelLayer!: ParcelOverlay;
  private draft!: DraftEditor;
  private beacons!: Beacons;
  private overlay!: OverlayController;
  private labels!: Labels;
  private cleanups: (() => void)[] = [];

  private terrainOn = false;
  private sharpCredited = false;
  private labelsCredit: string | null = null;
  private flightId = 0;
  private flying = false;
  private rotateRaf = 0;
  private rotateLast = 0;
  private rotateResumeAt = 0;
  private rotateRampFrom = 0;
  private pointerDown = false;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private fillKey = '';
  private lockedParcelId: string | null = null;
  private readonly warned = new Set<string>();

  constructor(host: HTMLElement, opts: { motion?: MotionPref } = {}) {
    this.host = host;
    this.motion = opts.motion ?? 'auto';
    if (!workerConfigured) {
      workerConfigured = true;
      setWorkerUrl(workerUrl);
      // The scheduler in net.ts is the governor (four per host); MapLibre's own cap only has to
      // be high enough not to hide waiting requests from it.
      setMaxParallelImageRequests(32);
    }
    registerTileScheduler();

    this.mapEl = document.createElement('div');
    this.mapEl.className = 'globe-map';
    this.creditsEl = document.createElement('div');
    this.creditsEl.className = 'globe-credits';
    host.append(this.mapEl, this.creditsEl);

    const view = this.viewport();
    const pose = this.poseFor(this.view, view);
    try {
      this.map = new MapLibreMap({
        container: this.mapEl,
        style: { ...baseStyle(), glyphs: GLYPHS },
        center: pose.center,
        zoom: pose.zoom,
        pitch: pose.pitch,
        bearing: pose.bearing,
        minZoom: 0.5,
        maxZoom: 19.5,
        maxPitch: 72,
        attributionControl: false,
        maplibreLogo: false,
        pixelRatio: cappedPixelRatio(view),
        // Lines and fills are anti-aliased in MapLibre's shaders; MSAA would double the fill cost.
        canvasContextAttributes: { antialias: false, powerPreference: 'high-performance' },
        fadeDuration: 200,
        renderWorldCopies: false,
        locale: { 'Map.Title': translate('globe.aria.map', this.state.lang) },
      });
    } catch (err) {
      this.mapEl.remove();
      this.creditsEl.remove();
      throw err;
    }
    this.map.setPadding(pose.padding);
    this.map.once('style.load', () => this.setup());
    this.map.on('error', this.onError);
    active = this;
  }

  // ---------------------------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------------------------

  setMotion(pref: MotionPref): void {
    this.motion = pref;
    this.onMotionChange();
  }

  /** Flies to a place at field scale (place search, "take me there"). Has no effect on a locked parcel. */
  flyToPlace(location: LngLat, zoom = 13.5): void {
    if (!this.ready || this.state.parcel) return;
    this.fly({ center: location, zoom, pitch: 0, bearing: 0, padding: explorePose(this.viewport(), location).padding }, 'level');
  }

  /** Returns the camera to the locked parcel after the user has wandered off. */
  refocus(): void {
    const { parcel } = this.state;
    if (this.ready && parcel) this.fly(this.parcelPose(parcel), 'descend', () => this.parcelLayer.flash());
  }

  /** Camera numbers for the bench readout. */
  getCamera(): { lng: number; lat: number; zoom: number; pitch: number; bearing: number } {
    const c = this.map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: this.map.getZoom(), pitch: this.map.getPitch(), bearing: this.map.getBearing() };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (active === this) active = null;
    cancelAnimationFrame(this.rotateRaf);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    if (this.ready) {
      this.imagery.destroy();
      this.overlay.destroy();
      this.draft.destroy();
      this.beacons.destroy();
      this.parcelLayer.destroy();
    }
    this.map.remove();
    this.mapEl.remove();
    this.creditsEl.remove();
    useMission.getState().setAnchor(null);
    setGlobeStatus({ ready: false, flying: false });
  }

  // ---------------------------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------------------------

  private setup(): void {
    if (this.destroyed) return;
    const { map } = this;
    map.addLayer(createStarsLayer(LAYER.stars), LAYER.ocean);
    map.addLayer(createHaloLayer(LAYER.halo));

    // The vector overlay sits inside MapLibre's canvas container, under the markers it adds
    // later, and lets every pointer event through to the map.
    this.svg = svgEl('svg', { class: 'globe-svg', 'aria-hidden': 'true' });
    map.getCanvasContainer().appendChild(this.svg);

    const mission = useMission.getState();
    this.imagery = new BaseImagery(map, {
      reducedMotion: () => this.reduced,
      onChange: (notice) => {
        if (notice) setGlobeStatus({ notice });
        setGlobeStatus({ imagery: this.imagery.imagery });
        this.renderCredits();
      },
    });
    this.parcelLayer = new ParcelOverlay(map, this.svg, (anchor) => useMission.getState().setAnchor(anchor));
    this.draft = new DraftEditor(map, this.svg, {
      setDraft: (draft: ParcelDraft) => useMission.getState().setDraft(draft),
      lang: () => this.state.lang,
      frameDraft: (vertices) => this.frameDraft(vertices),
      zoomToField: (at) => {
        setGlobeStatus({ notice: 'globe.draw.zoomHint' });
        this.fly({ center: at, zoom: FIELD_ZOOM, pitch: 0, bearing: 0, padding: explorePose(this.viewport(), at).padding }, 'level', () => {
          if (useGlobeStatus.getState().notice === 'globe.draw.zoomHint') setGlobeStatus({ notice: null });
        });
      },
    });
    this.beacons = new Beacons(map, SAMPLE_PARCELS, (id) => void useMission.getState().lockSample(id), mission.lang);
    this.overlay = new OverlayController(map, {
      beforeLayer: () => LAYER.dim,
      today: () => this.state.telemetry?.window.today ?? this.state.timeline.end,
      reducedMotion: () => this.reduced,
    });
    this.labels = new Labels(map, mission.lang, (credit) => {
      this.labelsCredit = credit;
      this.renderCredits();
    });

    map.on('render', this.onRender);
    map.on('zoom', this.onZoom);
    map.on('resize', this.onResize);
    // With a camera at rest (a deep link straight into explore or a locked field) the frame
    // drawn when the last tile landed was observed to leave the raster layers out until the
    // next repaint. One extra frame once loading settles costs nothing and closes that gap.
    let loadedSinceIdle = false;
    map.on('sourcedata', (e) => {
      if (e.tile) loadedSinceIdle = true;
    });
    map.on('idle', () => {
      if (!loadedSinceIdle) return;
      loadedSinceIdle = false;
      map.triggerRepaint();
    });

    const el = this.mapEl;
    const down = () => {
      this.pointerDown = true;
      this.rotateResumeAt = Number.POSITIVE_INFINITY;
    };
    const up = () => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      this.rotateResumeAt = performance.now() + ROTATE_RESUME_MS;
    };
    const nudge = () => {
      if (!this.pointerDown) this.rotateResumeAt = performance.now() + ROTATE_RESUME_MS;
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', nudge, { passive: true });
    el.addEventListener('keydown', nudge);
    const onMotion = () => this.onMotionChange();
    this.reducedQuery.addEventListener('change', onMotion);
    // A page that loaded in a background tab may have been denied its last frames: draw one on return.
    const onVisible = () => {
      if (!document.hidden) map.triggerRepaint();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    this.cleanups.push(
      () => document.removeEventListener('visibilitychange', onVisible),
      () => window.removeEventListener('focus', onVisible),
      () => el.removeEventListener('pointerdown', down),
      () => window.removeEventListener('pointerup', up),
      () => window.removeEventListener('pointercancel', up),
      () => el.removeEventListener('wheel', nudge),
      () => el.removeEventListener('keydown', nudge),
      () => this.reducedQuery.removeEventListener('change', onMotion),
      useMission.subscribe((s, prev) => this.onStore(s, prev)),
    );

    this.ready = true;
    this.state = useMission.getState();
    this.view = viewOf(this.state);
    this.enterView(this.view, null);
    this.applyLayers(true);
    this.draft.sync(this.state.draft, this.state.drawMode);
    this.syncBeacons();
    this.recolour();
    this.renderCredits();
    setGlobeStatus({ webgl: true, ready: true, reducedMotion: this.reduced, imagery: this.imagery.imagery });
  }

  // ---------------------------------------------------------------------------------------------
  // Store
  // ---------------------------------------------------------------------------------------------

  private onStore(s: MissionState, prev: MissionState): void {
    if (!this.ready || this.destroyed) return;
    this.state = s;
    const view = viewOf(s);
    const parcelChanged = (s.parcel?.id ?? null) !== this.lockedParcelId;
    if (view !== this.view || (view === 'parcel' && parcelChanged)) {
      const from = this.view;
      this.view = view;
      this.enterView(view, from);
    }
    if (s.draft !== prev.draft || s.drawMode !== prev.drawMode) {
      this.draft.sync(s.draft, s.drawMode);
      this.syncBeacons();
    }
    if (s.phase !== prev.phase) this.syncBeacons();
    if (s.layers !== prev.layers) this.applyLayers(false);
    if (s.timeline.cursor !== prev.timeline.cursor) this.overlay.set(s.layers.overlay, s.layers.overlayOpacity, s.timeline.cursor);
    if (s.timeline.cursor !== prev.timeline.cursor || s.telemetry !== prev.telemetry || s.focusBranch !== prev.focusBranch || s.layers.parcelMetric !== prev.layers.parcelMetric) {
      this.recolour();
    }
    if (s.lang !== prev.lang) this.onLang(s.lang);
  }

  private onLang(lang: Lang): void {
    this.beacons.setLang(lang);
    this.draft.relabel();
    this.labels.setLang(lang);
    this.map.getCanvas().setAttribute('aria-label', translate('globe.aria.map', lang));
    this.renderCredits();
  }

  private syncBeacons(): void {
    this.beacons.setVisible(this.view === 'explore' && this.state.phase === 'explore' && !this.draft.hasDraft);
  }

  // ---------------------------------------------------------------------------------------------
  // Views and camera
  // ---------------------------------------------------------------------------------------------

  private viewport(): Viewport {
    return { width: this.host.clientWidth || window.innerWidth, height: this.host.clientHeight || window.innerHeight };
  }

  private get reduced(): boolean {
    return this.motion === 'reduced' || (this.motion === 'auto' && this.reducedQuery.matches);
  }

  private poseFor(view: View, viewport: Viewport): CameraPose {
    const { parcel } = this.state;
    if (view === 'parcel' && parcel) return this.parcelPose(parcel, viewport);
    return view === 'hero' ? heroPose(viewport, HERO_CENTER) : explorePose(viewport, HERO_CENTER);
  }

  /**
   * State 3 framing. The padding reserves what the mission UI covers (top bar, timeline, the two
   * HUD columns), read from the design tokens so the parcel lands in the free area whatever the
   * breakpoint; MapLibre then centres the look-at point in what is left, a little above the middle.
   */
  private parcelPose(parcel: Parcel, viewport: Viewport = this.viewport()): CameraPose {
    const wide = viewport.width >= 1024;
    const side = wide ? cssPx('--hud-gutter', 24) + cssPx('--hud-callout-w', 264) + 28 : 12;
    const padding: Padding = {
      top: cssPx('--topbar-h', 48) + 8,
      bottom: cssPx('--timeline-h', 132) + 20,
      left: side,
      right: side,
    };
    const ring = openRing(parcel.polygon.coordinates[0]);
    // Lay the long side across the screen; a compact shape gets a slight turn so the scene
    // reads as 3D rather than as a tilted map.
    const bearing = framingBearing(ring, -16);
    const zoom = clamp(fitZoom(ring, parcel.centroid[1], viewport, padding, LOCK_PITCH, bearing, LOCK_FILL), ...LOCK_ZOOM_RANGE);
    return { center: parcel.centroid, zoom, pitch: LOCK_PITCH, bearing, padding };
  }

  /** What the base imagery should look like in the current view and with the current layer switches. */
  private imageryLook(): ImageryLook {
    const satellite = this.state.layers.base.satellite;
    return { sat: satellite ? 1 : 0, soft: this.view === 'hero' ? 1 : 0, dim: satellite ? 0 : 1 };
  }

  private enterView(view: View, from: View | null): void {
    const { map } = this;
    const { parcel } = this.state;
    this.host.dataset.view = view;
    this.syncBeacons();
    this.lockedParcelId = view === 'parcel' && parcel ? parcel.id : null;

    if (view === 'parcel' && parcel) {
      this.parcelLayer.setParcel(parcel);
      this.setDimMask(parcel);
      this.fillKey = '';
      this.recolour();
    } else {
      this.parcelLayer.setParcel(null);
      this.setDimMask(null);
    }
    // Leaving the hero, the globe comes up to full contrast while the camera steps in.
    this.imagery.set(this.imageryLook(), from === null ? 0 : 1200);

    const viewport = this.viewport();
    if (from === null) {
      // First frame (page load or deep link): start where the state says, without a show.
      map.jumpTo(this.poseFor(view, viewport));
      this.syncTerrain();
    } else if (view === 'parcel' && parcel) {
      this.fly(this.parcelPose(parcel, viewport), 'descend', () => this.parcelLayer.flash());
    } else {
      // Keep looking at the same part of the world: back out above the parcel that was locked,
      // or step in or out over wherever the user had turned the globe.
      const c = map.getCenter();
      const here: LngLat = [c.lng, c.lat];
      this.fly(view === 'hero' ? heroPose(viewport, here) : explorePose(viewport, here), from === 'parcel' ? 'ascend' : 'level');
    }
    if (view === 'hero') this.startRotation();
    else this.stopRotation();
  }

  private setDimMask(parcel: Parcel | null): void {
    const source = this.map.getSource<GeoJSONSource>(SOURCE.dim);
    source?.setData(dimMask(parcel ? closeRing(openRing(parcel.polygon.coordinates[0])) : null));
  }

  /** A draft arrived from the UI (coordinates, GPS): show it top-down, unless it already sits well in view. */
  private frameDraft(vertices: LngLat[]): void {
    const { map } = this;
    const viewport = this.viewport();
    const center = meanPoint(vertices);
    const padding = explorePose(viewport, center).padding;
    const zoom = clamp(fitZoom(vertices, center[1], viewport, padding, 0, 0, 0.42), ...DRAFT_ZOOM_RANGE);
    const p = map.project(center);
    const inView = p.x > viewport.width * 0.2 && p.x < viewport.width * 0.8 && p.y > viewport.height * 0.15 && p.y < viewport.height * 0.75;
    if (inView && Math.abs(map.getZoom() - zoom) < 0.9 && map.getPitch() < 20) return;
    this.fly({ center, zoom, pitch: 0, bearing: 0, padding }, 'level');
  }

  /**
   * One camera flight. MapLibre's `flyTo` does the path (it eases the centre elevation onto the
   * terrain as DEM tiles arrive, which a hand-rolled animation would not); a camera-update hook
   * reshapes pitch and bearing so a descent stays vertical until the last stretch and then
   * swings up to look across the field, and an ascent levels out before it climbs.
   */
  private fly(pose: CameraPose, shape: FlightShape, onArrive?: () => void): void {
    const { map } = this;
    this.rotateResumeAt = Number.POSITIVE_INFINITY;
    if (this.reduced) {
      this.cut(pose);
      onArrive?.();
      return;
    }
    const from = map.getCenter();
    const duration = flightDurationMs(pose.zoom - map.getZoom(), angularDistance([from.lng, from.lat], pose.center));
    const id = ++this.flightId;
    const pitch0 = map.getPitch();
    const bearing0 = map.getBearing();
    const dPitch = pose.pitch - pitch0;
    const dBearing = shortestAngle(pose.bearing - bearing0);
    if (shape !== 'level' && Math.abs(dPitch) > 1) {
      map.setTransformCameraUpdate((next) => {
        // flyTo interpolates pitch linearly with its progress, so the pitch it proposes tells us how far along it is.
        const k = clamp((next.pitch - pitch0) / dPitch, 0, 1);
        const shaped = shape === 'descend' ? smoothstep(0.5, 1, k) : smoothstep(0, 0.5, k);
        return { pitch: pitch0 + dPitch * shaped, bearing: bearing0 + dBearing * shaped };
      });
    } else {
      map.setTransformCameraUpdate(null);
    }
    this.flying = true;
    setGlobeStatus({ flying: true });
    const onEnd = (e: MapMovementEvent & { flight?: number }) => {
      if (e.flight !== id) return;
      map.off('moveend', onEnd);
      // A newer flight has taken over the camera: its own hook and flag stay.
      if (this.flightId !== id || this.destroyed) return;
      map.setTransformCameraUpdate(null);
      this.flying = false;
      setGlobeStatus({ flying: false });
      this.rotateResumeAt = performance.now() + 600;
      this.rotateRampFrom = 0;
      // Interrupted by the user (a drag, the wheel): they have the camera now.
      if (Math.abs(map.getZoom() - pose.zoom) < 0.05) onArrive?.();
    };
    map.on('moveend', onEnd);
    map.flyTo(
      {
        center: pose.center,
        zoom: pose.zoom,
        pitch: pose.pitch,
        bearing: pose.bearing,
        padding: pose.padding,
        duration,
        easing: shape === 'descend' ? descentEase : easeInOutCubic,
        // Reduced motion is handled above; here the animation is the content.
        essential: true,
      },
      { flight: id },
    );
  }

  /** Reduced motion: no travel. The view changes in place under a short opacity fade. */
  private cut(pose: CameraPose): void {
    const { map, mapEl } = this;
    // Any flight still running is abandoned: its end handler will see a newer id and stand down.
    this.flightId++;
    this.flying = false;
    setGlobeStatus({ flying: false });
    map.setTransformCameraUpdate(null);
    mapEl.classList.add('is-cutting');
    map.jumpTo(pose);
    this.syncTerrain();
    requestAnimationFrame(() => requestAnimationFrame(() => mapEl.classList.remove('is-cutting')));
  }

  private onMotionChange(): void {
    setGlobeStatus({ reducedMotion: this.reduced });
    if (!this.ready) return;
    if (this.reduced) {
      this.stopRotation();
      if (this.flying) this.map.stop();
    } else if (this.view === 'hero') {
      this.startRotation();
    }
  }

  // --- auto-rotation ---------------------------------------------------------------------------

  private startRotation(): void {
    if (this.rotateRaf || this.reduced) return;
    this.rotateLast = 0;
    this.rotateRampFrom = 0;
    if (!Number.isFinite(this.rotateResumeAt) && !this.pointerDown && !this.flying) this.rotateResumeAt = 0;
    this.rotateRaf = requestAnimationFrame(this.spin);
  }

  private stopRotation(): void {
    cancelAnimationFrame(this.rotateRaf);
    this.rotateRaf = 0;
  }

  /** Turns the globe by elapsed time, so a slow frame makes a bigger step instead of a slower planet. */
  private spin = (now: number): void => {
    this.rotateRaf = requestAnimationFrame(this.spin);
    const dt = this.rotateLast ? Math.min(now - this.rotateLast, 50) : 0;
    this.rotateLast = now;
    if (this.view !== 'hero' || this.flying || this.pointerDown || now < this.rotateResumeAt || document.hidden) {
      this.rotateRampFrom = 0;
      return;
    }
    if (!this.rotateRampFrom) this.rotateRampFrom = now;
    // Ease back in after an interaction rather than snapping to full speed.
    const speed = ROTATE_DEG_PER_S * smoothstep(0, ROTATE_RAMP_MS, now - this.rotateRampFrom);
    const c = this.map.getCenter();
    // The planet turns eastward, so the longitude under a fixed camera falls.
    this.map.jumpTo({ center: [c.lng - (speed * dt) / 1000, c.lat] });
  };

  // ---------------------------------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------------------------------

  private applyLayers(initial: boolean): void {
    const { layers, timeline } = this.state;
    this.imagery.set(this.imageryLook(), initial ? 0 : 500);
    this.syncTerrain();
    this.labels.setVisible(layers.base.labels);
    this.overlay.set(layers.overlay, layers.overlayOpacity, timeline.cursor);
    this.renderCredits();
  }

  /** Runs on every zoom frame, so it only compares two numbers unless a threshold is crossed. */
  private onZoom = (): void => {
    this.syncTerrain();
    const sharp = this.imagery.sharpAt(this.map.getZoom());
    if (sharp !== this.sharpCredited) this.renderCredits();
  };

  private syncTerrain = (): void => {
    if (!this.ready) return;
    const zoom = this.map.getZoom();
    const want = this.state.layers.base.terrain && this.view !== 'hero' && zoom >= (this.terrainOn ? TERRAIN_OFF_ZOOM : TERRAIN_ON_ZOOM);
    if (want === this.terrainOn) return;
    this.terrainOn = want;
    this.map.setTerrain(want ? { source: SOURCE.dem, exaggeration: TERRAIN_EXAGGERATION } : null);
    setGlobeStatus({ terrain: want });
    this.renderCredits();
  };

  // ---------------------------------------------------------------------------------------------
  // Parcel colour (State 4)
  // ---------------------------------------------------------------------------------------------

  /** The series that paints the parcel: the focused HUD branch if it has map paint, else the chosen metric. */
  private paintSeries(): Series | null {
    const { telemetry, focusBranch, layers } = this.state;
    if (!telemetry) return null;
    if (focusBranch) {
      const focused = primarySeries(telemetry.branches[focusBranch]);
      if (focused && paintForSeries(focused)) return focused;
    }
    const key = layers.parcelMetric;
    if (!key) return null;
    for (const id of BRANCHES) {
      const hit = telemetry.branches[id]?.series.find((s) => s.key === key);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * In-memory and synchronous: one binary search in the series, one colour lookup, and a DOM
   * write only when the colour or its texture actually changes.
   */
  private recolour(): void {
    if (!this.ready || !this.state.parcel) return;
    const { telemetry, timeline } = this.state;
    const series = this.paintSeries();
    const reading = series ? parcelReadingAt(series, timeline.cursor) : null;
    let color: string | null = null;
    let texture: FillTexture = 'none';
    if (series && reading && telemetry) {
      color = reading.color;
      const simulated = telemetry.mode === 'mock' || telemetry.sources[series.sourceId]?.provenance === 'simulated';
      texture = simulated ? 'simulated' : reading.stale || reading.value == null ? 'pending' : 'none';
    }
    const key = `${color}|${texture}`;
    if (key === this.fillKey) return;
    this.fillKey = key;
    this.parcelLayer.setFill({ color, texture });
  }

  // ---------------------------------------------------------------------------------------------
  // Frame, resize, failures, credits
  // ---------------------------------------------------------------------------------------------

  /** Runs after MapLibre has drawn a frame: whatever follows the camera or the terrain is re-projected here. */
  private onRender = (): void => {
    if (this.state.parcel) this.parcelLayer.update();
    if (this.draft.hasDraft) this.draft.render();
  };

  private onResize = (): void => {
    const viewport = this.viewport();
    const ratio = cappedPixelRatio(viewport);
    if (Math.abs(ratio - this.map.getPixelRatio()) > 0.01) this.map.setPixelRatio(ratio);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      if (this.destroyed || this.flying) return;
      const { parcel } = this.state;
      if (this.view === 'parcel' && parcel) this.map.jumpTo(this.parcelPose(parcel));
      else if (this.view === 'hero') {
        const c = this.map.getCenter();
        this.map.jumpTo(heroPose(this.viewport(), [c.lng, c.lat]));
      } else this.map.setPadding(explorePose(this.viewport(), HERO_CENTER).padding);
    }, 160);
  };

  private onError = (e: ErrorEvent): void => {
    const err = e.error as { name?: string; message?: string } | undefined;
    // Missing tiles (a zoom Esri has no imagery for, a date GIBS has no picture for) and requests
    // cancelled by camera movement are normal operation; net.ts already counts real failures.
    if (!err || err.name === 'MissingTileError' || err.name === 'AbortError') return;
    const message = err.message ?? String(err);
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn('[globe]', message);
  };

  /** Attribution for exactly what is on screen: unobtrusive, but never absent. */
  private renderCredits(): void {
    if (!this.ready) return;
    const lang = this.state.lang;
    const zoom = this.map.getZoom();
    this.sharpCredited = this.imagery.sharpAt(zoom);
    const parts: string[] = [`${translate('globe.credits.imagery', lang)}: ${this.imagery.credit(zoom)}`];
    if (this.terrainOn || this.imagery.reliefVisible) parts.push(`${translate('globe.credits.terrain', lang)}: ${CREDIT.terrain}`);
    if (getOverlay(this.state.layers.overlay).gibsLayer) parts.push(`${translate('globe.credits.overlay', lang)}: ${CREDIT.gibs}`);
    if (this.labelsCredit) parts.push(`${translate('globe.credits.labels', lang)}: ${this.labelsCredit}`);
    parts.push('MapLibre');
    const text = parts.join('  |  ');
    if (this.creditsEl.textContent === text) return;
    this.creditsEl.textContent = text;
    setGlobeStatus({ credits: text });
  }
}
