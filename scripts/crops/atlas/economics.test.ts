import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ECONOMICS_COLUMNS } from './columns';
import { parseCsv, parseCsvObjects } from './csv';
import { EXTRACT_COLUMNS, EXTRACT_FILE, faostatPriceCells, MAX_PRICE_AGE_YEARS, PRICE_ELEMENT, SOURCE_FILE } from './prices-extract';

const ECON_FILE = 'data/crops/atlas/economics.csv';
const TEMPLATE_FILE = 'data/crops/atlas/economics_template.csv';
const CROPS_FILE = 'data/crops/atlas/crops.csv';
const CURATED_FILE = 'data/crops/curated-crops.csv';

const QUALITIES = new Set(['official', 'budget', 'press', 'derived', 'none']);

describe('data/crops/atlas/economics.csv', () => {
  const raw = readFileSync(ECON_FILE, 'utf8');
  const [header] = parseCsv(raw);
  const rows = parseCsvObjects(raw);
  const crops = parseCsvObjects(readFileSync(CROPS_FILE, 'utf8'));
  const curatedIds = crops.filter((c) => c.curated === 'yes').map((c) => c.crop_id);

  it('has the 13 columns of economics_template.csv and covers all 73 curated crops in VNM, USA, IND and BRA (292 national pairs + 7 regional rows = 299)', () => {
    const [templateHeader] = parseCsv(readFileSync(TEMPLATE_FILE, 'utf8'));
    expect(header).toEqual(ECONOMICS_COLUMNS);
    expect(header).toEqual(templateHeader);
    expect(ECONOMICS_COLUMNS).toHaveLength(13);
    expect(curatedIds).toHaveLength(73);
    expect(rows).toHaveLength(299);

    for (const cropId of curatedIds) {
      for (const iso3 of ['VNM', 'USA', 'IND', 'BRA']) {
        const match = rows.find((r) => r.crop_id === cropId && r.iso3 === iso3 && r.region === '');
        expect(match, `missing national row for ${cropId} in ${iso3}`).toBeDefined();
      }
    }
  });

  it('preserves the 49 reference records from data/crops/curated-crops.csv with exact numbers', () => {
    const rawCurated = readFileSync(CURATED_FILE, 'utf8');
    const econSection = rawCurated.slice(rawCurated.indexOf('\nid,region,yield_t_ha,') + 1);
    const refRows = parseCsvObjects(econSection);
    expect(refRows).toHaveLength(49);

    for (const ref of refRows) {
      const iso3 = ref.region.startsWith('US') ? 'USA' : 'VNM';
      const region = ref.region === 'VN' || ref.region === 'US' ? '' : ref.region;
      const found = rows.find((r) => r.crop_id === ref.id && r.iso3 === iso3 && r.region === region);
      expect(found, `missing reference record ${ref.id} (${ref.region})`).toBeDefined();
      expect(found!.yield_t_ha).toBe(ref.yield_t_ha);
      expect(found!.price_usd_t).toBe(ref.price_usd_t);
      expect(found!.cost_usd_ha).toBe(ref.cost_usd_ha);
      expect(found!.year).toBe(ref.year);
      expect(found!.quality_yield).toBe(ref.yield_quality);
      expect(found!.quality_price).toBe(ref.price_quality);
      expect(found!.quality_cost).toBe(ref.cost_quality);
    }
  });

  it('every figure has a source, a year and an access date', () => {
    for (const r of rows) {
      const hasAnyFigure = r.yield_t_ha !== '' || r.price_usd_t !== '' || r.cost_usd_ha !== '';
      const label = `${r.crop_id} ${r.iso3} ${r.region}`;
      expect(r.source.trim().length, `empty source on ${label}`).toBeGreaterThan(0);
      expect(r.accessed, `invalid accessed date on ${label}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (hasAnyFigure) {
        expect(r.year, `missing or invalid year on ${label}`).toMatch(/^\d{4}$/);
        expect(r.url.trim().length, `empty url on ${label}`).toBeGreaterThan(0);
      }
      if (r.yield_t_ha !== '') expect(Number(r.yield_t_ha), `invalid yield on ${label}`).toBeGreaterThanOrEqual(0);
      if (r.price_usd_t !== '') expect(Number(r.price_usd_t), `invalid price on ${label}`).toBeGreaterThanOrEqual(0);
      if (r.cost_usd_ha !== '') expect(Number(r.cost_usd_ha), `invalid cost on ${label}`).toBeGreaterThan(0);
    }
  });

  it('quality is none exactly when the figure is empty', () => {
    for (const r of rows) {
      const label = `${r.crop_id} ${r.iso3} ${r.region}`;
      expect(QUALITIES.has(r.quality_yield), `invalid quality_yield on ${label}`).toBe(true);
      expect(QUALITIES.has(r.quality_price), `invalid quality_price on ${label}`).toBe(true);
      expect(QUALITIES.has(r.quality_cost), `invalid quality_cost on ${label}`).toBe(true);

      expect(r.quality_yield === 'none', `quality_yield mismatch on ${label}`).toBe(r.yield_t_ha === '');
      expect(r.quality_price === 'none', `quality_price mismatch on ${label}`).toBe(r.price_usd_t === '');
      expect(r.quality_cost === 'none', `quality_cost mismatch on ${label}`).toBe(r.cost_usd_ha === '');
    }
  });

  it('no duplicate crop_id, iso3, region and every crop_id is in crops.csv', () => {
    const cropSet = new Set(crops.map((c) => c.crop_id));
    const seen = new Set<string>();
    for (const r of rows) {
      expect(cropSet.has(r.crop_id), `unknown crop_id ${r.crop_id}`).toBe(true);
      const key = `${r.crop_id}|${r.iso3}|${r.region}`;
      expect(seen.has(key), `duplicate key ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

// The extract is rebuilt from the FAOSTAT bulk file by prices-extract.ts; this check needs only the CSVs.
describe(`FAOSTAT producer prices behind economics.csv (${EXTRACT_FILE})`, () => {
  const rows = parseCsvObjects(readFileSync(ECON_FILE, 'utf8'));
  const crops = parseCsvObjects(readFileSync(CROPS_FILE, 'utf8'));
  const rawExtract = readFileSync(EXTRACT_FILE, 'utf8');
  const extract = parseCsvObjects(rawExtract);
  const cells = faostatPriceCells(rows, crops);

  it('the extract holds annual FAOSTAT element 5532 rows (Producer Price, USD/tonne) only', () => {
    expect(parseCsv(rawExtract)[0]).toEqual([...EXTRACT_COLUMNS]);
    for (const e of extract) {
      expect(e.element_code, `${e.crop_id} ${e.iso3}`).toBe(PRICE_ELEMENT);
      expect(e.unit, `${e.crop_id} ${e.iso3}`).toBe('USD');
      expect(e.source_file, `${e.crop_id} ${e.iso3}`).toBe(SOURCE_FILE);
      expect(e.year, `${e.crop_id} ${e.iso3}`).toMatch(/^\d{4}$/);
      expect(e.accessed, `${e.crop_id} ${e.iso3}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every price that cites FAOSTAT producer prices equals the extract row of the same crop, country, item and year', () => {
    for (const c of cells) {
      const label = `${c.cropId} ${c.iso3} ${c.year}`;
      const match = extract.filter((e) => e.crop_id === c.cropId && e.iso3 === c.iso3 && e.year === c.year);
      expect(match, `${label}: no single extract row`).toHaveLength(1);
      expect(match[0].item_code, `${label}: item`).toBe(c.itemCode);
      expect(Number(match[0].value), `${label}: price`).toBe(Number(c.price));
    }
  });

  it('every extract row is referenced by a filled price or by a NOT FOUND text quoting its value and year', () => {
    expect(extract).toHaveLength(cells.length);
    for (const e of extract) {
      const label = `${e.crop_id} ${e.iso3} ${e.year}`;
      const match = cells.filter((c) => c.cropId === e.crop_id && c.iso3 === e.iso3 && c.year === e.year);
      expect(match, `${label}: no matching economics.csv row`).toHaveLength(1);
    }
  });

  it('no filled FAOSTAT price is more than 10 years older than its row\'s year', () => {
    for (const r of rows) {
      const cell = cells.find((c) => c.used && c.cropId === r.crop_id && c.iso3 === r.iso3);
      if (!cell) continue;
      const age = Number(r.year) - Number(cell.year);
      expect(age, `${r.crop_id} ${r.iso3}: row year ${r.year}, price year ${cell.year}`).toBeLessThanOrEqual(MAX_PRICE_AGE_YEARS);
    }
  });
});
