/**
 * The crop table of the country a parcel lies in, for `ModelInput.country`. The files are static
 * (`public/data/crops/country/`, built from the crop atlas by `scripts/crops/country-tables.ts`);
 * only the file of the parcel's country is fetched, and it is kept in the response cache.
 *
 * A country without a table, or one that cannot be told, is not an error: the model then ranks on
 * climate and soil alone, as it did before the tables existed.
 */
import type { CountryCrops, Iso3, Lang, Parcel } from '@/contracts';
import { cached, TTL } from './cache';
import { type CountryIndexFile, type CountryTableFile, expandCountryTable, isCountryTableFile } from './countryTable';
import { viteEnv } from './env';
import { getJson } from './http';

export type CountryTableResult =
  | { status: 'ready'; country: CountryCrops; iso3: Iso3; /** Two-letter code, for a localised country name. */ iso2: string; /** Name as the source writes it. */ name: string; source: string; grown: number }
  /** The country is known (or not) and has no table: `iso2` is what the place gave, when it gave one. */
  | { status: 'missing'; iso2?: string };

export interface CountryLoadOptions {
  signal?: AbortSignal;
  lang?: Lang;
  /** Looks up the place of a point; injected so that this module does not depend on the geocoder. */
  reverseGeocode?: (at: [number, number], lang: Lang) => Promise<{ countryCode?: string } | null>;
}

const base = () => `${viteEnv().BASE_URL ?? '/'}data/crops/country/`;

let index: Promise<CountryIndexFile> | null = null;

/** The list of countries with a table. One request per session; a failed one is tried again next time. */
function loadIndex(signal?: AbortSignal): Promise<CountryIndexFile> {
  index ??= getJson<CountryIndexFile>(`${base()}index.json`, { signal, timeoutMs: 10_000, retries: 2 }).catch((e) => {
    index = null;
    throw e;
  });
  return index;
}

/** Two-letter code of the parcel's country: from its place, else from the geocoder at its centre. */
async function iso2Of(parcel: Pick<Parcel, 'centroid' | 'place'>, opts: CountryLoadOptions): Promise<string | undefined> {
  const known = parcel.place?.countryCode?.toUpperCase();
  if (known) return known;
  const place = await opts.reverseGeocode?.(parcel.centroid, opts.lang ?? 'en').catch(() => null);
  return place?.countryCode?.toUpperCase();
}

export async function loadCountryCrops(parcel: Pick<Parcel, 'centroid' | 'place'>, opts: CountryLoadOptions = {}): Promise<CountryTableResult> {
  const idx = await loadIndex(opts.signal);
  const wanted = parcel.place?.iso3?.toUpperCase();
  const byIso3 = wanted ? Object.entries(idx.countries).find(([, c]) => c.iso3 === wanted) : undefined;
  const iso2 = byIso3?.[0] ?? (await iso2Of(parcel, opts));
  const entry = iso2 ? idx.countries[iso2] : undefined;
  if (!entry || !iso2) return { status: 'missing', ...(iso2 ? { iso2 } : {}) };
  // The hash is part of the key: a rebuilt table is fetched again, an unchanged one is not.
  const file = await cached<CountryTableFile>(`country:${entry.iso3}:${entry.hash}`, TTL.month, async () => {
    const f = await getJson<unknown>(`${base()}${entry.iso3}.json`, { signal: opts.signal, timeoutMs: 15_000, retries: 2 });
    if (!isCountryTableFile(f) || f.iso3 !== entry.iso3) throw new Error(`The crop table of ${entry.iso3} is not in the expected form`);
    return f;
  });
  return { status: 'ready', country: expandCountryTable(file), iso3: entry.iso3, iso2, name: entry.name, source: idx.source, grown: entry.grown };
}
