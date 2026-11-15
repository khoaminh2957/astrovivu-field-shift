import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ECONOMICS_COLUMNS } from './columns';
import { parseCsv, parseCsvObjects } from './csv';

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
    expect(refRows.length).toBeGreaterThanOrEqual(49);
    const completeRefRows = refRows.filter(
      (r) => r.yield_t_ha !== '' && r.price_usd_t !== '' && r.cost_usd_ha !== '',
    );
    expect(completeRefRows).toHaveLength(35);

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
