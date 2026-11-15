import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCrop, listCrops, loadFullCatalog } from '../../src/core/crops';
import { parseCsvObjects } from './atlas/csv';

describe('CropRequirements.alToxicity (T9, #13)', () => {
  it('populates req.alToxicity on curated crops that have EcoCrop values and leaves it undefined on all others', () => {
    const pinto = getCrop('arachis-pintoi');
    expect(pinto?.req.alToxicity).toEqual({ opt: 'low', abs: 'medium' });

    for (const id of ['coffea-canephora', 'oryza-sativa', 'zea-mays', 'glycine-max', 'medicago-sativa']) {
      expect(getCrop(id)?.req.alToxicity, `${id} should have no default alToxicity`).toBeUndefined();
    }

    const curatedWithAl = listCrops().filter((c) => c.req.alToxicity != null);
    expect(curatedWithAl.map((c) => c.id)).toEqual(['arachis-pintoi']);
  });

  it('encodes and decodes req.alToxicity in public/data/crops/ecocrop.json for all EcoCrop species with data', async () => {
    const rawCatalog = JSON.parse(readFileSync('public/data/crops/ecocrop.json', 'utf8'));
    const all = await loadFullCatalog(() => Promise.resolve(rawCatalog));

    expect(getCrop('amaranthus-caudatus')?.req.alToxicity).toEqual({ opt: 'none', abs: 'low' });
    expect(getCrop('beta-vulgaris-var-saccharifera')?.req.alToxicity).toEqual({ opt: 'medium', abs: 'high' });
    expect(getCrop('sorbus-domestica')?.req.alToxicity).toEqual({ opt: 'low', abs: 'low' });
    expect(getCrop('vigna-parkeri')?.req.alToxicity).toEqual({ opt: 'low', abs: 'medium' });
    expect(getCrop('vigna-vexillata')?.req.alToxicity).toEqual({ opt: 'low', abs: 'medium' });
    expect(getCrop('vetiveria-zizanioides')?.req.alToxicity).toEqual({ opt: 'none', abs: 'medium' });

    const withAl = all.filter((c) => c.req.alToxicity != null);
    expect(withAl.length).toBeGreaterThanOrEqual(50);
    for (const c of all) {
      if (c.req.alToxicity) {
        expect(['none', 'low', 'medium', 'high']).toContain(c.req.alToxicity.opt);
        expect(['none', 'low', 'medium', 'high']).toContain(c.req.alToxicity.abs);
      } else {
        expect(c.req.alToxicity).toBeUndefined();
      }
    }

    // Cross-check the 8 kept atlas crops in data/crops/atlas/crops.csv
    const atlasCrops = parseCsvObjects(readFileSync('data/crops/atlas/crops.csv', 'utf8'));
    const atlasWithAl = atlasCrops.filter((r) => r.soil_al_toxicity_opt !== '' || r.soil_al_toxicity_abs !== '');
    expect(atlasWithAl).toHaveLength(8);
    for (const row of atlasWithAl) {
      const crop = getCrop(row.crop_id);
      expect(crop?.req.alToxicity, `missing req.alToxicity for ${row.crop_id}`).toBeDefined();
      expect(row.soil_al_toxicity_opt.toLowerCase().startsWith(crop!.req.alToxicity!.opt)).toBe(true);
      expect(row.soil_al_toxicity_abs.toLowerCase().startsWith(crop!.req.alToxicity!.abs)).toBe(true);
    }
  });
});
