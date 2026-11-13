/**
 * Key-free geocoding with CORS (verified 2026-11-14):
 *   forward  Nominatim (OSM, ODbL; 1 request/s, so the host limiter allows one) → Photon fallback
 *   reverse  BigDataCloud client-side endpoint in the browser → Nominatim fallback and in Node
 * Open-Meteo geocoding was tried and rejected for search: "Dak Lak" returned nothing.
 */
import type { Lang, LngLat, PlaceHit, PlaceInfo } from '@/contracts';
import { cached, ck, TTL } from '../cache';
import { isNode } from '../env';
import { getJson } from '../http';

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
}

/** "12.8, 108.2" / "12.8 108.2" (lat, lng) → a hit without any network call. */
export function parseCoordinates(q: string): LngLat | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
}

const admin1Of = (a?: Record<string, string>) => a?.state ?? a?.province ?? a?.region ?? a?.county;

export async function nominatimSearch(query: string, lang: Lang, signal?: AbortSignal): Promise<PlaceHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=6&addressdetails=1&accept-language=${lang}`;
  const hits = await cached(`nomsearch:${lang}:${query.toLowerCase()}`, TTL.month, () =>
    getJson<NominatimHit[]>(url, { signal, timeoutMs: 10_000, retries: 1, headers: isNode ? { 'User-Agent': 'astrovivu-field-shift/0.1' } : {} }),
  );
  return hits.map((h) => ({
    label: h.display_name,
    location: [Number(h.lon), Number(h.lat)] as LngLat,
    country: h.address?.country,
    admin1: admin1Of(h.address),
  }));
}

interface PhotonResponse {
  features: { geometry: { coordinates: [number, number] }; properties: { name?: string; country?: string; state?: string; city?: string } }[];
}

export async function photonSearch(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const j = await getJson<PhotonResponse>(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6`, { signal, timeoutMs: 10_000, retries: 1 });
  return j.features.map((f) => ({
    label: [f.properties.name, f.properties.city, f.properties.state, f.properties.country].filter(Boolean).join(', '),
    location: f.geometry.coordinates,
    country: f.properties.country,
    admin1: f.properties.state,
  }));
}

interface BdcResponse {
  countryName?: string;
  countryCode?: string;
  principalSubdivision?: string;
  city?: string;
  locality?: string;
}

export async function reverse(at: LngLat, lang: Lang, signal?: AbortSignal): Promise<PlaceInfo | null> {
  const [lon, lat] = at;
  return cached(`reverse:${lang}:${ck(lon)},${ck(lat)}`, TTL.month, async () => {
    if (!isNode) {
      try {
        const b = await getJson<BdcResponse>(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}&localityLanguage=${lang}`,
          { signal, timeoutMs: 8_000, retries: 1 },
        );
        if (b.countryName) {
          const parts = [b.locality || b.city, b.principalSubdivision, b.countryName].filter((x, i, a) => x && a.indexOf(x) === i);
          return { label: parts.join(', '), country: b.countryName, countryCode: b.countryCode, admin1: b.principalSubdivision };
        }
      } catch {
        // fall through to Nominatim
      }
    }
    const n = await getJson<NominatimHit & { error?: string }>(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&format=jsonv2&zoom=10&accept-language=${lang}`,
      { signal, timeoutMs: 10_000, retries: 1, headers: isNode ? { 'User-Agent': 'astrovivu-field-shift/0.1' } : {} },
    );
    if (n.error || !n.address) return null;
    const a = n.address;
    const parts = [a.village ?? a.town ?? a.city ?? a.county, admin1Of(a), a.country].filter((x, i, arr) => x && arr.indexOf(x) === i);
    return { label: parts.join(', '), country: a.country, countryCode: a.country_code?.toUpperCase(), admin1: admin1Of(a) };
  });
}
