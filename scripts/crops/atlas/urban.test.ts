import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects } from './csv';
import type { AtlasSpecies } from './ecocrop';
import { URBAN_RULE, urbanCandidate, urbanCandidateRow } from './urban';

function mockSpecies(over: Partial<AtlasSpecies> = {}): AtlasSpecies {
  return {
    ecocropId: 1,
    scientificName: 'Testus plantus',
    authority: '',
    family: 'Compositae',
    synonyms: '',
    commonNames: '',
    commonNameList: [],
    lifeForm: 'herb',
    physiology: '',
    habit: 'erect',
    category: 'vegetables',
    lifeSpan: 'annual',
    plantAttributes: 'grown on large scale',
    usesMain: '',
    temp: [15, 25, 10, 35],
    rain: [500, 1000, 300, 1500],
    ph: [5.5, 6.8, 5, 7.5],
    latitude: [0, 45, 0, 60],
    altitude: [0, 1000, 0, 2000],
    soil: {
      depth: ['medium', 'shallow'],
      texture: ['medium', 'light'],
      fertility: ['moderate', 'low'],
      salinity: ['low', 'low'],
      drainage: ['well', 'well'],
      alToxicity: ['', ''],
    },
    light: ['clear skies', 'very bright', 'cloudy skies', 'very bright'],
    climateZones: '',
    photoperiod: '',
    killingTempRest: null,
    killingTempEarlyGrowth: null,
    cycleMin: 60,
    cycleMax: 90,
    cleaning: [],
    cultivated: true,
    taxon: null,
    synonymTaxa: [],
    ...over,
  };
}

describe('scripts/crops/atlas/urban (D1, #14)', () => {
  it('evaluates short-cycle and perennial-aromatic-herb clauses with positive and negative cases', () => {
    // 1. Short-cycle positive: annual vegetable herb with cycleMin = 60 <= 120
    expect(urbanCandidate(mockSpecies({ category: 'vegetables', lifeForm: 'herb', cycleMin: 60 }))).toEqual({
      candidate: true,
      rule: 'short-cycle',
    });

    // 2. Short-cycle negative: cycleMin = 150 > 120 on a non-aromatic annual vegetable
    expect(urbanCandidate(mockSpecies({ category: 'vegetables', lifeForm: 'herb', lifeSpan: 'annual', cycleMin: 150 }))).toEqual({
      candidate: false,
      rule: '',
    });

    // 3. Perennial aromatic herb positive: cycleMin = 240 > 120, but perennial + medicinals & aromatic + herb/sub-shrub
    expect(
      urbanCandidate(
        mockSpecies({
          category: 'medicinals & aromatic',
          lifeForm: 'herb, sub-shrub',
          lifeSpan: 'perennial',
          cycleMin: 240,
        }),
      ),
    ).toEqual({
      candidate: true,
      rule: 'perennial-aromatic-herb',
    });

    // 4. Both clauses positive: perennial aromatic herb with cycleMin = 80 <= 120
    expect(
      urbanCandidate(
        mockSpecies({
          category: 'vegetables, medicinals & aromatic',
          lifeForm: 'herb',
          lifeSpan: 'perennial',
          cycleMin: 80,
        }),
      ),
    ).toEqual({
      candidate: true,
      rule: 'short-cycle;perennial-aromatic-herb',
    });

    // 5. Tree exclusion: any row whose life_form includes tree is rejected
    expect(
      urbanCandidate(
        mockSpecies({
          category: 'fruits & nuts',
          lifeForm: 'shrub, tree',
          cycleMin: 90,
        }),
      ),
    ).toEqual({
      candidate: false,
      rule: '',
    });

    // 6. Field-crop filter: medicinals & aromatic paired with roots/tubers or pulses (non-climber, cycleMin > 60) is rejected
    expect(
      urbanCandidate(
        mockSpecies({
          category: 'roots/tubers, medicinals & aromatic',
          lifeForm: 'herb',
          habit: 'erect',
          cycleMin: 90,
        }),
      ),
    ).toEqual({
      candidate: false,
      rule: '',
    });
    // Climbing pulse with medicinals & aromatic and cycleMin <= 120 is accepted
    expect(
      urbanCandidate(
        mockSpecies({
          category: 'pulses (grain legumes), medicinals & aromatic',
          lifeForm: 'herb',
          habit: 'prostrate/procumbent/semi-erect, climber/scrambler/scadent',
          cycleMin: 60,
        }),
      ),
    ).toEqual({
      candidate: true,
      rule: 'short-cycle',
    });
  });

  it('rejects missing species or empty EcoCrop cells without guessing', () => {
    expect(urbanCandidate(null)).toEqual({ candidate: false, rule: '' });
    expect(urbanCandidate(undefined)).toEqual({ candidate: false, rule: '' });
    expect(urbanCandidate(mockSpecies({ lifeForm: '' }))).toEqual({ candidate: false, rule: '' });
    expect(urbanCandidate(mockSpecies({ category: '' }))).toEqual({ candidate: false, rule: '' });
    expect(urbanCandidate(mockSpecies({ cycleMin: null, lifeSpan: '' }))).toEqual({ candidate: false, rule: '' });
  });

  it('contains no crop names or crop_ids in scripts/crops/atlas/urban.ts', () => {
    const code = readFileSync('scripts/crops/atlas/urban.ts', 'utf8');
    const crops = parseCsvObjects(readFileSync('data/crops/atlas/crops.csv', 'utf8'));
    for (const c of crops) {
      expect(code.includes(c.crop_id), `urban.ts must not mention crop_id ${c.crop_id}`).toBe(false);
    }
    expect(URBAN_RULE.maxCycleMinDays).toBe(120);
  });

  it('writes urban_candidates.csv with one row per crop of crops.csv, in its order, and the counts of summary.csv', () => {
    const crops = parseCsvObjects(readFileSync('data/crops/atlas/crops.csv', 'utf8'));
    const [header, ...rows] = parseCsv(readFileSync('data/crops/atlas/urban_candidates.csv', 'utf8'));
    const summary = new Map(
      parseCsvObjects(readFileSync('data/crops/atlas/summary.csv', 'utf8')).map((r) => [r.metric, r.value]),
    );

    expect(header).toEqual(['crop_id', 'urban_candidate', 'urban_candidate_rule']);
    expect(rows.map((r) => r[0])).toEqual(crops.map((c) => c.crop_id));

    const yesRows = rows.filter((r) => r[1] === 'yes');
    expect(yesRows.length).toBeGreaterThan(32);
    expect(yesRows.length).toBe(106);
    expect(Number(summary.get('urban_candidates'))).toBe(yesRows.length);

    for (const [, candidate, rule] of rows) {
      if (candidate === 'yes') {
        expect(rule).toMatch(/^(short-cycle|perennial-aromatic-herb|short-cycle;perennial-aromatic-herb)$/);
      } else {
        expect(candidate).toBe('');
        expect(rule).toBe('');
      }
    }

    // Broadacre field crops excluded by the refined rule
    for (const fieldId of ['arachis-hypogaea', 'solanum-tuberosum', 'lens-culinaris', 'linum-usitatissimum']) {
      const row = rows.find((r) => r[0] === fieldId);
      expect(row?.[1], `${fieldId} should not be an urban candidate`).toBe('');
    }
  });

  it('holds in urban_candidates.csv exactly what the rule computes from the EcoCrop columns of crops.csv', () => {
    // The five cells the rule reads are copied from EcoCrop into crops.csv, so the file can be recomputed from it.
    const crops = parseCsvObjects(readFileSync('data/crops/atlas/crops.csv', 'utf8'));
    const rows = parseCsv(readFileSync('data/crops/atlas/urban_candidates.csv', 'utf8')).slice(1);
    const computed = crops.map((c) =>
      urbanCandidateRow(
        c.crop_id,
        mockSpecies({
          lifeForm: c.life_form,
          habit: c.habit,
          category: c.category,
          lifeSpan: c.life_span,
          cycleMin: c.cycle_min_days === '' ? null : Number(c.cycle_min_days),
        }),
      ),
    );
    expect(rows).toEqual(computed);
  });

  it('leaves crops.csv, which the market database mirrors, without an urban column', () => {
    const header = parseCsv(readFileSync('data/crops/atlas/crops.csv', 'utf8'))[0];
    expect(header.filter((c) => c.startsWith('urban_'))).toEqual([]);
  });

  it('describes the columns of urban_candidates in columns.csv, and none of them under crops', () => {
    const columns = parseCsvObjects(readFileSync('data/crops/atlas/columns.csv', 'utf8'));
    const described = columns.filter((c) => c.table === 'urban_candidates');
    expect(described.map((c) => c.column)).toEqual(['crop_id', 'urban_candidate', 'urban_candidate_rule']);
    for (const c of described) expect(c.meaning_en && c.meaning_vi, c.column).toBeTruthy();
    expect(columns.filter((c) => c.table === 'crops' && c.column.startsWith('urban_'))).toEqual([]);
  });
});
