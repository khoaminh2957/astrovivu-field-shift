/**
 * `npm run crops:build` - builds the crop catalogue.
 *
 *   data/ecocrop/ecocrop_2568_plants.csv            FAO EcoCrop, 2,568 rows, 70 columns
 *   data/crops/atlas/crop_country.csv               atlas prevalence by country (387 crops, 198 countries)
 *   data/crops/atlas/economics.csv                  reference economics by country and region
 *        |  parse + clean (scripts/crops/parse.ts, scripts/crops/atlas-tables.ts)
 *        v
 *   public/data/crops/ecocrop.json                  every scorable species, compact, lazy-loaded
 *   public/data/crops/prevalence.json               prevalence of all atlas crops, lazy-loaded
 *   src/core/crops/curated.generated.ts             curated crops (bundled, synchronous) and the
 *                                                   regional reference economics
 *   data/crops/CLEANING_LOG.md                      what was repaired, merged, dropped, overridden
 *   data/crops/curated-crops.csv                    the curated values in one table, for review
 *
 * Order of commands when adding a new curated crop (because the atlas build reads the top block
 * of `data/crops/curated-crops.csv`):
 *   1. npm run crops:build
 *   2. npx tsx scripts/crops/atlas/build.ts --offline
 *   3. npm run crops:build
 *
 * Deterministic: the same CSV and overlay always produce the same files.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CropEconomics, CropPrevalence, CropProfile, Iso3, Quad } from '../src/contracts';
import { encodeCatalog } from '../src/core/crops/codec';
import { slugify } from '../src/core/crops/text';
import type { EconRegion, ReferenceEconomics, ReferenceTable } from '../src/core/economics/types';
import { readEconomics, readPrevalence, toCropPrevalence } from './crops/atlas-tables';
import { DEFAULT_REGION_ORDER, FX_DATE, FX_SOURCE, PREFER_VN, VND_PER_USD } from './crops/economics';
import { FIELD_CROPS } from './crops/overlay-field';
import { GARDEN_CROPS } from './crops/overlay-garden';
import { PERENNIAL_AND_COVER_CROPS } from './crops/overlay-perennial';
import { cleanEcoCrop, readEcoCropCsv, type CleaningEvent } from './crops/parse';
import type { CuratedSpec } from './crops/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const ATLAS_DIR = path.join(ROOT, 'data/crops/atlas');
const CSV = path.join(ROOT, 'data/ecocrop/ecocrop_2568_plants.csv');
const OUT_JSON = path.join(ROOT, 'public/data/crops/ecocrop.json');
const OUT_PREV = path.join(ROOT, 'public/data/crops/prevalence.json');
const OUT_TS = path.join(ROOT, 'src/core/crops/curated.generated.ts');
const OUT_LOG = path.join(ROOT, 'data/crops/CLEANING_LOG.md');
const OUT_CSV = path.join(ROOT, 'data/crops/curated-crops.csv');
const BUILD_DATE = '2026-11-14';

const SPECS: CuratedSpec[] = [...FIELD_CROPS, ...PERENNIAL_AND_COVER_CROPS, ...GARDEN_CROPS];
const ordered = (q: Quad) => q[0] <= q[1] && q[1] <= q[2] && q[2] <= q[3];

function defaultEconomics(id: string, table: ReferenceTable): CropEconomics | undefined {
  const byRegion = table[id];
  if (!byRegion) return undefined;
  const order: EconRegion[] = PREFER_VN.has(id) ? ['VN', ...DEFAULT_REGION_ORDER] : DEFAULT_REGION_ORDER;
  for (const region of order) {
    const r: ReferenceEconomics | undefined = byRegion[region];
    if (r && r.refYieldTHa != null && r.priceUsdPerT != null && r.costUsdPerHa != null) {
      return {
        refYieldTHa: r.refYieldTHa,
        yieldRegion: r.yieldRegion,
        priceUsdPerT: r.priceUsdPerT,
        costUsdPerHa: r.costUsdPerHa,
        year: r.year,
        sources: r.sources.map((s) => `REFERENCE VALUE - ${s}`),
      };
    }
  }
  return undefined;
}

function main(): void {
  const raw = readEcoCropCsv(CSV);
  const cleaned = cleanEcoCrop(raw);
  const byName = new Map<string, CropProfile>();
  for (const p of cleaned.profiles.values()) byName.set(p.scientificName.toLowerCase(), p);
  const atlasPrevalence = readPrevalence(ATLAS_DIR);
  const referenceEconomics = readEconomics(ATLAS_DIR);

  // ---------------------------------------------------------------------------- curated profiles
  const curated: CropProfile[] = [];
  const curationNotes: Record<string, string[]> = {};
  const usedEcoIds = new Set<number>();
  const problems: string[] = [];

  for (const spec of SPECS) {
    const base = spec.eco ? byName.get(spec.eco.toLowerCase()) : undefined;
    if (spec.eco && !base) {
      problems.push(`overlay names "${spec.eco}", which is not a scorable EcoCrop row`);
      continue;
    }
    if (!base && !spec.fullReq) {
      problems.push(`"${spec.en}" has neither an EcoCrop row nor full requirements`);
      continue;
    }
    const id = slugify(spec.eco ?? spec.scientificName!);
    const req = { ...(base?.req ?? spec.fullReq!), ...(spec.req ?? {}) };
    const flags = new Set(base?.flags ?? []);
    if (!base) flags.add('not-in-ecocrop');
    if (spec.cycleDays) flags.delete('cycle-assumed');
    if (spec.req?.ph) flags.delete('ph-missing');
    if (spec.water.assumed) flags.add('water-model-assumed');
    const aliases = [...(spec.aliases ?? [])];
    if (spec.eco && spec.scientificName && spec.scientificName !== spec.eco) aliases.push(spec.eco);
    const economics = defaultEconomics(id, referenceEconomics);
    const profile: CropProfile = {
      id,
      ...(base?.ecocropId != null ? { ecocropId: base.ecocropId } : {}),
      scientificName: spec.scientificName ?? spec.eco!,
      names: { en: spec.en, vi: spec.vi, ...(aliases.length ? { aliases } : {}) },
      category: spec.category,
      lifeSpan: spec.lifeSpan ?? base?.lifeSpan ?? 'annual',
      req,
      cycleDays: spec.cycleDays ?? base!.cycleDays,
      water: spec.water.model,
      ...(economics ? { economics } : {}),
      rotation: spec.rotation,
      ...(spec.urban ? { urban: spec.urban } : {}),
      summary: { en: spec.summary[0], vi: spec.summary[1] },
      curated: true,
      ...(flags.size ? { flags: [...flags].sort() } : {}),
    };
    // Sanity checks: a broken overlay must fail the build, not ship.
    for (const key of ['tempC', 'rainMm', 'ph'] as const) if (!ordered(profile.req[key])) problems.push(`${id}: ${key} is not ordered: ${profile.req[key].join('/')}`);
    const stageSum = profile.water!.stages.reduce((a, b) => a + b, 0);
    if (Math.abs(stageSum - 1) > 0.01) problems.push(`${id}: stage fractions sum to ${stageSum}`);
    if (profile.cycleDays[0] > profile.cycleDays[1]) problems.push(`${id}: cycleDays reversed`);
    if (curated.some((c) => c.id === id)) problems.push(`${id}: duplicate curated id`);
    if (base?.ecocropId != null) usedEcoIds.add(base.ecocropId);
    curated.push(profile);
    curationNotes[id] = [...(spec.reqNotes ?? []), `water model: ${spec.water.model.source}`];
  }
  if (problems.length) throw new Error(`Curated overlay is inconsistent:\n  ${problems.join('\n  ')}`);
  if (curated.length < 45) throw new Error(`Only ${curated.length} curated crops; at least 45 are required`);

  for (const profile of curated) {
    const byCountry = atlasPrevalence[profile.id];
    if (!byCountry) continue;
    const prev: Record<Iso3, CropPrevalence> = {};
    for (const iso3 of ['VNM', 'USA']) {
      if (byCountry[iso3]) prev[iso3] = toCropPrevalence(byCountry[iso3]);
    }
    if (Object.keys(prev).length > 0) profile.prevalence = prev;
  }

  // ----------------------------------------------------------------------- prevalence (387 crops)
  const GROWN = new Set(['major', 'common', 'minor', 'present']);
  const prevalenceJson: Record<string, Record<Iso3, CropPrevalence>> = {};
  for (const [cropId, byCountry] of Object.entries(atlasPrevalence)) {
    const entry: Record<Iso3, CropPrevalence> = {};
    for (const [iso3, row] of Object.entries(byCountry)) {
      if (GROWN.has(row.level) || row.match === 'national' || iso3 === 'VNM' || iso3 === 'USA') {
        entry[iso3] = toCropPrevalence(row);
      }
    }
    prevalenceJson[cropId] = entry;
  }
  fs.mkdirSync(path.dirname(OUT_PREV), { recursive: true });
  fs.writeFileSync(OUT_PREV, JSON.stringify(prevalenceJson));

  // ------------------------------------------------------------------------------ full catalogue
  const rest = [...cleaned.profiles.values()].filter((p) => !usedEcoIds.has(p.ecocropId!) && !curated.some((c) => c.id === p.id));
  rest.sort((a, b) => a.id.localeCompare(b.id));
  const catalog = encodeCatalog(rest, {
    source: 'FAO EcoCrop (Food and Agriculture Organization of the United Nations, Land and Water Division); cleaned, see data/crops/CLEANING_LOG.md',
    generated: BUILD_DATE,
    commonNames: (p) => cleaned.commonNames.get(p.ecocropId!) ?? [],
    family: (p) => cleaned.families.get(p.ecocropId!) ?? '',
  });
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(catalog));

  // ---------------------------------------------------------------------------- generated module
  const ts = `/**
 * GENERATED by \`npm run crops:build\` (scripts/build-crop-catalog.ts) on ${BUILD_DATE}. Do not edit:
 * change scripts/crops/overlay-*.ts or scripts/crops/economics.ts and rebuild.
 *
 * ${curated.length} curated crops: EcoCrop thresholds (with the documented overrides), FAO-56 water
 * model, rotation and urban traits, and reference economics. Reference values are reference
 * values: sources and years are in each record and in docs/ECONOMICS.md.
 */
import type { CropProfile } from '@/contracts';
import type { ReferenceTable } from '@/core/economics/types';

export const CATALOG_META = ${JSON.stringify(
    {
      generated: BUILD_DATE,
      ecocropRows: cleaned.stats.rows,
      scorableSpecies: cleaned.stats.scorable,
      curated: curated.length,
      fullCatalogSpecies: rest.length + curated.length,
    },
    null,
    2,
  )} as const;

/** VND per USD used to show money in dong. */
export const EXCHANGE_RATE = ${JSON.stringify({ vndPerUsd: VND_PER_USD, asOf: FX_DATE, source: FX_SOURCE }, null, 2)} as const;

export const CURATED_CROPS: CropProfile[] = ${JSON.stringify(curated, null, 2)};

/** Yield, price and operating cost by region, with the quality of each source. */
export const REFERENCE_ECONOMICS: ReferenceTable = ${JSON.stringify(referenceEconomics, null, 2)};

/** Why each curated threshold differs from EcoCrop, and where the water model comes from. */
export const CURATION_NOTES: Record<string, string[]> = ${JSON.stringify(curationNotes, null, 2)};
`;
  fs.writeFileSync(OUT_TS, ts);

  // --------------------------------------------------------------------------------- cleaning log
  fs.mkdirSync(path.dirname(OUT_LOG), { recursive: true });
  fs.writeFileSync(OUT_LOG, cleaningLog(cleaned.events, cleaned.stats, curated, curationNotes, rest.length));
  fs.writeFileSync(OUT_CSV, curatedCsv(curated, referenceEconomics));

  const econRecordCount = Object.values(referenceEconomics).reduce((n, r) => n + Object.keys(r).length, 0);
  const kb = (f: string) => `${Math.round(fs.statSync(f).size / 1024)} kB`;
  console.log(`EcoCrop rows read:        ${cleaned.stats.rows}`);
  console.log(`Scorable species:         ${cleaned.stats.scorable} (${cleaned.stats['dropped:no-climate-window'] ?? 0} rows without a temperature or rainfall window dropped, ${cleaned.stats['merged-duplicates'] ?? 0} duplicate rows merged)`);
  console.log(`Repairs logged:           ${cleaned.events.length}`);
  console.log(`Curated crops:            ${curated.length} (${curated.filter((c) => c.prevalence).length} with bundled prevalence, ${curated.filter((c) => c.economics).length} with complete reference economics, ${curated.filter((c) => c.urban).length} for the urban tool)`);
  console.log(`Atlas prevalence crops:   ${Object.keys(prevalenceJson).length}`);
  console.log(`Reference economics rows: ${econRecordCount} (${Object.keys(referenceEconomics).length} crops)`);
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)} (${rest.length} species, ${kb(OUT_JSON)})`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PREV)} (${Object.keys(prevalenceJson).length} crops, ${kb(OUT_PREV)})`);
  console.log(`Wrote ${path.relative(ROOT, OUT_TS)} (${kb(OUT_TS)})`);
  console.log(`Wrote ${path.relative(ROOT, OUT_LOG)} and ${path.relative(ROOT, OUT_CSV)}`);
}

function cleaningLog(events: CleaningEvent[], stats: Record<string, number>, curated: CropProfile[], notes: Record<string, string[]>, restCount: number): string {
  const byField = new Map<string, CleaningEvent[]>();
  for (const e of events) byField.set(e.field, [...(byField.get(e.field) ?? []), e]);
  const lines: string[] = [];
  lines.push('# Crop catalogue cleaning log', '');
  lines.push(`Generated by \`npm run crops:build\` on ${BUILD_DATE} from \`data/ecocrop/ecocrop_2568_plants.csv\`. Do not edit by hand.`, '');
  lines.push('## Counts', '');
  lines.push('| Item | Count |', '|---|---|');
  lines.push(`| Rows in the EcoCrop CSV | ${stats.rows} |`);
  lines.push(`| Rows without a usable temperature or rainfall window (dropped: they cannot be scored) | ${stats['dropped:no-climate-window'] ?? 0} |`);
  lines.push(`| Duplicate rows merged into their species row | ${stats['merged-duplicates'] ?? 0} |`);
  lines.push(`| Scorable species | ${stats.scorable} |`);
  lines.push(`| of which curated (bundled with the app) | ${curated.filter((c) => c.ecocropId != null).length} |`);
  lines.push(`| Curated species EcoCrop does not hold | ${curated.filter((c) => c.ecocropId == null).length} |`);
  lines.push(`| Species in \`public/data/crops/ecocrop.json\` | ${restCount} |`);
  lines.push(`| Species with no growing cycle in EcoCrop (cycle 0): annuals get the median annual cycle ${stats.medianAnnualCycleMin}-${stats.medianAnnualCycleMax} days, others 365 days, flag \`cycle-assumed\` | ${stats['cycle-assumed'] ?? 0} |`);
  lines.push(`| Repairs listed below | ${events.length} |`, '');
  lines.push('Rules, in the order they are tried on a temperature, rainfall or pH window `absMin/optMin/optMax/absMax`:', '');
  lines.push('1. a value outside the physical range (temperature -10..60 °C, rainfall 0..12,000 mm, pH 2..11) is divided by 10 or 100 if that brings it inside;');
  lines.push(`2. a missing pair of limits is imputed (absolute limits from the median margin of the catalogue: ${stats.medianTempMarginLo} °C below and ${stats.medianTempMarginHi} °C above the optimum for temperature) and the crop is flagged;`);
  lines.push('3. a value at least three times the limit that should be above it is divided by 10 if that restores the order;');
  lines.push('4. absolute and optimal limits typed into each other\'s column are swapped back;');
  lines.push('5. otherwise the absolute window is widened to contain the optimal one; if that fails the window is dropped and the factor is treated as missing.', '');
  lines.push('Latitudes above 90 are altitudes typed into the latitude columns and are dropped. Nothing else is changed.', '');
  for (const [field, list] of [...byField.entries()].sort()) {
    lines.push(`## ${field} (${list.length})`, '', '| EcoCrop id | Species | As published | Action | Result |', '|---|---|---|---|---|');
    for (const e of list) lines.push(`| ${e.ecocropId} | ${e.name} | ${e.before} | ${e.action} | ${e.after} |`);
    lines.push('');
  }
  lines.push('## Curated overrides', '', 'Thresholds of curated crops that differ from the EcoCrop row, and the source of each water model.', '');
  for (const c of curated) {
    lines.push(`### ${c.names.en} (\`${c.id}\`${c.ecocropId != null ? `, EcoCrop ${c.ecocropId}` : ', not in EcoCrop'})`, '');
    for (const n of notes[c.id] ?? []) lines.push(`- ${n}`);
    if (c.flags?.length) lines.push(`- flags: ${c.flags.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

function curatedCsv(curated: CropProfile[], referenceEconomics: ReferenceTable): string {
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['id', 'ecocrop_id', 'scientific_name', 'name_en', 'name_vi', 'category', 'life_span', 'cycle_min_d', 'cycle_max_d', 'temp_c', 'rain_mm', 'ph', 'kc_ini', 'kc_mid', 'kc_end', 'root_depth_m', 'p', 'ky', 'family', 'n_fixing', 'urban', 'flags', 'water_model_source'];
  const rows = curated.map((c) =>
    [
      c.id,
      c.ecocropId,
      c.scientificName,
      c.names.en,
      c.names.vi,
      c.category,
      c.lifeSpan,
      c.cycleDays[0],
      c.cycleDays[1],
      c.req.tempC.join('/'),
      c.req.rainMm.join('/'),
      c.req.ph.join('/'),
      c.water?.kc.ini,
      c.water?.kc.mid,
      c.water?.kc.end,
      c.water?.rootDepthM,
      c.water?.depletionFraction,
      c.water?.ky,
      c.rotation?.family,
      c.rotation?.nitrogenFixing ? 'yes' : 'no',
      c.urban ? 'yes' : 'no',
      (c.flags ?? []).join(' '),
      c.water?.source,
    ]
      .map(cell)
      .join(','),
  );
  const econ: string[] = ['', 'REFERENCE ECONOMICS (reference values, not the farmer\'s own; operating cost only)', 'id,region,yield_t_ha,price_usd_t,cost_usd_ha,year,yield_quality,price_quality,cost_quality,yield_region,sources'];
  for (const [id, byRegion] of Object.entries(referenceEconomics))
    for (const r of Object.values(byRegion))
      econ.push([id, r.region, r.refYieldTHa, r.priceUsdPerT, r.costUsdPerHa, r.year, r.quality.yield, r.quality.price, r.quality.cost, r.yieldRegion, r.sources.join(' | ')].map(cell).join(','));
  return [header.join(','), ...rows, ...econ].join('\n') + '\n';
}

main();
