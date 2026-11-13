/**
 * Optional reference layer: borders, main roads and place names over the imagery.
 * Vector tiles from OpenFreeMap (key-free, OpenMapTiles schema) give upright, crisp labels in the
 * interface language; if that service does not answer, Esri's raster reference tiles stand in.
 * Nothing here is loaded until the user switches labels on.
 */
import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { Lang } from '@/contracts';
import { fetchText, viaScheduler } from './net';
import { CREDIT, SOURCE } from './style';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const RASTER = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const INK = '#f4f2ec';
const HALO = 'rgba(3, 5, 11, 0.86)';

const nameField = (lang: Lang): ExpressionSpecification => ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']];

function vectorLayers(lang: Lang): LayerSpecification[] {
  const src = SOURCE.labels;
  return [
    {
      id: 'label-boundary',
      type: 'line',
      source: src,
      'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: {
        'line-color': 'rgba(244, 242, 236, 0.62)',
        'line-width': ['case', ['<=', ['get', 'admin_level'], 2], 1.3, 0.7],
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'label-road',
      type: 'line',
      source: src,
      'source-layer': 'transportation',
      minzoom: 8,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(244, 242, 236, 0.42)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 13, 1.4, 17, 3],
      },
    },
    {
      id: 'label-road-name',
      type: 'symbol',
      source: src,
      'source-layer': 'transportation_name',
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'text-field': nameField(lang),
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-letter-spacing': 0.04,
      },
      paint: { 'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 1.4, 'text-opacity': 0.85 },
    },
    {
      id: 'label-place',
      type: 'symbol',
      source: src,
      'source-layer': 'place',
      filter: [
        'any',
        ['==', ['get', 'class'], 'country'],
        ['all', ['==', ['get', 'class'], 'state'], ['>=', ['zoom'], 4]],
        ['all', ['==', ['get', 'class'], 'city'], ['>=', ['zoom'], 4]],
        ['all', ['==', ['get', 'class'], 'town'], ['>=', ['zoom'], 8]],
        ['all', ['match', ['get', 'class'], ['village', 'suburb', 'hamlet'], true, false], ['>=', ['zoom'], 11]],
      ],
      layout: {
        'text-field': nameField(lang),
        'text-font': ['match', ['get', 'class'], ['country', 'city'], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]],
        'text-size': ['match', ['get', 'class'], 'country', 15, 'state', 12, 'city', 14, 'town', 12, 11],
        'text-max-width': 8,
        'text-padding': 6,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 20],
      },
      paint: { 'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 1.6 },
    },
  ] as LayerSpecification[];
}

const RASTER_LAYER = 'label-raster';

export class Labels {
  private mode: 'none' | 'loading' | 'vector' | 'raster' = 'none';
  private wanted = false;
  private layerIds: string[] = [];

  constructor(
    private readonly map: MapLibreMap,
    private lang: Lang,
    private readonly onMode: (credit: string | null) => void,
  ) {}

  setVisible(visible: boolean): void {
    this.wanted = visible;
    if (visible && this.mode === 'none') void this.load();
    else this.apply();
  }

  setLang(lang: Lang): void {
    if (lang === this.lang) return;
    this.lang = lang;
    if (this.mode !== 'vector') return;
    for (const id of ['label-place', 'label-road-name']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'text-field', nameField(lang));
    }
  }

  private apply(): void {
    for (const id of this.layerIds) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', this.wanted ? 'visible' : 'none');
    }
    this.onMode(!this.wanted ? null : this.mode === 'vector' ? CREDIT.labels : this.mode === 'raster' ? CREDIT.labelsRaster : null);
  }

  private async load(): Promise<void> {
    this.mode = 'loading';
    try {
      const tilejson = JSON.parse(await fetchText(TILEJSON)) as { tiles?: string[]; maxzoom?: number };
      if (!tilejson.tiles?.length) throw new Error('OpenFreeMap TileJSON lists no tiles');
      this.map.addSource(SOURCE.labels, {
        type: 'vector',
        tiles: tilejson.tiles.map(viaScheduler),
        maxzoom: tilejson.maxzoom ?? 14,
        attribution: CREDIT.labels,
      });
      const layers = vectorLayers(this.lang);
      for (const layer of layers) this.map.addLayer(layer);
      this.layerIds = layers.map((l) => l.id);
      this.mode = 'vector';
    } catch {
      this.map.addSource(SOURCE.labelsRaster, { type: 'raster', tiles: [viaScheduler(RASTER)], tileSize: 256, maxzoom: 13, attribution: CREDIT.labelsRaster });
      this.map.addLayer({ id: RASTER_LAYER, type: 'raster', source: SOURCE.labelsRaster, paint: { 'raster-fade-duration': 200 } });
      this.layerIds = [RASTER_LAYER];
      this.mode = 'raster';
    }
    this.apply();
  }
}
