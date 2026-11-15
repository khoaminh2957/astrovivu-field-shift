import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvObjects } from './csv';

const ATLAS_DIR = path.resolve(process.cwd(), 'data/crops/atlas');

const TABLES = [
  'crops',
  'crop_country',
  'item_country',
  'country_crops',
  'region_crops',
  'items',
  'spam_crops',
  'dropped',
  'sources',
  'columns',
  'summary',
  'economics_template',
] as const;

describe('columns.csv dictionary alignment', () => {
  it('lists every column of all 12 atlas tables in exact header order, and economics.csv matches economics_template.csv', () => {
    const dictRows = parseCsvObjects(readFileSync(path.join(ATLAS_DIR, 'columns.csv'), 'utf8'));
    for (const table of TABLES) {
      const firstLine = readFileSync(path.join(ATLAS_DIR, `${table}.csv`), 'utf8').split(/\r?\n/)[0] ?? '';
      const headerCols = firstLine.split(',');
      const dictCols = dictRows.filter((r) => r.table === table).map((r) => r.column);
      expect(dictCols, `columns.csv vs ${table}.csv`).toEqual(headerCols);
    }
    const econHeader = readFileSync(path.join(ATLAS_DIR, 'economics.csv'), 'utf8').split(/\r?\n/)[0] ?? '';
    const tmplHeader = readFileSync(path.join(ATLAS_DIR, 'economics_template.csv'), 'utf8').split(/\r?\n/)[0] ?? '';
    expect(econHeader).toBe(tmplHeader);
  });
});
