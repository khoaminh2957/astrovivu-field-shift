/**
 * Crop atlas: which plants are farmed, where, and how much. Merges FAO EcoCrop, FAOSTAT crop
 * statistics, the FAO commodity definitions, CPC 2.1, MapSPAM 2020 and our curated list into the
 * tables under data/crops/atlas/. Every value is copied or computed from a named source file; the
 * rules live in the modules beside this file and are described in docs/CROP_DATA.md.
 *
 *   npx tsx scripts/crops/atlas/build.ts            download what the cache lacks, then build
 *   npx tsx scripts/crops/atlas/build.ts --offline  build from .cache/atlas/raw only
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanEcoCrop, readEcoCropCsv } from '../parse';
import { slugify } from '../../../src/core/crops/text';
import { COLUMNS, ECONOMICS_COLUMNS, type ColumnDoc } from './columns';
import { buildCrosswalk, buildSpamCrosswalk, spamCropFor, type CropItem, type SpamCrop } from './crosswalk';
import { parseCsvObjects, round, toCsv, type Cell } from './csv';
import { parseCpc, parseFaodefPage, parseGeoNames, parseM49, parseSpamReadme, type FaodefItem } from './definitions';
import { cleanSpecies, type AtlasSpecies } from './ecocrop';
import { readQcl } from './faostat';
import { SOURCES, ensureSources, md5File } from './fetch';
import { COMMONNESS, LEVEL, WINDOW, commonnessFor, latestMean, levelFor, rankOf, type Mean } from './levels';
import { DEFAULT_NATIONAL_FILE, nationalSourcesUsed, readNational, resolveCropCountryRow } from './national';
import { readSpamHarvestedArea, type SpamRegion } from './spam';
import { taxonKey } from './taxa';
import { urbanCandidateRow } from './urban';
import { buildXlsx, countCells, type Sheet } from './xlsx';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'data/crops/atlas');
const CACHE = path.join(ROOT, '.cache/atlas');
const offline = process.argv.includes('--offline');
const log = (s: string) => console.log(s);

const FAOSTAT_SOURCE = 'FAOSTAT QCL';
const SPAM_SOURCE = 'MapSPAM 2020 V2r2';
/** Rows kept per region in the workbook copy of region_crops (the CSV keeps all). */
const WORKBOOK_REGION_TOP = 15;

interface Stat {
  area: Mean | null;
  production: Mean | null;
  yield: Mean | null;
}

interface Country {
  iso3: string;
  name: string;
  areaCode: number;
  totalAreaHa: number;
  itemAreas: Map<number, number>;
}

const list = (xs: readonly (string | number)[]) => xs.join(';');
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fetched = await ensureSources(SOURCES, { root: ROOT, cacheDir: path.join(CACHE, 'raw'), offline, log });
  const file = (id: string) => fetched.get(id)!.path;
  const read = (id: string, enc: BufferEncoding = 'utf8') => fs.readFileSync(file(id), enc);
  const rowsUsed = new Map<string, string>();
  const cols = (table: string) => COLUMNS.filter((c) => c.table === table).map((c) => c.column);
  /** Column positions of crop_country, by name. */
  const CC = Object.fromEntries(cols('crop_country').map((c, i) => [c, i])) as Record<string, number>;

  // ---------------------------------------------------------------------------------------------
  // EcoCrop and the curated list
  // ---------------------------------------------------------------------------------------------
  const rawRows = readEcoCropCsv(file('ecocrop'));
  const species = rawRows.map(cleanSpecies);
  const speciesById = new Map(species.map((s) => [s.ecocropId, s]));
  rowsUsed.set('ecocrop', `${species.length} species rows`);

  // The curated file holds two tables separated by a blank line; the first is the crop list.
  const curatedRows = parseCsvObjects(read('curated').replace(/^﻿/, '').split(/\r?\n\s*\r?\n/)[0]);
  const curatedByEcocrop = new Map(curatedRows.filter((c) => c.ecocrop_id).map((c) => [Number(c.ecocrop_id), c]));
  rowsUsed.set('curated', `${curatedRows.length} crops`);

  // crop_id: the slug the app's catalogue uses (src/core/crops: slug of the EcoCrop name, with the
  // EcoCrop id appended when two rows share a name); curated crops keep their curated id.
  const idOf = new Map<number, string>();
  const usedIds = new Set<string>();
  for (const c of curatedRows) {
    usedIds.add(c.id);
    if (c.ecocrop_id) idOf.set(Number(c.ecocrop_id), c.id);
  }
  for (const [eid, p] of cleanEcoCrop(rawRows).profiles) {
    if (idOf.has(eid)) continue;
    const id = usedIds.has(p.id) ? `${p.id}-${eid}` : p.id;
    idOf.set(eid, id);
    usedIds.add(id);
  }
  for (const s of species) {
    if (idOf.has(s.ecocropId)) continue;
    let id = slugify(s.scientificName);
    if (usedIds.has(id)) id = `${id}-${s.ecocropId}`;
    idOf.set(s.ecocropId, id);
    usedIds.add(id);
  }
  if (new Set(idOf.values()).size !== idOf.size) throw new Error('crop_id collision');

  // ---------------------------------------------------------------------------------------------
  // Definitions and code lists
  // ---------------------------------------------------------------------------------------------
  // Genera EcoCrop knows (accepted names and synonyms): a name outside italics is read only if its genus is here.
  const knownGenera = new Set<string>();
  for (const s of species) {
    if (s.taxon) knownGenera.add(s.taxon.genus);
    for (const t of s.synonymTaxa) knownGenera.add(t.genus);
  }
  const faodef = new Map<number, FaodefItem>();
  for (const src of SOURCES.filter((s) => s.id.startsWith('faodef-'))) {
    const items = parseFaodefPage(read(src.id, 'latin1'), knownGenera);
    for (const it of items) if (!faodef.has(it.code)) faodef.set(it.code, it);
    rowsUsed.set(src.id, `${items.length} commodity rows`);
  }
  const cpc = parseCpc(read('cpc21'), knownGenera);
  const m49 = parseM49(read('m49'));
  const geo = parseGeoNames(read('geonames'));
  const geoByNumeric = new Map(geo.map((g) => [g.numeric, g]));
  const geoByFips = new Map(geo.filter((g) => g.fips).map((g) => [g.fips, g]));
  // MapSPAM identifies a country by a FIPS 10-4 code. A few of its codes are not FIPS codes
  // (Togo is TG, not TO): for those the country name is looked up in the UN M49 list instead.
  const nameKeyOf = (s: string) => s.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase();
  const m49ByName = new Map([...m49.values()].map((v) => [nameKeyOf(v.name), v.iso3]));
  const spamIso = (fips0: string, name: string): { iso3: string; by: 'fips' | 'name' | '' } => {
    const g = geoByFips.get(fips0);
    if (g) return { iso3: g.iso3, by: 'fips' };
    const iso3 = m49ByName.get(nameKeyOf(name));
    return iso3 ? { iso3, by: 'name' } : { iso3: '', by: '' };
  };

  // ---------------------------------------------------------------------------------------------
  // FAOSTAT
  // ---------------------------------------------------------------------------------------------
  log('read FAOSTAT QCL ...');
  const qcl = await readQcl(file('faostat-qcl'), 2000);
  const minYear = qcl.maxYear - WINDOW.span + 1;
  rowsUsed.set('faostat-qcl', `${qcl.rowsRead} rows read, ${qcl.rowsKept} kept (crop elements, years ${minYear}-${qcl.maxYear} used)`);

  // Countries: FAOSTAT areas whose M49 code is a country or area with an ISO alpha-3 code in the UN
  // M49 list (fallback: GeoNames ISO numeric). Regions, income groups, "China" (M49 159 = mainland +
  // Hong Kong + Macao + Taiwan, which would double count) and former states have no such code.
  const areaIso = new Map<number, string>();
  const droppedAreas: string[] = [];
  let isoFromGeoNames = 0;
  for (const a of [...qcl.areas.values()].sort((x, y) => x.code - y.code)) {
    const iso = m49.get(a.m49)?.iso3 ?? geoByNumeric.get(a.m49)?.iso3;
    if (!iso) {
      droppedAreas.push(`${a.name} (M49 ${a.m49})`);
      continue;
    }
    if (!m49.has(a.m49)) isoFromGeoNames++;
    areaIso.set(a.code, iso);
  }

  const stats = new Map<number, Map<string, Stat>>(); // item -> iso3 -> means
  const countries = new Map<string, Country>();
  const hasAreaElement = new Set<number>();
  for (const [key, s] of qcl.series) {
    const [areaCode, itemCode] = key.split('|').map(Number);
    const iso3 = areaIso.get(areaCode);
    if (!iso3) continue;
    const st: Stat = { area: latestMean(s.area, minYear), production: latestMean(s.production, minYear), yield: latestMean(s.yield, minYear) };
    if (!st.area && !st.production) continue;
    if (st.area) hasAreaElement.add(itemCode);
    if (!stats.has(itemCode)) stats.set(itemCode, new Map());
    if (stats.get(itemCode)!.has(iso3)) throw new Error(`two FAOSTAT areas map to ${iso3}`);
    stats.get(itemCode)!.set(iso3, st);
    if (!countries.has(iso3)) countries.set(iso3, { iso3, name: qcl.areas.get(areaCode)!.name, areaCode, totalAreaHa: 0, itemAreas: new Map() });
  }
  // Crop items: the items FAOSTAT reports an area harvested for. Livestock and processed products have none.
  const cropItemCodes = [...hasAreaElement].sort((a, b) => a - b);
  for (const code of [...stats.keys()]) if (!hasAreaElement.has(code)) stats.delete(code);
  for (const [code, per] of stats) {
    for (const [iso3, st] of per) {
      const a = st.area?.mean ?? 0;
      if (a > 0) {
        const c = countries.get(iso3)!;
        c.itemAreas.set(code, a);
        c.totalAreaHa += a;
      }
    }
  }
  // A country enters the atlas when it reports at least one crop item.
  const reporting = new Set([...stats.values()].flatMap((per) => [...per.keys()]));
  for (const iso3 of [...countries.keys()]) if (!reporting.has(iso3)) countries.delete(iso3);
  const countryList = [...countries.values()].sort((a, b) => a.iso3.localeCompare(b.iso3));
  rowsUsed.set('m49', `${countryList.length - isoFromGeoNames} country codes`);

  const produces = (st: Stat | undefined) => !!st && ((st.area?.mean ?? 0) > 0 || (st.production?.mean ?? 0) > 0);

  const cropItems: CropItem[] = cropItemCodes.map((code) => {
    const info = qcl.items.get(code)!;
    const fd = faodef.get(code);
    const cp = cpc.get(info.cpc);
    const mentions = [...(fd?.mentions ?? [])];
    const seen = new Set(mentions.map(taxonKey));
    for (const m of cp?.mentions ?? []) if (!seen.has(taxonKey(m))) mentions.push(m);
    const per = [...(stats.get(code)?.values() ?? [])];
    return {
      code,
      cpc: info.cpc,
      name: info.name,
      faodefName: fd?.name ?? '',
      definition: [fd?.text ? `FAO: ${fd.text}` : '', cp?.includes ? `CPC: ${cp.includes}` : ''].filter(Boolean).join(' | '),
      definitionSources: [fd ? 'fao-definitions' : '', cp?.mentions.length ? 'cpc-2.1' : ''].filter(Boolean),
      mentions,
      openList: fd?.openList ?? false,
      worldAreaHa: sum(per.map((s) => s.area?.mean ?? 0)),
      worldProductionT: sum(per.map((s) => s.production?.mean ?? 0)),
      countries: per.filter(produces).length,
    };
  });
  const itemByCode = new Map(cropItems.map((i) => [i.code, i]));
  rowsUsed.set('cpc21', `${cropItems.filter((i) => cpc.get(i.cpc)?.mentions.length).length} classes with plant names, joined on the CPC code of ${cropItems.length} crop items`);

  // ---------------------------------------------------------------------------------------------
  // Crosswalks
  // ---------------------------------------------------------------------------------------------
  const xw = buildCrosswalk(
    cropItems,
    species.map((s) => ({ id: s.ecocropId, taxon: s.taxon, synonyms: s.synonymTaxa, commonNames: s.commonNameList, cultivated: s.cultivated })),
  );

  const spamNames = parseSpamReadme(read('spam-readme'));
  const spamTable = parseCsvObjects(read('mapspamc-crosswalk')).map((r) => ({ crop: r.crop, item: Number(r.faostat_crop_code) }));
  const parentLabel = new Map<number, string>();
  for (const it of cropItems) {
    const parent = cpc.get(it.cpc)?.parent;
    if (parent && cpc.has(parent)) parentLabel.set(it.code, cpc.get(parent)!.label);
  }
  const spamCrops = buildSpamCrosswalk(spamNames, spamTable, new Map(cropItems.map((i) => [i.code, i.name])), parentLabel);
  const spamByCode = new Map(spamCrops.map((c) => [c.code, c]));
  const spamOfItem = new Map<number, SpamCrop[]>();
  for (const c of spamCrops) for (const i of c.items) spamOfItem.set(i, [...(spamOfItem.get(i) ?? []), c]);
  rowsUsed.set('mapspamc-crosswalk', `${spamTable.length} item-to-crop rows`);
  rowsUsed.set('spam-readme', `${spamNames.length} crop names`);

  // ---------------------------------------------------------------------------------------------
  // Keep or drop
  // ---------------------------------------------------------------------------------------------
  interface Kept {
    id: string;
    s: AtlasSpecies | null;
    curated: Record<string, string> | null;
    match: 'exact' | 'group' | 'none';
    method: string;
    matchedName: string;
    label: string;
    items: number[];
    primary: number | null;
    spam: SpamCrop[];
    evidence: string[];
    countries: number;
    worldAreaHa: number | null;
    worldProductionT: number | null;
    yearFrom: number | null;
    yearTo: number | null;
  }
  const kept: Kept[] = [];
  const dropped: Cell[][] = [];
  const dropReasons = new Map<string, number>();

  /** Quantities of a crop in a country: the sum over the crop's own (single-class) items. */
  const cropIn = (items: readonly number[], iso3: string) => {
    const parts = items.map((code) => ({ code, st: stats.get(code)?.get(iso3) })).filter((p) => produces(p.st));
    if (!parts.length) return null;
    const areas = parts.filter((p) => (p.st!.area?.mean ?? 0) > 0);
    const prods = parts.filter((p) => (p.st!.production?.mean ?? 0) > 0);
    const means = (areas.length ? areas.map((p) => p.st!.area!) : prods.map((p) => p.st!.production!)) as Mean[];
    parts.sort((a, b) => (b.st!.area?.mean ?? 0) - (a.st!.area?.mean ?? 0) || (b.st!.production?.mean ?? 0) - (a.st!.production?.mean ?? 0) || a.code - b.code);
    return {
      codes: parts.map((p) => p.code),
      areaHa: areas.length ? sum(areas.map((p) => p.st!.area!.mean)) : null,
      productionT: prods.length ? sum(prods.map((p) => p.st!.production!.mean)) : null,
      // A yield is only meaningful for one product (dry and green peas are not averaged): it is
      // the yield of the item with the largest area, the first code of the row.
      yieldTHa: parts[0].st!.yield ? parts[0].st!.yield.mean / 1000 : null,
      yearFrom: Math.min(...means.map((m) => m.yearFrom)),
      yearTo: Math.max(...means.map((m) => m.yearTo)),
    };
  };

  for (const s of species) {
    const m = xw.species.get(s.ecocropId)!;
    const curated = curatedByEcocrop.get(s.ecocropId) ?? null;
    // SPAM crops of the crop's items (bananas and plantains are two SPAM crops of one species);
    // a residual class is listed only when no item has a SPAM crop of its own.
    const spamAll = [...new Set(m.items.map((i) => spamCropFor(spamOfItem.get(i) ?? [], s.commonNameList)).filter((c): c is SpamCrop => c != null))];
    const spam = spamAll.some((c) => c.class === 'individual') ? spamAll.filter((c) => c.class === 'individual') : spamAll;
    let n = 0;
    let area = 0;
    let prod = 0;
    let anyArea = false;
    let yearFrom = Infinity;
    let yearTo = -Infinity;
    if (m.match === 'exact') {
      for (const c of countryList) {
        const q = cropIn(m.items, c.iso3);
        if (!q) continue;
        n++;
        if (q.areaHa != null) {
          area += q.areaHa;
          anyArea = true;
        }
        prod += q.productionT ?? 0;
        yearFrom = Math.min(yearFrom, q.yearFrom);
        yearTo = Math.max(yearTo, q.yearTo);
      }
    }
    // A species named in a group item is one of several candidates: it counts only when EcoCrop
    // itself says the plant is grown (a genus-level match already required that).
    const evidence: string[] = [];
    if (m.match === 'exact' && n > 0) evidence.push('faostat-exact');
    if (m.match === 'group' && s.cultivated) evidence.push('faostat-group');
    if (spam.some((c) => c.class === 'individual') && (m.match === 'exact' || s.cultivated)) evidence.push('mapspam');
    if (curated) evidence.push('curated');
    if (!evidence.length) {
      const item = m.primary != null ? itemByCode.get(m.primary)! : null;
      const reason =
        m.match === 'none'
          ? 'no FAOSTAT crop item names it (scientific or common name)'
          : m.match === 'group'
            ? 'named only in a group item and EcoCrop does not describe it as grown on a large or small scale'
            : 'its FAOSTAT item has no area or production in the window';
      dropReasons.set(reason, (dropReasons.get(reason) ?? 0) + 1);
      dropped.push([idOf.get(s.ecocropId)!, s.ecocropId, s.scientificName, s.family, s.commonNames, s.category, s.plantAttributes, reason, m.match, m.method, item?.code ?? null, item?.name ?? '']);
      continue;
    }
    kept.push({
      id: idOf.get(s.ecocropId)!,
      s,
      curated,
      match: m.match,
      method: m.method,
      matchedName: m.matchedName,
      label: m.label,
      items: m.items,
      primary: m.primary,
      spam,
      evidence: evidence.length === 1 && evidence[0] === 'curated' ? ['curated-only'] : evidence,
      countries: n,
      worldAreaHa: m.match === 'exact' && anyArea ? area : null,
      worldProductionT: m.match === 'exact' && n > 0 ? prod : null,
      yearFrom: Number.isFinite(yearFrom) ? yearFrom : null,
      yearTo: Number.isFinite(yearTo) ? yearTo : null,
    });
  }
  // Curated crops that EcoCrop does not have (no ecocrop_id): carried from the curated list alone.
  for (const c of curatedRows) {
    if (c.ecocrop_id && speciesById.has(Number(c.ecocrop_id))) continue;
    kept.push({ id: c.id, s: null, curated: c, match: 'none', method: '', matchedName: '', label: '', items: [], primary: null, spam: [], evidence: ['curated-only'], countries: 0, worldAreaHa: null, worldProductionT: null, yearFrom: null, yearTo: null });
  }
  kept.sort((a, b) => a.id.localeCompare(b.id));
  /** Kept crops whose own item this is (match = exact), and those that are only members of it (match = group). */
  const exactOfItem = new Map<number, Kept[]>();
  const membersOfItem = new Map<number, Kept[]>();
  for (const k of kept) {
    if (k.match === 'exact') for (const i of k.items) exactOfItem.set(i, [...(exactOfItem.get(i) ?? []), k]);
    else if (k.primary != null) membersOfItem.set(k.primary, [...(membersOfItem.get(k.primary) ?? []), k]);
  }

  const nameEn = (k: Kept): [string, string] => {
    if (k.curated?.name_en) return [k.curated.name_en, 'curated'];
    const item = k.primary != null ? itemByCode.get(k.primary)! : null;
    // The FAOSTAT item name is the crop's name only when the item is this one species.
    if (item && k.match === 'exact' && k.method !== 'genus' && (exactOfItem.get(item.code)?.length ?? 0) === 1) return [item.name, 'faostat-item'];
    // "durian (Durio zibethinus)": the vernacular name the FAO definition prints before the scientific one.
    if (k.label) return [k.label[0].toUpperCase() + k.label.slice(1), 'fao-definition'];
    // EcoCrop's common names carry no language: none of them can be called the English name by rule.
    return ['', ''];
  };
  /** The display name the app catalogue derives (scripts/crops/parse.ts): first common name in plain Latin letters. */
  const firstListed = (k: Kept): string => {
    const ascii = k.s?.commonNameList.find((n) => n.length > 1 && n.length <= 32 && /^[A-Za-z][A-Za-z' -]+$/.test(n));
    return ascii ? ascii[0].toUpperCase() + ascii.slice(1) : '';
  };
  const names = new Map(kept.map((k) => [k.id, nameEn(k)]));

  // ---------------------------------------------------------------------------------------------
  // crops.csv
  // ---------------------------------------------------------------------------------------------
  const cropRows: Cell[][] = kept.map((k) => {
    const s = k.s;
    const item = k.primary != null ? itemByCode.get(k.primary)! : null;
    const exact = k.match === 'exact';
    const tier = !exact || k.countries === 0 ? '' : commonnessFor(k.countries, k.worldAreaHa ?? 0);
    return [
      k.id,
      s?.ecocropId ?? null,
      s?.scientificName ?? k.curated?.scientific_name ?? '',
      s?.authority ?? '',
      names.get(k.id)![0],
      names.get(k.id)![1],
      firstListed(k),
      k.curated?.name_vi ?? '',
      s?.commonNames ?? '',
      s?.synonyms ?? '',
      s?.family ?? '',
      s?.lifeForm ?? '',
      s?.physiology ?? '',
      s?.habit ?? '',
      s?.category ?? '',
      s?.lifeSpan ?? '',
      s?.plantAttributes ?? '',
      s?.usesMain ?? '',
      ...(s ? [...s.temp, ...s.rain, ...s.ph] : Array<Cell>(12).fill(null)),
      ...(s ? [...s.soil.depth, ...s.soil.texture, ...s.soil.fertility, ...s.soil.salinity, ...s.soil.drainage, ...s.soil.alToxicity] : Array<Cell>(12).fill(null)),
      ...(s ? s.light : Array<Cell>(4).fill(null)),
      ...(s ? [...s.latitude, ...s.altitude] : Array<Cell>(8).fill(null)),
      s?.climateZones ?? '',
      s?.photoperiod ?? '',
      s?.killingTempRest ?? null,
      s?.killingTempEarlyGrowth ?? null,
      s?.cycleMin ?? null,
      s?.cycleMax ?? null,
      s?.cleaning.join('; ') ?? '',
      item?.code ?? null,
      item?.name ?? '',
      item?.cpc ?? '',
      exact ? list(k.items.slice(1)) : '',
      k.match,
      k.method,
      k.matchedName,
      item ? (exact ? exactOfItem.get(item.code)!.length : (exactOfItem.get(item.code)?.length ?? 0) + membersOfItem.get(item.code)!.length) : null,
      list(k.spam.map((c) => c.code)),
      k.spam.map((c) => c.name).join('; '),
      k.spam.length ? (k.spam.some((c) => c.class === 'individual') ? 'individual' : 'residual') : '',
      list(k.evidence),
      tier,
      exact ? k.countries : null,
      k.worldAreaHa != null ? Math.round(k.worldAreaHa) : null,
      k.worldProductionT != null ? Math.round(k.worldProductionT) : null,
      k.yearFrom != null ? (k.yearFrom === k.yearTo ? String(k.yearFrom) : `${k.yearFrom}-${k.yearTo}`) : '',
      k.curated ? 'yes' : 'no',
      urbanCandidate(s).candidate ? 'yes' : '',
      urbanCandidate(s).rule,
    ];
  });

  // ---------------------------------------------------------------------------------------------
  // urban_candidates.csv: one row per crop of crops.csv, in its order. A file of its own because
  // the market database mirrors crops.csv column for column.
  // ---------------------------------------------------------------------------------------------
  const urbanRows: Cell[][] = kept.map((k) => urbanCandidateRow(k.id, k.s));

  // ---------------------------------------------------------------------------------------------
  // item_country.csv and items.csv
  // ---------------------------------------------------------------------------------------------
  const itemCountryRows: Cell[][] = [];
  for (const it of cropItems) {
    const cls = xw.itemClass.get(it.code)!;
    for (const c of countryList) {
      const st = stats.get(it.code)?.get(c.iso3);
      if (!produces(st)) continue;
      const area = st!.area && st!.area.mean > 0 ? st!.area.mean : null;
      const share = area != null && c.totalAreaHa > 0 ? (area / c.totalAreaHa) * 100 : null;
      const ref = (st!.area ?? st!.production)!;
      itemCountryRows.push([
        it.code,
        it.name,
        it.cpc,
        cls.class,
        c.iso3,
        c.name,
        area != null ? Math.round(area) : null,
        st!.production ? Math.round(st!.production.mean) : null,
        st!.yield ? round(st!.yield.mean / 1000, 3) : null,
        ref.yearFrom,
        ref.yearTo,
        share != null ? round(share, 3) : null,
        area != null ? rankOf(area, [...c.itemAreas.values()]) : null,
        levelFor(area, share, st!.production?.mean ?? null),
        FAOSTAT_SOURCE,
      ]);
    }
  }
  const itemRows: Cell[][] = cropItems.map((it) => {
    const cls = xw.itemClass.get(it.code)!;
    const crops = (exactOfItem.get(it.code) ?? []).map((k) => k.id).sort();
    const members = (membersOfItem.get(it.code) ?? []).map((k) => k.id).sort();
    return [
      it.code,
      it.name,
      it.cpc,
      cls.class,
      cls.reason,
      it.faodefName,
      it.definition,
      list(it.definitionSources),
      list(it.mentions.map((m) => [m.genus[0].toUpperCase() + m.genus.slice(1), m.species ?? 'spp.', m.infra ? `var. ${m.infra}` : ''].filter(Boolean).join(' '))),
      crops.length,
      list(crops),
      list(members),
      list((spamOfItem.get(it.code) ?? []).map((c) => c.code)),
      it.countries,
      it.worldAreaHa > 0 ? Math.round(it.worldAreaHa) : null,
      it.worldProductionT > 0 ? Math.round(it.worldProductionT) : null,
    ];
  });

  // ---------------------------------------------------------------------------------------------
  // crop_country.csv
  // ---------------------------------------------------------------------------------------------
  const national = readNational(
    DEFAULT_NATIONAL_FILE,
    new Set(kept.map((k) => k.id)),
    new Set(countryList.map((c) => c.iso3)),
  );
  const cropCountryRows: Cell[][] = [];
  /** National rows that changed nothing, because FAOSTAT reports the crop in the country: listed in the report. */
  const nationalIgnored: string[] = [];
  interface CountryCrop {
    id: string;
    areaHa: number | null;
    productionT: number | null;
    level: string;
  }
  const cropsOfCountry = new Map<string, CountryCrop[]>(countryList.map((c) => [c.iso3, []]));
  const possibleOfCountry = new Map<string, string[]>(countryList.map((c) => [c.iso3, []]));
  for (const k of kept) {
    for (const c of countryList) {
      const resolved = resolveCropCountryRow({
        cropId: k.id,
        match: k.match,
        items: k.items,
        primary: k.primary,
        iso3: c.iso3,
        countryName: c.name,
        totalAreaHa: c.totalAreaHa,
        itemAreas: c.itemAreas,
        faostat: k.match === 'exact' ? cropIn(k.items, c.iso3) : null,
        groupItemReported: k.match === 'group' && k.primary != null ? produces(stats.get(k.primary)?.get(c.iso3)) : false,
        national: national.get(`${k.id}|${c.iso3}`),
      });
      if (!resolved) continue;
      cropCountryRows.push(resolved.row);
      if (resolved.nationalIgnored) nationalIgnored.push(`${k.id} ${c.iso3} (FAOSTAT level ${resolved.level})`);
      if (resolved.inCountryCrops) {
        cropsOfCountry.get(c.iso3)!.push({ id: k.id, areaHa: resolved.areaHa, productionT: resolved.productionT, level: resolved.level });
      }
      if (resolved.inPossibleCrops) {
        possibleOfCountry.get(c.iso3)!.push(k.id);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // country_crops.csv
  // ---------------------------------------------------------------------------------------------
  const fmtHa = (v: number | null) => (v == null ? 'area not reported' : `${Math.round(v)} ha`);
  const countryRows: Cell[][] = countryList.map((c) => {
    const crops = cropsOfCountry.get(c.iso3)!.sort((a, b) => (b.areaHa ?? -1) - (a.areaHa ?? -1) || (b.productionT ?? 0) - (a.productionT ?? 0) || a.id.localeCompare(b.id));
    const reported = cropItems
      .map((it) => ({ it, st: stats.get(it.code)?.get(c.iso3) }))
      .filter((x) => produces(x.st))
      .sort((a, b) => (b.st!.area?.mean ?? 0) - (a.st!.area?.mean ?? 0) || a.it.code - b.it.code);
    const years = reported.map((x) => (x.st!.area ?? x.st!.production)!);
    const itemText = (x: (typeof reported)[number]) => {
      const a = x.st!.area && x.st!.area.mean > 0 ? x.st!.area.mean : null;
      const share = a != null && c.totalAreaHa > 0 ? `, ${round((a / c.totalAreaHa) * 100, 1)} %` : '';
      return `${x.it.name} [${x.it.code}]: ${fmtHa(a)}${share}`;
    };
    const ids = (level: string) => list(crops.filter((x) => x.level === level).map((x) => x.id));
    return [
      c.iso3,
      c.name,
      years.length ? Math.min(...years.map((y) => y.yearFrom)) : null,
      years.length ? Math.max(...years.map((y) => y.yearTo)) : null,
      Math.round(c.totalAreaHa),
      reported.length,
      reported.slice(0, 15).map(itemText).join('; '),
      ids('major'),
      ids('common'),
      ids('minor'),
      ids('present'),
      reported
        .filter((x) => exactOfItem.has(x.it.code))
        .map((x) => {
          const a = x.st!.area && x.st!.area.mean > 0 ? x.st!.area.mean : null;
          const share = a != null && c.totalAreaHa > 0 ? (a / c.totalAreaHa) * 100 : null;
          return `${x.it.name} [${x.it.code}]: ${fmtHa(a)}, ${levelFor(a, share, x.st!.production?.mean ?? null)} -> ${exactOfItem
            .get(x.it.code)!
            .map((k) => k.id)
            .join(', ')}`;
        })
        .join('; '),
      reported
        .filter((x) => xw.itemClass.get(x.it.code)!.class === 'group')
        .map(itemText)
        .join('; '),
      list(possibleOfCountry.get(c.iso3)!.sort()),
    ];
  });

  // ---------------------------------------------------------------------------------------------
  // MapSPAM: region_crops.csv and spam_crops.csv
  // ---------------------------------------------------------------------------------------------
  log('read MapSPAM harvested area ...');
  // The zip must be the file Harvard Dataverse lists: the source entry carries the MD5 of its record.
  const spamSource = fetched.get('spam-harvested-area')!.source;
  const actual = await md5File(file('spam-harvested-area'));
  if (spamSource.md5 !== actual) throw new Error(`MapSPAM zip MD5 ${actual} does not match the Dataverse record (${spamSource.md5})`);
  const spam = await readSpamHarvestedArea(file('spam-harvested-area'));
  rowsUsed.set('spam-harvested-area', `${spam.cells} grid cells of ${spam.entryName.split('/').pop()}; MD5 equals the Dataverse record`);
  const unknownSpamColumns = spam.crops.filter((c) => !spamByCode.has(c));
  if (unknownSpamColumns.length) throw new Error(`MapSPAM columns without a name in the readme: ${unknownSpamColumns.join(', ')}`);

  // Crops whose own FAOSTAT item belongs to the SPAM crop, and crops that are only members of such an item.
  const keptOfSpam = new Map<string, string[]>();
  const membersOfSpam = new Map<string, string[]>();
  for (const k of kept) for (const c of k.spam) (k.match === 'exact' ? keptOfSpam : membersOfSpam).set(c.code, [...((k.match === 'exact' ? keptOfSpam : membersOfSpam).get(c.code) ?? []), k.id]);
  const spamFipsUnmapped = new Set<string>();
  const regionRows: Cell[][] = [];
  const pushRegion = (level: 'country' | 'admin1', r: SpamRegion) => {
    const { iso3 } = spamIso(r.fips0, r.country);
    if (!iso3) spamFipsUnmapped.add(`${r.fips0} ${r.country}`);
    const total = sum([...r.area]);
    const areas = [...r.area].map((a) => Math.round(a));
    spam.crops
      .map((code, i) => ({ code, area: r.area[i], rounded: areas[i] }))
      .filter((x) => x.rounded > 0)
      .sort((a, b) => b.area - a.area || a.code.localeCompare(b.code))
      .forEach((x) => {
        const crop = spamByCode.get(x.code)!;
        regionRows.push([
          iso3,
          r.country,
          level,
          r.admin1Code,
          r.admin1,
          x.code,
          crop.name,
          crop.class,
          x.rounded,
          round((x.area / total) * 100, 2),
          rankOf(x.area, [...r.area]),
          // Residual classes pool dozens of plants: their members are listed once, in spam_crops.csv.
          crop.class === 'individual' ? list((keptOfSpam.get(x.code) ?? []).sort()) : '',
          SPAM_SOURCE,
        ]);
      });
  };
  const sortRegion = (a: SpamRegion, b: SpamRegion) => {
    const ia = spamIso(a.fips0, a.country).iso3 || `~${a.fips0}`;
    const ib = spamIso(b.fips0, b.country).iso3 || `~${b.fips0}`;
    return ia.localeCompare(ib) || a.admin1Code.localeCompare(b.admin1Code);
  };
  const spamCountries = [...spam.countries.values()].sort(sortRegion);
  const spamRegions = [...spam.regions.values()].sort(sortRegion);
  for (const c of spamCountries) {
    pushRegion('country', c);
    for (const r of spamRegions) if (r.fips0 === c.fips0) pushRegion('admin1', r);
  }
  const spamIsoBy = spamCountries.map((c) => ({ c, ...spamIso(c.fips0, c.country) }));
  rowsUsed.set('geonames', `${spamIsoBy.filter((x) => x.by === 'fips').length} FIPS codes of MapSPAM countries, ${isoFromGeoNames} ISO numeric code(s) of FAOSTAT areas`);

  const spamCropRows: Cell[][] = spamCrops.map((c) => {
    const k = spam.crops.indexOf(c.code);
    return [
      c.code,
      c.name,
      c.class,
      c.method,
      list(c.items.filter((i) => itemByCode.has(i))),
      c.items
        .filter((i) => itemByCode.has(i))
        .map((i) => itemByCode.get(i)!.name)
        .join('; '),
      list(c.items.filter((i) => !itemByCode.has(i))),
      list((keptOfSpam.get(c.code) ?? []).sort()),
      list((membersOfSpam.get(c.code) ?? []).sort()),
      k >= 0 ? Math.round(sum(spamCountries.map((r) => r.area[k]))) : null,
    ];
  });

  // ---------------------------------------------------------------------------------------------
  // sources.csv, columns.csv, summary.csv
  // ---------------------------------------------------------------------------------------------
  const sourceRows: Cell[][] = SOURCES.map((s) => {
    const f = fetched.get(s.id)!;
    return [s.id, s.title, s.publisher, s.url || s.file, s.landing, s.licence, f.accessed, s.url ? `.cache/atlas/raw/${s.file}` : s.file, f.sha256, f.bytes, rowsUsed.get(s.id) ?? ''];
  });
  // The publications of the national rows. The build holds no copy of them (the figures were read
  // into data/crops/national/prevalence.csv by hand), so they have no checksum and no size.
  const nationalSources = nationalSourcesUsed(national);
  const nationalFile = path.relative(ROOT, DEFAULT_NATIONAL_FILE).split(path.sep).join('/');
  for (const s of nationalSources) {
    sourceRows.push([s.id, s.title, s.publisher, s.url, s.url, s.licence, s.accessed, nationalFile, null, null, `${s.rows} row(s) of ${nationalFile}, ${s.rowsWithFigure} with a figure`]);
  }
  const columnRows: Cell[][] = COLUMNS.map((c: ColumnDoc) => [c.table, c.column, c.en, c.vi, c.unit, c.source, c.rule]);

  const count = <T>(xs: readonly T[], f: (x: T) => boolean) => xs.filter(f).length;
  const allMatches = species.map((s) => xw.species.get(s.ecocropId)!);
  const curatedKept = kept.filter((k) => k.curated);
  const economicsPath = path.join(OUT, 'economics.csv');
  const economicsObjs = fs.existsSync(economicsPath) ? parseCsvObjects(fs.readFileSync(economicsPath, 'utf8')) : [];
  const econCountries = [...new Set(economicsObjs.map((r) => r.iso3).filter(Boolean))].sort();
  const summary: [string, Cell][] = [
    ['ecocrop_species', species.length],
    ['kept_crops', kept.length],
    ['kept_from_ecocrop', count(kept, (k) => !!k.s)],
    ['dropped_species', dropped.length],
    ...[...dropReasons].sort((a, b) => b[1] - a[1]).map(([r, n]): [string, Cell] => [`dropped: ${r}`, n]),
    ['evidence_faostat_exact', count(kept, (k) => k.evidence.includes('faostat-exact'))],
    ['evidence_faostat_group', count(kept, (k) => k.evidence.includes('faostat-group'))],
    ['evidence_mapspam', count(kept, (k) => k.evidence.includes('mapspam'))],
    ['evidence_curated', count(kept, (k) => !!k.curated)],
    ['evidence_curated_only', count(kept, (k) => k.evidence.includes('curated-only'))],
    ['all_species_match_exact', count(allMatches, (m) => m.match === 'exact')],
    ['all_species_match_group', count(allMatches, (m) => m.match === 'group')],
    ['all_species_match_none', count(allMatches, (m) => m.match === 'none')],
    ['kept_match_exact', count(kept, (k) => k.match === 'exact')],
    ['kept_match_group', count(kept, (k) => k.match === 'group')],
    ['kept_match_none', count(kept, (k) => k.match === 'none')],
    ...['variety', 'species', 'synonym', 'species-variety', 'genus', 'name'].map((m): [string, Cell] => [`kept_match_method_${m}`, count(kept, (k) => k.method === m)]),
    ...['global', 'widespread', 'regional', 'local'].map((t): [string, Cell] => [`commonness_${t}`, count(cropRows, (r) => r[COLUMNS.filter((c) => c.table === 'crops').findIndex((c) => c.column === 'commonness')] === t)]),
    ['curated_crops', curatedRows.length],
    ['curated_kept', curatedKept.length],
    ['curated_only_ids', list(curatedKept.filter((k) => k.evidence.includes('curated-only')).map((k) => k.id))],
    ['crops_with_name_en', count(kept, (k) => names.get(k.id)![0].length > 0)],
    ['crops_without_name_en', count(kept, (k) => names.get(k.id)![0].length === 0)],
    ['name_en_source_curated', count(kept, (k) => names.get(k.id)![1] === 'curated')],
    ['name_en_source_fao_definition', count(kept, (k) => names.get(k.id)![1] === 'fao-definition')],
    ['name_en_source_faostat_item', count(kept, (k) => names.get(k.id)![1] === 'faostat-item')],
    ['crops_with_name_vi', count(kept, (k) => (k.curated?.name_vi ?? '').length > 0)],
    ['urban_candidates', count(urbanRows, (r) => r[cols('urban_candidates').indexOf('urban_candidate')] === 'yes')],
    ['faostat_crop_items', cropItems.length],
    ['faostat_items_single', count(cropItems, (i) => xw.itemClass.get(i.code)!.class === 'single')],
    ['faostat_items_group', count(cropItems, (i) => xw.itemClass.get(i.code)!.class === 'group')],
    ['faostat_items_with_definition', count(cropItems, (i) => i.mentions.length > 0)],
    ['faostat_countries', countryList.length],
    ['faostat_areas_dropped', droppedAreas.length],
    ['faostat_latest_year', qcl.maxYear],
    ['faostat_window', `${minYear}-${qcl.maxYear}`],
    ['crop_country_rows', cropCountryRows.length],
    ['crop_country_rows_present', count(cropCountryRows, (r) => r[CC.level] !== 'absent' && r[CC.level] !== 'unknown')],
    ['crop_country_rows_absent', count(cropCountryRows, (r) => r[CC.level] === 'absent')],
    ['crop_country_rows_unknown', count(cropCountryRows, (r) => r[CC.level] === 'unknown')],
    // match = national says where the row comes from, not that it has a quantity: the two parts are counted apart.
    ['crop_country_rows_national', count(cropCountryRows, (r) => r[CC.match] === 'national')],
    ['crop_country_rows_national_with_figure', count(cropCountryRows, (r) => r[CC.match] === 'national' && r[CC.level] !== 'unknown')],
    ['crop_country_rows_national_without_figure', count(cropCountryRows, (r) => r[CC.match] === 'national' && r[CC.level] === 'unknown')],
    ['crop_country_exact_with_level', count(cropCountryRows, (r) => r[CC.match] === 'exact' && r[CC.level] !== 'unknown')],
    ['crop_country_exact_grown', count(cropCountryRows, (r) => r[CC.match] === 'exact' && r[CC.level] !== 'absent' && r[CC.level] !== 'unknown')],
    ['national_rows_read', national.size],
    ['national_rows_ignored', nationalIgnored.length],
    ['item_country_rows', itemCountryRows.length],
    ['spam_crops', spamCrops.length],
    ['spam_crops_individual', count(spamCrops, (c) => c.class === 'individual')],
    ['spam_cells', spam.cells],
    ['spam_countries', spamCountries.length],
    ['spam_admin1_regions', spamRegions.length],
    ['spam_countries_without_iso3', list([...spamFipsUnmapped].sort())],
    ['region_crops_rows', regionRows.length],
    ['spam_world_harvested_area_ha', Math.round(sum(spamCountries.map((r) => sum([...r.area]))))],
    ['faostat_world_harvested_area_ha', Math.round(sum(countryList.map((c) => c.totalAreaHa)))],
    ['economics_rows', economicsObjs.length],
    ['economics_countries', econCountries.length],
    ['economics_country_list', list(econCountries)],
    ['economics_with_yield', count(economicsObjs, (r) => (r.yield_t_ha ?? '').trim() !== '')],
    ['economics_with_price', count(economicsObjs, (r) => (r.price_usd_t ?? '').trim() !== '')],
    ['economics_with_cost', count(economicsObjs, (r) => (r.cost_usd_ha ?? '').trim() !== '')],
    ['economics_complete', count(economicsObjs, (r) => (r.yield_t_ha ?? '').trim() !== '' && (r.price_usd_t ?? '').trim() !== '' && (r.cost_usd_ha ?? '').trim() !== '')],
    ...['official', 'budget', 'press', 'derived', 'none'].map((q): [string, Cell] => [`economics_yield_${q}`, count(economicsObjs, (r) => r.quality_yield === q)]),
    ...['official', 'budget', 'press', 'derived', 'none'].map((q): [string, Cell] => [`economics_price_${q}`, count(economicsObjs, (r) => r.quality_price === q)]),
    ...['official', 'budget', 'press', 'derived', 'none'].map((q): [string, Cell] => [`economics_cost_${q}`, count(economicsObjs, (r) => r.quality_cost === q)]),
  ];

  // ---------------------------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------------------------
  const tables: { name: string; columns: string[]; rows: Cell[][] }[] = [
    { name: 'crops', columns: cols('crops'), rows: cropRows },
    { name: 'urban_candidates', columns: cols('urban_candidates'), rows: urbanRows },
    { name: 'crop_country', columns: cols('crop_country'), rows: cropCountryRows },
    { name: 'item_country', columns: cols('item_country'), rows: itemCountryRows },
    { name: 'country_crops', columns: cols('country_crops'), rows: countryRows },
    { name: 'region_crops', columns: cols('region_crops'), rows: regionRows },
    { name: 'items', columns: cols('items'), rows: itemRows },
    { name: 'spam_crops', columns: cols('spam_crops'), rows: spamCropRows },
    { name: 'dropped', columns: cols('dropped'), rows: dropped.sort((a, b) => String(a[0]).localeCompare(String(b[0]))) },
    { name: 'economics_template', columns: [...ECONOMICS_COLUMNS], rows: [] },
    { name: 'sources', columns: cols('sources'), rows: sourceRows },
    { name: 'columns', columns: cols('columns'), rows: columnRows },
    { name: 'summary', columns: cols('summary'), rows: summary },
  ];
  for (const t of tables) {
    if (t.rows.some((r) => r.length !== t.columns.length)) throw new Error(`${t.name}: a row does not have ${t.columns.length} cells`);
    fs.writeFileSync(path.join(OUT, `${t.name}.csv`), toCsv(t.columns, t.rows));
  }

  // Workbook for Google Sheets: the rows a person reads. Absent rows and the long tail of each region stay in the CSV.
  const accessed = [...fetched.values()].map((f) => f.accessed).sort().pop() ?? '';
  const sizeRank = cols('region_crops').indexOf('rank_in_region');
  const levelIdx = CC.level;
  const readme: Cell[][] = [
    ['What', 'Astrovivu crop atlas: the plants that are farmed, their growing requirements, and where they are grown. Built by scripts/crops/atlas/build.ts; rules in docs/CROP_DATA.md.'],
    ['Date', `Sources accessed ${accessed}. FAOSTAT years ${minYear}-${qcl.maxYear} (mean of the latest ${WINDOW.years} years with data); MapSPAM circa 2020.`],
    ['Principle', 'Every value is copied or computed from a named source by a documented rule. Nothing was typed in from memory; an unknown is an empty cell.'],
    ['Sheet crops', `${kept.length} crops kept out of ${species.length} EcoCrop species: requirements (EcoCrop), FAOSTAT item, match, MapSPAM crop, evidence, commonness.`],
    ['Sheet urban_candidates', 'One row per crop of the sheet crops: whether the EcoCrop rule of scripts/crops/atlas/urban.ts selects it as an urban / container candidate, and the clause that matched.'],
    ['Sheet crop_country', `One row per crop and country for crops with their own FAOSTAT item (match = exact): area, production, share, rank, level; level = unknown for crops that are part of a group item. The ${count(cropCountryRows, (r) => r[levelIdx] === 'absent')} rows with level = absent are in crop_country.csv only.`],
    ['Sheet item_country', 'FAOSTAT quantities per item and country, including group items (n.e.c., several genera), whose area must not be read as one species.'],
    ['Sheet country_crops', 'One row per country: what is grown there, ordered by harvested area.'],
    ['Sheet region_crops', `MapSPAM 2020 harvested area per country and first-level region; the ${WORKBOOK_REGION_TOP} largest crops of each (all rows are in region_crops.csv).`],
    ['Sheets items, spam_crops', 'The crosswalks: FAOSTAT item to species (with the definition text they were read from) and MapSPAM crop to FAOSTAT items.'],
    ['Sheet dropped', 'Every EcoCrop species that was not kept, with the reason.'],
    ['Sheet economics_template', 'Empty: yields, prices and costs are to be filled in by the team, one row per crop and region, each with its source.'],
    ['match', 'exact = the FAOSTAT item is this species or its genus; group = the item covers several genera or is a residual (n.e.c.) class; none = no item names it.'],
    ['match_method', 'variety, species, synonym, species-variety, genus: matched on the scientific name in the item definition. name: matched on an EcoCrop common name equal to the item name (weaker).'],
    ['level', `major: at least ${LEVEL.majorPct} % of the country's harvested area; common: at least ${LEVEL.commonPct} %; minor: any area below that; present: production reported without area; absent: FAOSTAT covers the country and reports nothing above zero; unknown: group item.`],
    ['commonness', `global: at least ${COMMONNESS.global.countries} producing countries and ${COMMONNESS.global.areaHa} ha; widespread: ${COMMONNESS.widespread.countries} and ${COMMONNESS.widespread.areaHa} ha; regional: ${COMMONNESS.regional.countries} and ${COMMONNESS.regional.areaHa} ha; local: less.`],
    ...SOURCES.map((s): Cell[] => [`Source ${s.id}`, `${s.title}. ${s.publisher}. ${s.landing}. Licence: ${s.licence}`]),
    ...nationalSources.map((s): Cell[] => [`Source ${s.id}`, `${s.title}. ${s.publisher}. ${s.url}. Licence: ${s.licence}`]),
    ['MapSPAM notice', 'This data was provided by the International Food Policy Research Institute (IFPRI). IFPRI bears no responsibility for the analyses or interpretations of the data presented here.'],
    ['FAOSTAT citation', `FAO. ${qcl.maxYear + 1}. FAOSTAT: Crops and livestock products. Accessed on ${accessed}. https://www.fao.org/faostat/en/#data/QCL Licence: CC-BY-4.0.`],
  ];
  const sheets: Sheet[] = [
    { name: 'README', columns: ['topic', 'text'], rows: readme, widths: [26, 160] },
    ...tables.map((t) => ({
      name: t.name,
      columns: t.columns,
      rows:
        t.name === 'crop_country'
          ? t.rows.filter((r) => r[levelIdx] !== 'absent')
          : t.name === 'region_crops'
            ? t.rows.filter((r) => (r[sizeRank] as number) <= WORKBOOK_REGION_TOP)
            : t.rows,
    })),
  ];
  const cells = countCells(sheets);
  if (cells > 2_000_000) throw new Error(`workbook would hold ${cells} cells (limit 2,000,000)`);
  fs.writeFileSync(path.join(CACHE, 'astrovivu-crop-atlas.xlsx'), buildXlsx(sheets));

  // Console report: the checks asked for in the task.
  const report: string[] = [];
  report.push(`workbook cells: ${cells}`);
  for (const [k, v] of summary) report.push(`${k}: ${v ?? ''}`);
  const top = (iso3: string) =>
    cropItems
      .map((it) => ({ it, a: stats.get(it.code)?.get(iso3)?.area?.mean ?? 0 }))
      .filter((x) => x.a > 0)
      .sort((a, b) => b.a - a.a)
      .slice(0, 15)
      .map((x, i) => `  ${i + 1}. ${x.it.name} [${x.it.code}, ${xw.itemClass.get(x.it.code)!.class}] ${Math.round(x.a)} ha -> ${(exactOfItem.get(x.it.code) ?? []).map((k) => k.id).join(', ') || '(no crop of its own)'}${membersOfItem.has(x.it.code) ? ` | members, level unknown: ${membersOfItem.get(x.it.code)!.length}` : ''}`);
  for (const iso of ['VNM', 'USA']) report.push(`top 15 items by harvested area, ${iso}:`, ...top(iso));
  const show = (id: string) => {
    const k = kept.find((x) => x.id === id);
    if (!k) {
      const d = dropped.find((r) => r[0] === id);
      report.push(`${id}: ${d ? `DROPPED (${d[7]}); match=${d[8]}` : 'not in EcoCrop'}`);
      return;
    }
    const item = k.primary != null ? itemByCode.get(k.primary)! : null;
    report.push(`${id}: match=${k.match} method=${k.method} item=${item ? `${item.name} [${list(k.items)}]` : '-'} spam=${list(k.spam.map((c) => c.code)) || '-'} evidence=${list(k.evidence)} countries=${k.countries} world_area=${k.worldAreaHa != null ? Math.round(k.worldAreaHa) : '-'}`);
    for (const iso of ['VNM', 'USA']) {
      const r = cropCountryRows.find((x) => x[CC.crop_id] === id && x[CC.iso3] === iso);
      const v = (c: string) => r?.[CC[c]] ?? '';
      report.push(`   ${iso}: ${r ? `item_reported=${v('item_reported')} area=${v('area_ha')} ha production=${v('production_t')} t yield=${v('yield_t_ha')} t/ha years=${v('year_from')}-${v('year_to')} share=${v('share_of_country_harvested_area_pct')} % rank=${v('rank_in_country')} level=${v('level')}` : 'no row'}`);
    }
  };
  for (const id of ['durio-zibethinus', 'abelmoschus-manihot', 'oryza-sativa', 'zea-mays', 'glycine-max', 'coffea-canephora', 'medicago-sativa', 'ipomoea-batatas']) show(id);
  report.push(`national rows ignored (FAOSTAT already reports the crop in the country, the row stays FAOSTAT's): ${nationalIgnored.join('; ') || 'none'}`);
  for (const t of tables) report.push(`${t.name}.csv: ${t.rows.length} rows, ${fs.statSync(path.join(OUT, `${t.name}.csv`)).size} bytes`);
  report.push(`astrovivu-crop-atlas.xlsx: ${fs.statSync(path.join(CACHE, 'astrovivu-crop-atlas.xlsx')).size} bytes`);
  report.push(`FAOSTAT areas without ISO3 (dropped): ${droppedAreas.join('; ')}`);
  report.push(`MapSPAM countries given an ISO3 by name (code not in GeoNames): ${spamIsoBy.filter((x) => x.by === 'name').map((x) => `${x.c.fips0} ${x.c.country} -> ${x.iso3}`).join('; ')}`);
  report.push(`MapSPAM country names that differ from GeoNames for the same FIPS code: ${spamIsoBy.filter((x) => x.by === 'fips' && nameKeyOf(geoByFips.get(x.c.fips0)!.name) !== nameKeyOf(x.c.country)).map((x) => `${x.c.fips0} ${x.c.country} = ${geoByFips.get(x.c.fips0)!.name} (${x.iso3})`).join('; ')}`);
  report.push(`matched by common name: ${kept.filter((k) => k.method === 'name').map((k) => `${k.id} <${k.matchedName}> ${itemByCode.get(k.primary!)!.name}`).join('; ')}`);
  fs.writeFileSync(path.join(CACHE, 'build-report.txt'), report.join('\n') + '\n');
  log(report.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
