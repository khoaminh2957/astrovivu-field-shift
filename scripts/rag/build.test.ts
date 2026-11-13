import { describe, expect, it } from 'vitest';
import { packParagraphs, parseWikiSections } from './chunk';
import { noteSections, toFacts } from './ecocrop';
import { parseGlossary } from './build';
import fs from 'node:fs';
import path from 'node:path';

describe('wiki sections', () => {
  it('tracks heading paths', () => {
    const s = parseWikiSections('Lead text.\n\n== Cultivation ==\nGrow it.\n\n=== Soil ===\nLoam.\n\n== History ==\nOld.');
    expect(s.map((x) => x.path)).toEqual([[], ['Cultivation'], ['Cultivation', 'Soil'], ['History']]);
  });
  it('packs paragraphs into 150-300 word chunks', () => {
    const para = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + '.';
    const out = packParagraphs([para(120), para(120), para(120), para(30)].join('\n'));
    expect(out).toHaveLength(2);
    const words = out.map((o) => o.split(/\s+/).length);
    expect(Math.max(...words)).toBeLessThanOrEqual(300);
  });
});

describe('EcoCrop cleaning', () => {
  const row = (over: Record<string, string>) => ({ name: 'Testus plantus', ecocrop_id: '1', common_names: 'test plant, tp', notes: '', ...over });
  it('drops wrong-scale temperatures and zero cycles, and records it', () => {
    const f = toFacts(row({ eco_temperat_requir_opt_min: '200', eco_temperat_requir_opt_max: '30', cult_cycle_min: '0', cult_cycle_max: '0' }));
    expect(f.temp?.[1]).toBeNull();
    expect(f.temp?.[2]).toBe(30);
    expect(f.cycle).toBeNull();
    expect(f.cleaning).toEqual(expect.arrayContaining(['temperature value 200 out of range, dropped', 'growing cycle 0 = missing']));
  });
  it('splits the notes narrative and drops common names and sources', () => {
    const s = noteSections('DESCRIPTION: A herb. USES: Food. COMMON NAMES Foo, Bar. GROWING PERIOD: 90 days. SOURCES: X.');
    expect(s.map((x) => x.head)).toEqual(['DESCRIPTION', 'USES', 'GROWING PERIOD']);
  });
});

describe('glossary', () => {
  const read = (l: string) => parseGlossary(fs.readFileSync(path.resolve(import.meta.dirname, `../../data/rag/glossary.${l}.md`), 'utf8'));
  it('has the same entries in English and Vietnamese', () => {
    const en = read('en').map((e) => e.id);
    const vi = read('vi').map((e) => e.id);
    expect(en).toEqual(vi);
    expect(en).toEqual(expect.arrayContaining(['ndvi', 'evapotranspiration', 'soil-moisture-anomaly', 'water-balance', 'frost-risk', 'satellite-vs-ground', 'confidence-badge', 'crop-coefficient', 'growing-degree-days']));
  });
});
