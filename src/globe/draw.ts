/**
 * Drawing and adjusting a field boundary on the map.
 *
 * The draft in the mission store is the single truth. The UI may replace it at any time (a
 * square from coordinates or GPS); this editor renders whatever is there, lets the user tap
 * corners (`quad`), drag corners, insert corners at edge midpoints, remove them, slide the whole
 * shape, and writes every change back through `makeDraft`, so `vertices`, `closed` and `areaHa`
 * always agree.
 *
 * Handles are DOM markers and the outline is SVG re-projected in the same frame, so a dragged
 * corner and the line attached to it never separate (a GeoJSON layer would trail by a frame or
 * two while its tiles are rebuilt in the worker).
 */
import { Marker, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import type { DrawMode, Lang, LngLat, ParcelDraft } from '@/contracts';
import { translate } from '@/i18n';
import { MIN_VERTICES, QUAD_CORNERS, makeDraft, meanPoint, midpoint, openRing, orderRing, selfIntersects } from './draft';
import { projectRing, ringPath, svgEl, type ScreenRing } from './svg';

/** Corners tapped from further out than this would outline a district, not a field. */
export const MIN_DRAW_ZOOM = 12.5;
/** At most this often is a drag written to the store; listeners re-render on each write. */
const COMMIT_INTERVAL_MS = 60;

type HandleKind = 'vertex' | 'mid' | 'move';

interface Handle {
  kind: HandleKind;
  index: number;
  marker: Marker;
  el: HTMLButtonElement;
}

export interface DraftEditorHost {
  setDraft(draft: ParcelDraft): void;
  lang(): Lang;
  /** A draft arrived from outside (coordinates, GPS): bring it into view. */
  frameDraft(vertices: LngLat[]): void;
  /** A corner was tapped from too far out: go to field scale there instead. */
  zoomToField(at: LngLat): void;
}

export class DraftEditor {
  private vertices: LngLat[] = [];
  private closed = false;
  private draftMode: DrawMode = 'quad';
  private drawMode: DrawMode | null = null;
  private active = false;
  private handles: Handle[] = [];
  private lastWritten: ParcelDraft | null = null;
  private pointer: LngLat | null = null;
  private dragging: Handle | null = null;
  private moveOrigin: { at: LngLat; vertices: LngLat[] } | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCommit = 0;
  private screen: ScreenRing | undefined;

  private readonly group: SVGGElement;
  private readonly fill: SVGPathElement;
  private readonly line: SVGPathElement;
  private readonly rubber: SVGPathElement;

  constructor(
    private readonly map: MapLibreMap,
    svg: SVGSVGElement,
    private readonly host: DraftEditorHost,
  ) {
    this.group = svgEl('g', { class: 'globe-draft' }, svg);
    this.fill = svgEl('path', { class: 'globe-draft__fill' }, this.group);
    this.rubber = svgEl('path', { class: 'globe-draft__rubber' }, this.group);
    this.line = svgEl('path', { class: 'globe-draft__line' }, this.group);
    this.group.style.display = 'none';
    map.on('click', this.onClick);
    map.on('mousemove', this.onPointerMove);
    map.on('mouseout', this.onPointerOut);
  }

  /** True while the user is still placing corners: the map should not react to clicks itself. */
  get placing(): boolean {
    return this.active && this.drawMode === 'quad' && !this.closed;
  }

  get hasDraft(): boolean {
    return this.active;
  }

  /** Called on every store change of `draft` or `drawMode`. */
  sync(draft: ParcelDraft | null, drawMode: DrawMode | null): void {
    this.drawMode = drawMode;
    if (draft === this.lastWritten && draft !== null) {
      this.updatePlacingUi();
      return;
    }
    if (!draft) {
      // `quad` with no draft yet is a legal start: the first tap creates it.
      this.adopt([], false, drawMode ?? 'quad', drawMode !== null);
      this.lastWritten = null;
      return;
    }
    const vertices = openRing(draft.vertices);
    this.adopt(vertices, draft.closed && vertices.length >= MIN_VERTICES, draft.mode, true);
    // Normalise what came in (a repeated closing vertex, a stale area) so the store never
    // holds a draft whose area disagrees with its corners.
    const clean = makeDraft(draft.mode, vertices, draft.closed);
    if (clean.vertices.length !== draft.vertices.length || clean.areaHa !== draft.areaHa || clean.closed !== draft.closed) {
      this.lastWritten = clean;
      this.host.setDraft(clean);
    } else {
      this.lastWritten = draft;
    }
    if (this.closed && vertices.length >= MIN_VERTICES) this.host.frameDraft(vertices);
  }

  /** Re-projects outline and rubber band. Call once per frame in which the camera moved. */
  render(): void {
    if (!this.active) return;
    const n = this.vertices.length;
    if (n === 0) {
      this.fill.setAttribute('d', '');
      this.line.setAttribute('d', '');
      this.rubber.setAttribute('d', '');
      return;
    }
    const screen = (this.screen = projectRing(this.map, this.vertices, this.screen));
    if (!screen.finite) {
      this.group.style.display = 'none';
      return;
    }
    this.group.style.display = '';
    const d = ringPath(screen, this.closed);
    this.line.setAttribute('d', n >= 2 ? d : '');
    this.fill.setAttribute('d', this.closed ? d : '');
    this.group.classList.toggle('is-invalid', this.closed && selfIntersects(this.vertices));

    // While placing corners, a dashed line runs from the last corner to the pointer and back
    // to the first, previewing the shape the next tap would make.
    if (this.placing && this.pointer) {
      const p = this.map.project(this.pointer);
      const last = n - 1;
      let band = `M${screen.points[last * 2].toFixed(1)} ${screen.points[last * 2 + 1].toFixed(1)}L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      if (n >= 2) band += `L${screen.points[0].toFixed(1)} ${screen.points[1].toFixed(1)}`;
      this.rubber.setAttribute('d', band);
    } else {
      this.rubber.setAttribute('d', '');
    }
  }

  /** Relabels the handles after a language switch. */
  relabel(): void {
    for (const h of this.handles) this.label(h);
  }

  destroy(): void {
    this.map.off('click', this.onClick);
    this.map.off('mousemove', this.onPointerMove);
    this.map.off('mouseout', this.onPointerOut);
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.clearHandles();
    this.setPlacingUi(false);
    this.group.remove();
  }

  // -------------------------------------------------------------------------------------------

  private adopt(vertices: LngLat[], closed: boolean, mode: DrawMode, active: boolean): void {
    this.vertices = vertices.map((v) => [v[0], v[1]] as LngLat);
    this.closed = closed;
    this.draftMode = mode;
    this.active = active;
    this.pointer = null;
    this.group.style.display = active ? '' : 'none';
    this.rebuildHandles();
    this.updatePlacingUi();
    this.render();
  }

  private updatePlacingUi(): void {
    this.setPlacingUi(this.placing);
  }

  private setPlacingUi(on: boolean): void {
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
    // Two quick taps are two corners, not a zoom.
    if (on) this.map.doubleClickZoom.disable();
    else this.map.doubleClickZoom.enable();
    if (!on) this.rubber.setAttribute('d', '');
  }

  private commit(immediate: boolean): void {
    const write = () => {
      this.commitTimer = null;
      this.lastCommit = performance.now();
      const draft = makeDraft(this.draftMode, this.vertices, this.closed);
      this.lastWritten = draft;
      this.host.setDraft(draft);
    };
    if (this.commitTimer) clearTimeout(this.commitTimer);
    const wait = COMMIT_INTERVAL_MS - (performance.now() - this.lastCommit);
    if (immediate || wait <= 0) write();
    else this.commitTimer = setTimeout(write, wait);
  }

  private onClick = (e: MapMouseEvent): void => {
    if (!this.placing) return;
    const target = e.originalEvent.target as Element | null;
    if (target?.closest('.maplibregl-marker')) return;
    const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
    if (this.map.getZoom() < MIN_DRAW_ZOOM) {
      this.host.zoomToField(at);
      return;
    }
    this.vertices.push(at);
    if (this.vertices.length >= QUAD_CORNERS) {
      this.vertices = orderRing(this.vertices);
      this.closed = true;
    }
    this.rebuildHandles();
    this.updatePlacingUi();
    this.render();
    this.commit(true);
  };

  private onPointerMove = (e: MapMouseEvent): void => {
    if (!this.placing || this.vertices.length === 0) return;
    this.pointer = [e.lngLat.lng, e.lngLat.lat];
    this.render();
  };

  private onPointerOut = (): void => {
    if (!this.pointer) return;
    this.pointer = null;
    this.render();
  };

  // --- handles -------------------------------------------------------------------------------

  private clearHandles(keep?: Handle): void {
    for (const h of this.handles) if (h !== keep) h.marker.remove();
    this.handles = keep ? [keep] : [];
  }

  private rebuildHandles(keep?: Handle): void {
    this.clearHandles(keep);
    if (!this.active) return;
    const n = this.vertices.length;
    for (let i = 0; i < n; i++) {
      if (keep && keep.kind === 'vertex' && keep.index === i) continue;
      this.addHandle('vertex', i, this.vertices[i]);
    }
    if (n >= 2) {
      const edges = this.closed ? n : n - 1;
      // Midpoints only once the shape is closed: while corners are being tapped they would
      // sit exactly where the next tap is likely to land.
      if (this.closed) for (let i = 0; i < edges; i++) this.addHandle('mid', i, midpoint(this.vertices[i], this.vertices[(i + 1) % n]));
    }
    if (this.closed && n >= MIN_VERTICES) this.addHandle('move', 0, meanPoint(this.vertices));
  }

  private addHandle(kind: HandleKind, index: number, at: LngLat): Handle {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `globe-handle globe-handle--${kind}`;
    el.appendChild(document.createElement('span'));
    const marker = new Marker({ element: el, draggable: true, anchor: 'center', subpixelPositioning: true, opacityWhenCovered: '1' })
      .setLngLat(at)
      .addTo(this.map);
    const handle: Handle = { kind, index, marker, el };
    this.label(handle);
    marker.on('dragstart', () => this.onDragStart(handle));
    marker.on('drag', () => this.onDrag(handle));
    marker.on('dragend', () => this.onDragEnd(handle));
    el.addEventListener('keydown', (e) => this.onKey(handle, e));
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (handle.kind === 'vertex') this.removeVertex(handle.index);
    });
    // A click on a handle must not reach the map as "place a corner here".
    el.addEventListener('click', (e) => e.stopPropagation());
    this.handles.push(handle);
    return handle;
  }

  private label(h: Handle): void {
    const lang = this.host.lang();
    const n = this.vertices.length;
    h.el.setAttribute(
      'aria-label',
      h.kind === 'vertex'
        ? translate('globe.aria.vertex', lang, { n: h.index + 1, total: n })
        : h.kind === 'mid'
          ? translate('globe.aria.midpoint', lang, { a: h.index + 1, b: ((h.index + 1) % n) + 1 })
          : translate('globe.aria.move', lang),
    );
  }

  private onDragStart(h: Handle): void {
    this.dragging = h;
    h.el.classList.add('is-dragging');
    if (h.kind === 'mid') {
      // The midpoint becomes a real corner under the finger; the drag carries on uninterrupted.
      const at = h.marker.getLngLat();
      this.vertices.splice(h.index + 1, 0, [at.lng, at.lat]);
      h.kind = 'vertex';
      h.index += 1;
      h.el.className = 'globe-handle globe-handle--vertex is-dragging';
      this.rebuildHandles(h);
    } else if (h.kind === 'move') {
      const at = h.marker.getLngLat();
      this.moveOrigin = { at: [at.lng, at.lat], vertices: this.vertices.map((v) => [v[0], v[1]] as LngLat) };
    }
  }

  private onDrag(h: Handle): void {
    const at = h.marker.getLngLat();
    if (h.kind === 'vertex') {
      this.vertices[h.index] = [at.lng, at.lat];
    } else if (h.kind === 'move' && this.moveOrigin) {
      const dLng = at.lng - this.moveOrigin.at[0];
      const dLat = at.lat - this.moveOrigin.at[1];
      this.vertices = this.moveOrigin.vertices.map((v) => [v[0] + dLng, v[1] + dLat] as LngLat);
    }
    this.placeHandles(h);
    this.render();
    this.commit(false);
  }

  private onDragEnd(h: Handle): void {
    h.el.classList.remove('is-dragging');
    this.dragging = null;
    this.moveOrigin = null;
    this.placeHandles();
    this.render();
    this.commit(true);
  }

  /** Moves every handle (except the one under the finger) to where the vertices now are. */
  private placeHandles(except?: Handle): void {
    const n = this.vertices.length;
    for (const h of this.handles) {
      if (h === except) continue;
      if (h.kind === 'vertex') h.marker.setLngLat(this.vertices[h.index]);
      else if (h.kind === 'mid') h.marker.setLngLat(midpoint(this.vertices[h.index], this.vertices[(h.index + 1) % n]));
      else h.marker.setLngLat(meanPoint(this.vertices));
    }
  }

  private removeVertex(index: number): void {
    if (this.vertices.length <= MIN_VERTICES) return;
    this.vertices.splice(index, 1);
    this.rebuildHandles();
    this.render();
    this.commit(true);
    this.handles.find((h) => h.kind === 'vertex' && h.index === Math.min(index, this.vertices.length - 1))?.el.focus();
  }

  /** Keyboard: arrows nudge by one pixel (ten with Shift), Delete removes a corner, Enter splits an edge. */
  private onKey(h: Handle, e: KeyboardEvent): void {
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key in delta) {
      e.preventDefault();
      e.stopPropagation();
      if (h.kind === 'mid') return;
      const p = this.map.project(h.marker.getLngLat());
      const next = this.map.unproject([p.x + delta[e.key][0], p.y + delta[e.key][1]]);
      if (h.kind === 'move') {
        const from = h.marker.getLngLat();
        this.vertices = this.vertices.map((v) => [v[0] + next.lng - from.lng, v[1] + next.lat - from.lat] as LngLat);
      } else {
        this.vertices[h.index] = [next.lng, next.lat];
      }
      h.marker.setLngLat(next);
      this.placeHandles(h);
      this.render();
      this.commit(false);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && h.kind === 'vertex') {
      e.preventDefault();
      e.stopPropagation();
      this.removeVertex(h.index);
    } else if ((e.key === 'Enter' || e.key === ' ') && h.kind === 'mid') {
      e.preventDefault();
      e.stopPropagation();
      const at = h.marker.getLngLat();
      const index = h.index + 1;
      this.vertices.splice(index, 0, [at.lng, at.lat]);
      this.rebuildHandles();
      this.render();
      this.commit(true);
      this.handles.find((x) => x.kind === 'vertex' && x.index === index)?.el.focus();
    }
  }
}
