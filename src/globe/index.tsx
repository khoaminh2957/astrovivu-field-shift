/**
 * Tier 4 (map): the 3D globe. One MapLibre GL map carries the experience from orbit to a
 * two-hectare field: hero globe, explore, parcel lock, time-synced colouring and NASA overlays.
 * See docs/GLOBE.md for the decisions and the measured performance.
 *
 * The mission UI talks to the map through the mission store only. What is exported here beyond
 * the two components is data and pure helpers: the overlay catalogue for the layer panel, the
 * draft helpers for the dock, the colour functions for legends, and the status of what the map
 * is really showing.
 */
import './strings';

export { GlobeCanvas, flyToPlace, refocusParcel, type GlobeCanvasProps } from './GlobeCanvas';
export { GlobeLab } from './GlobeLab';
export { OVERLAYS, getOverlay, overlayLegendCss, type GlobeOverlayInfo, type LegendStop } from './overlays';
export { draftToParcel, squareDraft, makeDraft, isLockable, draftAreaHa } from './draft';
export { paintForSeries, colorForValue, rampCss, rampPosition, parcelReadingAt, type MetricPaint, type ParcelReading } from './ramps';
export { useGlobeStatus, type GlobeStatus, type OverlayStatus, type ImagerySource } from './status';
export { MIN_DRAW_ZOOM } from './draw';
export type { MotionPref } from './engine';
export { zoomBy, resetNorth, setTilt, fitParcel, locateMe, setMotion, startMeasure, stopMeasure, useMapView, useMeasure, type MapViewState, type MeasureKind, type MeasureState } from './tools';
export { useParcelPaint, type ParcelPaintInfo } from './legend';
export { rasterRampCss } from './fieldRaster';
