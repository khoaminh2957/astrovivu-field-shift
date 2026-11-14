/**
 * Demo-field beacons: one focusable button per offered demo field, pinned to the globe.
 * DOM markers rather than a GL layer because there are only a few of them, they must be reachable by
 * keyboard, and MapLibre already hides markers that are on the far side of the planet.
 */
import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import type { Lang, SampleParcel } from '@/contracts';
import { pick } from '@/contracts';
import { translate } from '@/i18n';

interface Beacon {
  parcel: SampleParcel;
  marker: Marker;
  el: HTMLButtonElement;
  title: HTMLSpanElement;
  subtitle: HTMLSpanElement;
}

export class Beacons {
  private beacons: Beacon[] = [];
  private visible = false;

  constructor(
    private readonly map: MapLibreMap,
    parcels: SampleParcel[],
    private readonly onPick: (id: string) => void,
    lang: Lang,
  ) {
    for (const parcel of parcels) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'globe-beacon';
      el.dataset.sample = parcel.id;
      const pulse = document.createElement('span');
      pulse.className = 'globe-beacon__pulse';
      const dot = document.createElement('span');
      dot.className = 'globe-beacon__dot';
      const label = document.createElement('span');
      label.className = 'globe-beacon__label';
      const title = document.createElement('span');
      title.className = 'globe-beacon__title';
      const subtitle = document.createElement('span');
      subtitle.className = 'globe-beacon__subtitle';
      label.append(title, subtitle);
      el.append(pulse, dot, label);
      el.addEventListener('click', (e) => {
        // Keep the click from reaching the map, where it could place a corner or start a zoom.
        e.stopPropagation();
        this.onPick(parcel.id);
      });
      el.addEventListener('dblclick', (e) => e.stopPropagation());
      const marker = new Marker({ element: el, anchor: 'center', opacityWhenCovered: '0' }).setLngLat(parcel.centroid);
      this.beacons.push({ parcel, marker, el, title, subtitle });
    }
    this.setLang(lang);
  }

  setLang(lang: Lang): void {
    for (const b of this.beacons) {
      b.title.textContent = b.parcel.name;
      b.subtitle.textContent = pick(b.parcel.tagline, lang);
      b.el.setAttribute('aria-label', translate('globe.aria.beacon', lang, { name: `${b.parcel.name}, ${b.parcel.place?.label ?? ''}` }));
    }
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const b of this.beacons) {
      if (visible) b.marker.addTo(this.map);
      else b.marker.remove();
    }
  }

  destroy(): void {
    for (const b of this.beacons) b.marker.remove();
    this.beacons = [];
  }
}
