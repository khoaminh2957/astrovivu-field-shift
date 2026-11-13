/**
 * The regional NASA overlay: one GIBS raster that follows the timeline cursor.
 *
 * Two raster layers act as a front and a back buffer. A new date is loaded into the hidden back
 * buffer; once its tiles are in, the buffers cross-fade and swap. Scrubbing therefore never
 * blanks the overlay and never queues work: a date that is superseded while still loading is
 * simply replaced in the back buffer.
 */
import type { Map as MapLibreMap, MapSourceDataEvent, RasterTileSource } from 'maplibre-gl';
import type { ISODate, OverlayId } from '@/contracts';
import { addDays } from '@/lib/time';
import { fetchText, viaScheduler } from './net';
import {
  fallbackTimeDomain,
  getOverlay,
  overlayDomainUrl,
  overlayTileUrl,
  parseTimeDomain,
  resolveOverlayDate,
  type GlobeOverlayInfo,
  type OverlayDate,
  type TimeDomain,
} from './overlays';
import { setGlobeStatus } from './status';
import { CREDIT, LAYER, SOURCE } from './style';
import { linear, tween, type Tween } from './tween';

/** Wait this long after the cursor stops before asking for another date. */
const DEBOUNCE_MS = 140;
const FADE_MS = 320;
/** The only motion kept under reduced motion is a short opacity fade (design system, --dur-fade). */
const FADE_REDUCED_MS = 120;
/** Start the cross-fade anyway if a slow tile keeps the back buffer from reporting loaded. */
const LOAD_TIMEOUT_MS = 2500;
/**
 * A different product has nothing to hold on to (the old picture is another quantity), so it
 * comes in almost at once and fills tile by tile instead of waiting for the last tile.
 */
const PRODUCT_SWITCH_DELAY_MS = 300;
/**
 * GIBS tiles are 256 px, declared here as 512: MapLibre then asks for one zoom level less, a
 * quarter of the requests. These are semi-transparent context layers over coarse grids, and a
 * date change that needs 15 tiles instead of 60 is the difference between following the
 * scrubber and trailing it.
 */
const OVERLAY_TILE_SIZE = 512;
/** Days of history whose dates we ask GIBS about: the timeline window plus slack. */
const DOMAIN_LOOKBACK_DAYS = 400;

interface Buffer {
  source: string;
  layer: string;
  /** Which overlay product the source was created for (fixes its max zoom). */
  product: OverlayId | null;
  key: string | null;
  opacity: number;
}

interface Target {
  info: GlobeOverlayInfo;
  date: ISODate;
  resolved: OverlayDate;
}

const keyOf = (t: Target): string => `${t.info.id}@${t.date}`;

export interface OverlayControllerOptions {
  /** Layer the overlay is inserted beneath. */
  beforeLayer: () => string | undefined;
  today: () => ISODate;
  reducedMotion: () => boolean;
}

export class OverlayController {
  private buffers: [Buffer, Buffer] = [
    { source: SOURCE.overlayA, layer: LAYER.overlayA, product: null, key: null, opacity: 0 },
    { source: SOURCE.overlayB, layer: LAYER.overlayB, product: null, key: null, opacity: 0 },
  ];
  private front = 0;
  private id: OverlayId = 'none';
  private cursor: ISODate | null = null;
  private opacity = 0.7;
  private domains = new Map<OverlayId, Promise<TimeDomain>>();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private fade: Tween | null = null;
  /** What the back buffer is loading, if anything. */
  private incoming: Target | null = null;
  /** Hold the cross-fade until the back buffer has every tile (date change) or not (product switch). */
  private waitForLoad = true;
  /** Requested while a fade was running; applied when it ends. */
  private queued: Target | null | undefined;
  private generation = 0;
  private destroyed = false;

  constructor(
    private readonly map: MapLibreMap,
    private readonly opts: OverlayControllerOptions,
  ) {
    map.on('sourcedata', this.onSourceData);
  }

  /** Imperative entry point: called on every relevant store change, cheap when nothing differs. */
  set(id: OverlayId, opacity: number, cursor: ISODate): void {
    if (this.destroyed) return;
    if (opacity !== this.opacity) {
      this.opacity = opacity;
      if (!this.fade) this.paint(this.buffers[this.front], this.buffers[this.front].key ? opacity : 0);
    }
    const idChanged = id !== this.id;
    const cursorChanged = cursor !== this.cursor;
    this.id = id;
    this.cursor = cursor;
    if (idChanged) {
      // Switching product is a deliberate click: answer at once.
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = null;
      void this.resolve();
    } else if (cursorChanged && id !== 'none' && !this.debounce) {
      // Not reset by later changes: during a long drag the overlay is re-resolved at this
      // interval with wherever the cursor is by then, instead of only once the drag ends.
      this.debounce = setTimeout(() => {
        this.debounce = null;
        void this.resolve();
      }, DEBOUNCE_MS);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.map.off('sourcedata', this.onSourceData);
    if (this.debounce) clearTimeout(this.debounce);
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.fade?.cancel();
  }

  private domainFor(info: GlobeOverlayInfo): Promise<TimeDomain> {
    let known = this.domains.get(info.id);
    if (!known) {
      const today = this.opts.today();
      const start = addDays(today, -DOMAIN_LOOKBACK_DAYS);
      known = fetchText(overlayDomainUrl(info, start, today))
        .then((xml) => {
          const domain = parseTimeDomain(xml);
          return domain.length > 0 ? domain : fallbackTimeDomain(info, start, today);
        })
        // The list of dates is a convenience: without it we assume the usual cadence and delay.
        .catch(() => fallbackTimeDomain(info, start, today));
      this.domains.set(info.id, known);
    }
    return known;
  }

  private async resolve(): Promise<void> {
    const generation = ++this.generation;
    const id = this.id;
    if (id === 'none' || !this.cursor) {
      setGlobeStatus({ overlay: { id: 'none', date: null, ageDays: null, stale: false, state: 'off' } });
      this.show(null);
      return;
    }
    const info = getOverlay(id);
    const domain = await this.domainFor(info);
    // The user may have scrubbed on, or switched product, while the date list was in flight.
    if (generation !== this.generation || this.destroyed || !this.cursor) return;
    const resolved = resolveOverlayDate(info, domain, this.cursor);
    if (!resolved.date) {
      setGlobeStatus({ overlay: { id, date: null, ageDays: resolved.ageDays, stale: true, state: 'no-data' } });
      this.show(null);
      return;
    }
    this.show({ info, date: resolved.date, resolved });
  }

  private show(target: Target | null): void {
    const front = this.buffers[this.front];
    const key = target ? keyOf(target) : null;
    if (this.fade) {
      this.queued = target;
      return;
    }
    if (this.incoming) {
      if (target && target.info.id === this.incoming.info.id) {
        // A date of the same product is on its way in. Let it land, then go to the newest
        // request: the overlay steps through a long scrub instead of restarting on every move
        // and showing nothing until the cursor stops.
        this.queued = keyOf(this.incoming) === key ? undefined : target;
        return;
      }
      this.cancelIncoming();
    }
    if (key === front.key) {
      if (target) this.reportReady(target);
      return;
    }
    if (!target) {
      this.crossFade(null);
      return;
    }

    const back = this.buffers[1 - this.front];
    const productSwitch = !front.key || front.product !== target.info.id;
    this.prepare(back, target, productSwitch);
    this.incoming = target;
    this.waitForLoad = !productSwitch;
    setGlobeStatus({
      overlay: { id: target.info.id, date: target.date, ageDays: target.resolved.ageDays, stale: target.resolved.stale, state: 'loading' },
    });
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => this.crossFade(target), productSwitch ? PRODUCT_SWITCH_DELAY_MS : LOAD_TIMEOUT_MS);
  }

  private reportReady(target: Target): void {
    setGlobeStatus({
      overlay: { id: target.info.id, date: target.date, ageDays: target.resolved.ageDays, stale: target.resolved.stale, state: 'ready' },
    });
  }

  private cancelIncoming(): void {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    if (!this.incoming) return;
    this.incoming = null;
    const back = this.buffers[1 - this.front];
    back.key = null;
    this.setVisible(back, false);
  }

  private prepare(buffer: Buffer, target: Target, productSwitch: boolean): void {
    const { map } = this;
    const tiles = [viaScheduler(overlayTileUrl(target.info, target.date))];
    const source = map.getSource<RasterTileSource>(buffer.source);
    if (source && buffer.product === target.info.id) {
      source.setTiles(tiles);
    } else {
      if (map.getLayer(buffer.layer)) map.removeLayer(buffer.layer);
      if (source) map.removeSource(buffer.source);
      map.addSource(buffer.source, {
        type: 'raster',
        tiles,
        tileSize: OVERLAY_TILE_SIZE,
        maxzoom: target.info.maxZoom,
        attribution: CREDIT.gibs,
      });
      map.addLayer(
        {
          id: buffer.layer,
          type: 'raster',
          source: buffer.source,
          paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 }, 'raster-resampling': target.info.resampling },
        },
        this.opts.beforeLayer(),
      );
      buffer.product = target.info.id;
    }
    // A new date arrives complete inside the hidden buffer, so its tiles need no fade of their
    // own; a new product fills in on screen, where each tile should ease in.
    map.setPaintProperty(buffer.layer, 'raster-fade-duration', productSwitch ? 280 : 0);
    buffer.key = `${target.info.id}@${target.date}`;
    buffer.opacity = 0;
    this.setVisible(buffer, true);
    this.paint(buffer, 0);
  }

  private onSourceData = (e: MapSourceDataEvent): void => {
    if (!this.incoming || this.fade || !this.waitForLoad) return;
    const back = this.buffers[1 - this.front];
    if (e.sourceId !== back.source) return;
    // `setTiles` reports loaded for an instant before the reload starts; only trust tile events.
    if (!e.tile) return;
    if (this.map.isSourceLoaded(back.source)) this.crossFade(this.incoming);
  };

  /** Fades the back buffer in (or everything out when `target` is null) and swaps the buffers. */
  private crossFade(target: Target | null): void {
    if (this.destroyed || this.fade) return;
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    this.incoming = null;
    const front = this.buffers[this.front];
    const back = this.buffers[1 - this.front];
    const from = front.opacity;
    const duration = this.opts.reducedMotion() ? FADE_REDUCED_MS : FADE_MS;
    this.fade = tween(
      duration,
      (t) => {
        this.paint(front, from * (1 - t));
        if (target) this.paint(back, this.opacity * t);
      },
      linear,
    );
    void this.fade.done.then(() => {
      this.fade = null;
      if (this.destroyed) return;
      front.key = null;
      this.setVisible(front, false);
      if (target) {
        this.front = 1 - this.front;
        this.reportReady(target);
      }
      const queued = this.queued;
      this.queued = undefined;
      if (queued !== undefined) this.show(queued);
    });
  }

  private paint(buffer: Buffer, opacity: number): void {
    buffer.opacity = opacity;
    if (this.map.getLayer(buffer.layer)) this.map.setPaintProperty(buffer.layer, 'raster-opacity', opacity);
  }

  /** A hidden buffer must not keep requesting tiles as the camera moves. */
  private setVisible(buffer: Buffer, visible: boolean): void {
    if (this.map.getLayer(buffer.layer)) this.map.setLayoutProperty(buffer.layer, 'visibility', visible ? 'visible' : 'none');
  }
}
