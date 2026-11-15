import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ECONOMICS_COLUMNS } from './columns';
import { parseCsv, parseCsvObjects } from './csv';
import { EXTRACT_COLUMNS, EXTRACT_FILE, faostatPriceCells, PRICE_ELEMENT, SOURCE_FILE } from './prices-extract';

const ECON_FILE = 'data/crops/atlas/economics.csv';
const TEMPLATE_FILE = 'data/crops/atlas/economics_template.csv';
const CROPS_FILE = 'data/crops/atlas/crops.csv';
const CURATED_FILE = 'data/crops/curated-crops.csv';

const VALID_QUALITIES = new Set(['official', 'budget', 'press', 'derived', 'none']);

describe('data/crops/atlas/economics.csv', () => {
  const rawEcon = readFileSync(ECON_FILE, 'utf8');
  const [header] = parseCsv(rawEcon);
  const rows = parseCsvObjects(rawEcon);
  const crops = parseCsvObjects(readFileSync(CROPS_FILE, 'utf8'));
  const curatedIds = crops.filter((c) => c.curated === 'yes').map((c) => c.crop_id);

  it('has the 13 columns of economics_template.csv and covers all 73 curated crops in VNM and USA (146 pairs)', () => {
    const [templateHeader] = parseCsv(readFileSync(TEMPLATE_FILE, 'utf8'));
    expect(header).toEqual(ECONOMICS_COLUMNS);
    expect(header).toEqual(templateHeader);
    expect(ECONOMICS_COLUMNS).toHaveLength(13);
    expect(curatedIds).toHaveLength(73);

    for (const cropId of curatedIds) {
      for (const iso3 of ['VNM', 'USA']) {
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
      const hasFigure = r.yield_t_ha !== '' || r.price_usd_t !== '' || r.cost_usd_ha !== '';
      expect(r.source.trim().length, `${r.crop_id} ${r.iso3}: empty source`).toBeGreaterThan(0);
      expect(r.url.trim().length, `${r.crop_id} ${r.iso3}: empty url`).toBeGreaterThan(0);
      expect(r.accessed, `${r.crop_id} ${r.iso3}: invalid accessed date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (hasFigure) {
        expect(r.year, `${r.crop_id} ${r.iso3}: figure without year`).toMatch(/^\d{4}$/);
      }
      for (const [col, label] of [
        ['yield_t_ha', 'yield:'],
        ['price_usd_t', 'price:'],
        ['cost_usd_ha', 'cost:'],
      ] as const) {
        expect(r.source, `${r.crop_id} ${r.iso3}: source missing ${label}`).toContain(label);
        if (r[col] !== '') {
          expect(Number.isFinite(Number(r[col])), `${r.crop_id} ${r.iso3}: non-numeric ${col}`).toBe(true);
        }
      }
    }
  });

  it('quality is none exactly when the figure is empty', () => {
    for (const r of rows) {
      for (const [figCol, qualCol] of [
        ['yield_t_ha', 'quality_yield'],
        ['price_usd_t', 'quality_price'],
        ['cost_usd_ha', 'quality_cost'],
      ] as const) {
        const val = r[figCol];
        const qual = r[qualCol];
        expect(VALID_QUALITIES.has(qual), `${r.crop_id} ${r.iso3}: invalid ${qualCol}=${qual}`).toBe(true);
        if (val === '') {
          expect(qual, `${r.crop_id} ${r.iso3}: empty ${figCol} must have ${qualCol}=none`).toBe('none');
        } else {
          expect(qual, `${r.crop_id} ${r.iso3}: non-empty ${figCol}=${val} cannot have ${qualCol}=none`).not.toBe('none');
        }
      }
    }
  });

  it('no duplicate crop_id, iso3, region and every crop_id is in crops.csv', () => {
    const knownCropIds = new Set(crops.map((c) => c.crop_id));
    const seen = new Set<string>();
    for (const r of rows) {
      expect(knownCropIds.has(r.crop_id), `unknown crop_id ${r.crop_id}`).toBe(true);
      const key = `${r.crop_id}:${r.iso3}:${r.region}`;
      expect(seen.has(key), `duplicate row for ${key}`).toBe(false);
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

  it('25 prices cite FAOSTAT producer prices: 12 via crop_latest_prices (2 VNM, 10 USA) and 13 VNM reference records', () => {
    expect(cells).toHaveLength(25);
    const viaView = rows.filter((r) => r.price_usd_t !== '' && /price: [^|]*crop_latest_prices/.test(r.source));
    expect(viaView.filter((r) => r.iso3 === 'VNM')).toHaveLength(2);
    expect(viaView.filter((r) => r.iso3 === 'USA')).toHaveLength(10);
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

  it('every extract row is used by one of those prices', () => {
    expect(extract).toHaveLength(cells.length);
    for (const e of extract) {
      const used = cells.filter((c) => c.cropId === e.crop_id && c.iso3 === e.iso3 && c.year === e.year);
      expect(used, `${e.crop_id} ${e.iso3} ${e.year}: unused extract row`).toHaveLength(1);
    }
  });
});
