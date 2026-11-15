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
import { DEFAULT_REGION_ORDER, FX_DATE, FX_SOURCE, PREFER_VN, REFERENCE_ECONOMICS, VND_PER_USD } from './crops/economics';
import { FIELD_CROPS } from './crops/overlay-field';
import { GARDEN_CROPS } from './crops/overlay-garden';
import { PERENNIAL_AND_COVER_CROPS } from './crops/overlay-perennial';
import { parseCsvObjects } from './crops/atlas/csv';
import { water } from './crops/fao56';
import { cleanEcoCrop, readEcoCropCsv, type CleaningEvent } from './crops/parse';
import type { CuratedSpec } from './crops/types';
import { mergeUrbanTraits, qualifiesForUrbanCatalog, readUrbanTable } from './crops/urban-table';

const ROOT = path.resolve(import.meta.dirname, '..');
const ATLAS_DIR = path.join(ROOT, 'data/crops/atlas');
const CSV = path.join(ROOT, 'data/ecocrop/ecocrop_2568_plants.csv');
const ATLAS_CROPS_CSV = path.join(ROOT, 'data/crops/atlas/crops.csv');
/** Which atlas crops the EcoCrop rule selects (scripts/crops/atlas/urban.ts). Not a column of crops.csv, which the market database mirrors. */
const ATLAS_URBAN_CANDIDATES_CSV = path.join(ROOT, 'data/crops/atlas/urban_candidates.csv');
const ATLAS_URBAN_CSV = path.join(ROOT, 'data/crops/atlas/urban.csv');
const OUT_JSON = path.join(ROOT, 'public/data/crops/ecocrop.json');
const OUT_PREV = path.join(ROOT, 'public/data/crops/prevalence.json');
const OUT_TS = path.join(ROOT, 'src/core/crops/curated.generated.ts');
const OUT_LOG = path.join(ROOT, 'data/crops/CLEANING_LOG.md');
const OUT_CSV = path.join(ROOT, 'data/crops/curated-crops.csv');
const BUILD_DATE = '2026-11-14';

const SPECS: CuratedSpec[] = [...FIELD_CROPS, ...PERENNIAL_AND_COVER_CROPS, ...GARDEN_CROPS];
const ordered = (q: Quad) => q[0] <= q[1] && q[1] <= q[2] && q[2] <= q[3];

const URBAN_CANDIDATE_WATER: Record<string, ReturnType<typeof water>> = {
  'spinacia-oleracea': water('spinach'),
  'daucus-carota': water('carrot'),
  'raphanus-sativus-var-radicula': water('radish'),
  'brassica-oleracea-var-acephala': water('crucifer'),
  'brassica-oleracea-var-italica': water('crucifer'),
  'brassica-oleracea-var-botrytis': water('crucifer'),
  'brassica-oleracea-var-gongyloides': water('crucifer'),
  'beta-vulgaris-var-cicla': water('spinach', { assumed: 'Swiss chard is not named in FAO-56; Spinach row used' }),
  'beta-vulgaris-var-crassa': water('rootsGroup', { assumed: 'Garden beet uses the FAO-56 Roots and tubers group default' }),
  'cucurbita-pepo': water('cucurbitGroup', { assumed: 'Summer squash uses the FAO-56 Cucumber family group default' }),
  'capsicum-frutescens': water('pepper', { assumed: 'Chilli/Tabasco pepper uses the FAO-56 Sweet peppers row' }),
  'allium-schoenoprasum': water('onionGreen', { assumed: 'Chives uses the FAO-56 Onions, green row' }),
  'allium-sativum': water('onionGreen', { assumed: 'Garlic uses the FAO-56 Onions, green row' }),
  'petroselinum-crispum': water('smallVegGroup', { assumed: 'Parsley uses the FAO-56 Small vegetables group default' }),
  'anethum-graveolens': water('smallVegGroup', { assumed: 'Dill uses the FAO-56 Small vegetables group default' }),
  'thymus-vulgaris': water('mint', { stages: 'generic', assumed: 'Thyme uses the FAO-56 Mint row (same family Lamiaceae)' }),
};

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

  const atlasCropRows = parseCsvObjects(fs.readFileSync(ATLAS_CROPS_CSV, 'utf8'));
  const atlasById = new Map(atlasCropRows.map((r) => [r.crop_id, r]));
  const validAtlasIds = new Set(atlasById.keys());
  const urbanCandidateIds = new Set(
    parseCsvObjects(fs.readFileSync(ATLAS_URBAN_CANDIDATES_CSV, 'utf8'))
      .filter((r) => r.urban_candidate === 'yes')
      .map((r) => r.crop_id),
  );
  const urbanTable = readUrbanTable(fs.readFileSync(ATLAS_URBAN_CSV, 'utf8'), validAtlasIds);

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
    const cycleDays = spec.cycleDays ?? base!.cycleDays;
    const urbanMerged = spec.urban
      ? mergeUrbanTraits({ id, category: spec.category, cycleDays, req }, spec.urban, urbanTable.byCrop.get(id))
      : { urban: undefined, notes: [] as string[] };
    const profile: CropProfile = {
      id,
      ...(base?.ecocropId != null ? { ecocropId: base.ecocropId } : {}),
      scientificName: spec.scientificName ?? spec.eco!,
      names: { en: spec.en, vi: spec.vi, ...(aliases.length ? { aliases } : {}) },
      category: spec.category,
      lifeSpan: spec.lifeSpan ?? base?.lifeSpan ?? 'annual',
      req,
      cycleDays,
      water: spec.water.model,
      ...(economics ? { economics } : {}),
      rotation: spec.rotation,
      ...(urbanMerged.urban ? { urban: urbanMerged.urban } : {}),
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
    curationNotes[id] = [...(spec.reqNotes ?? []), `water model: ${spec.water.model.source}`, ...urbanMerged.notes];
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
  const urbanCandidates: CropProfile[] = [];
  for (const p of rest) {
    const atlasRow = atlasById.get(p.id);
    const entry = urbanTable.byCrop.get(p.id);
    if (atlasRow && urbanCandidateIds.has(p.id) && qualifiesForUrbanCatalog(entry)) {
      const merged = mergeUrbanTraits(p, undefined, entry);
      if (merged.urban) {
        const enName = atlasRow.name_en?.trim() || p.names.en;
        const w = URBAN_CANDIDATE_WATER[p.id] ?? water('smallVegGroup', { assumed: 'Uses the FAO-56 Small vegetables group default' });
        const flags = new Set(p.flags ?? []);
        if (w.assumed) flags.add('water-model-assumed');
        const byCountry = atlasPrevalence[p.id];
        const prev: Record<Iso3, CropPrevalence> = {};
        if (byCountry) {
          for (const iso3 of ['VNM', 'USA']) {
            if (byCountry[iso3]) prev[iso3] = toCropPrevalence(byCountry[iso3]);
          }
        }
        const candidate: CropProfile = {
          ...p,
          names: {
            ...p.names,
            en: enName,
            ...(atlasRow.name_vi?.trim() ? { vi: atlasRow.name_vi.trim() } : {}),
          },
          water: w.model,
          urban: merged.urban,
          ...(Object.keys(prev).length > 0 ? { prevalence: prev } : {}),
          ...(flags.size ? { flags: [...flags].sort() } : {}),
        };
        urbanCandidates.push(candidate);
        curationNotes[p.id] = [`water model: ${w.model.source}`, ...merged.notes];
      }
    }
  }
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
 * change scripts/crops/overlay-*.ts, scripts/crops/economics.ts or data/crops/atlas/urban.csv and rebuild.
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
      urbanSuitable: curated.filter((c) => c.urban?.suitable).length + urbanCandidates.length,
      fullCatalogSpecies: rest.length + curated.length,
    },
    null,
    2,
  )} as const;

/** VND per USD used to show money in dong. */
export const EXCHANGE_RATE = ${JSON.stringify({ vndPerUsd: VND_PER_USD, asOf: FX_DATE, source: FX_SOURCE }, null, 2)} as const;

export const CURATED_CROPS: CropProfile[] = ${JSON.stringify(curated, null, 2)};

/** Additional atlas urban candidates (\`urban_candidate = yes\`) with complete sourced container data in \`data/crops/atlas/urban.csv\`. */
export const URBAN_CANDIDATE_CROPS: CropProfile[] = ${JSON.stringify(urbanCandidates, null, 2)};

/** Yield, price and operating cost by region, with the quality of each source. */
export const REFERENCE_ECONOMICS: ReferenceTable = ${JSON.stringify(referenceEconomics, null, 2)};

/** Why each curated threshold differs from EcoCrop, and where the water model comes from. */
export const CURATION_NOTES: Record<string, string[]> = ${JSON.stringify(curationNotes, null, 2)};
`;
  fs.writeFileSync(OUT_TS, ts);

  // --------------------------------------------------------------------------------- cleaning log
  fs.mkdirSync(path.dirname(OUT_LOG), { recursive: true });
  fs.writeFileSync(OUT_LOG, cleaningLog(cleaned.events, cleaned.stats, curated, urbanCandidates, urbanTable.resolutions, curationNotes, rest.length));
  fs.writeFileSync(OUT_CSV, curatedCsv(curated, REFERENCE_ECONOMICS));

  const econRecordCount = Object.values(referenceEconomics).reduce((n, r) => n + Object.keys(r).length, 0);
  const kb = (f: string) => `${Math.round(fs.statSync(f).size / 1024)} kB`;
  console.log(`EcoCrop rows read:        ${cleaned.stats.rows}`);
  console.log(`Scorable species:         ${cleaned.stats.scorable} (${cleaned.stats['dropped:no-climate-window'] ?? 0} rows without a temperature or rainfall window dropped, ${cleaned.stats['merged-duplicates'] ?? 0} duplicate rows merged)`);
  console.log(`Repairs logged:           ${cleaned.events.length}`);
  console.log(`Curated crops:            ${curated.length} (${curated.filter((c) => c.prevalence).length} with bundled prevalence, ${curated.filter((c) => c.economics).length} with complete reference economics, ${curated.filter((c) => c.urban).length} curated + ${urbanCandidates.length} atlas candidates = ${curated.filter((c) => c.urban).length + urbanCandidates.length} for the urban tool)`);
  console.log(`Atlas prevalence crops:   ${Object.keys(prevalenceJson).length}`);
  console.log(`Reference economics rows: ${econRecordCount} (${Object.keys(referenceEconomics).length} crops)`);
  console.log(`Wrote ${path.relative(ROOT, OUT_JSON)} (${rest.length} species, ${kb(OUT_JSON)})`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PREV)} (${Object.keys(prevalenceJson).length} crops, ${kb(OUT_PREV)})`);
  console.log(`Wrote ${path.relative(ROOT, OUT_TS)} (${kb(OUT_TS)})`);
  console.log(`Wrote ${path.relative(ROOT, OUT_LOG)} and ${path.relative(ROOT, OUT_CSV)}`);
}

function cleaningLog(events: CleaningEvent[], stats: Record<string, number>, curated: CropProfile[], urbanCandidates: CropProfile[], urbanResolutions: string[], notes: Record<string, string[]>, restCount: number): string {
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
  lines.push(`| Urban container crops (\`urban.suitable = true\`: ${curated.filter((c) => c.urban?.suitable).length} curated + ${urbanCandidates.length} atlas \`urban_candidate = yes\` with full \`data/crops/atlas/urban.csv\` rows) | ${curated.filter((c) => c.urban?.suitable).length + urbanCandidates.length} |`);
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
  lines.push('## Atlas urban candidates (`data/crops/atlas/urban.csv`)', '', 'Uncurated `urban_candidate = yes` species that enter the urban catalogue with complete sourced container data (`sun_hours_min`, `pot_depth_min`, `difficulty`), and conservative resolutions when multiple extension sources report different container values.', '');
  if (urbanResolutions.length) {
    lines.push('### Multi-source conservative resolutions', '');
    for (const r of urbanResolutions) lines.push(`- ${r}`);
    lines.push('');
  }
  for (const c of urbanCandidates) {
    lines.push(`### ${c.names.en} (\`${c.id}\`, EcoCrop ${c.ecocropId})`, '');
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
