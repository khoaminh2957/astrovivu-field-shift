import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvField, formatNumber, parseCsv, parseCsvLine, parseCsvObjects, round, toCsv } from './csv';
import { buildXlsx, columnLetter, countCells, sheetXml } from './xlsx';
import { buildZip, listZip, openZipEntry, readZipEntry } from './zip';

describe('CSV writer', () => {
  it('quotes only what RFC 4180 requires and doubles quotes', () => {
    expect(csvField('Rice')).toBe('Rice');
    expect(csvField('Beans, dry')).toBe('"Beans, dry"');
    expect(csvField('the "golden" gram')).toBe('"the ""golden"" gram"');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(' padded ')).toBe('" padded "');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField('')).toBe('');
  });

  it('writes numbers plainly: no exponent, no thousands separator, no float noise', () => {
    expect(formatNumber(7089041)).toBe('7089041');
    expect(formatNumber(5.5)).toBe('5.5');
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(0.000004)).toBe('0.000004');
    expect(formatNumber(Number.NaN)).toBe('');
    expect(csvField(0)).toBe('0');
    expect(round(52.49349, 3)).toBe(52.493);
  });

  it('writes a header row, LF line ends and an empty cell for an unknown', () => {
    expect(toCsv(['crop_id', 'ph_opt_min', 'name'], [['oryza-sativa', 5.5, null], ['x', null, 'a,b']])).toBe('crop_id,ph_opt_min,name\noryza-sativa,5.5,\nx,,"a,b"\n');
  });

  it('round-trips through the parser, quoted line breaks included', () => {
    const rows = [
      ['a', 'Beans, dry', 'say "hi"'],
      ['b', 'two\nlines', ''],
    ];
    const text = toCsv(['id', 'name', 'note'], rows);
    expect(parseCsv(text)).toEqual([['id', 'name', 'note'], ...rows]);
    expect(parseCsvObjects(text)[1]).toEqual({ id: 'b', name: 'two\nlines', note: '' });
  });
});

describe('CSV readers', () => {
  it('splits a FAOSTAT line with quoted commas and an empty unquoted value', () => {
    expect(parseCsvLine('"2","\'004","Afghanistan","221","\'01371","Almonds, in shell","5312","Area harvested","1961","1961","ha",,"M",')).toEqual([
      '2',
      "'004",
      'Afghanistan',
      '221',
      "'01371",
      'Almonds, in shell',
      '5312',
      'Area harvested',
      '1961',
      '1961',
      'ha',
      '',
      'M',
      '',
    ]);
  });

  it('drops the padding FAO puts around quoted fields and a byte-order mark', () => {
    expect(parseCsv('﻿ "code" , "label" ,\n "0015" , "Wheat" ,\n')).toEqual([
      ['code', 'label', ''],
      ['0015', 'Wheat', ''],
    ]);
  });
});

describe('zip and xlsx', () => {
  it('writes an archive its own reader can list, read and stream', async () => {
    const big = Buffer.from('area,value\n'.repeat(20000));
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'dir/b.csv', data: big },
    ]);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-zip-')), 't.zip');
    fs.writeFileSync(file, zip);
    const entries = listZip(file);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ['a.txt', 5],
      ['dir/b.csv', big.length],
    ]);
    expect(readZipEntry(file, entries[0]).toString()).toBe('hello');
    const chunks: Buffer[] = [];
    for await (const c of openZipEntry(file, entries[1])) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).equals(big)).toBe(true);
    // Same input, same bytes: the archive carries no clock.
    expect(buildZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'dir/b.csv', data: big }]).equals(zip)).toBe(true);
    fs.rmSync(path.dirname(file), { recursive: true });
  });

  it('writes numbers as numbers and text as inline strings, escaped', () => {
    const xml = sheetXml({ name: 't', columns: ['crop', 'ph', 'cpc'], rows: [['R&D <1>', 5.5, '01316'], ['x', null, '']] });
    expect(xml).toContain('<c r="B2"><v>5.5</v></c>');
    expect(xml).toContain('<c r="C2" t="inlineStr"><is><t xml:space="preserve">01316</t></is></c>');
    expect(xml).toContain('R&amp;D &lt;1&gt;');
    expect(xml).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(xml).toContain('state="frozen"');
    expect(xml).not.toContain('r="B3"');
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(78)).toBe('CA');
  });

  it('builds a workbook with one part per sheet', () => {
    const sheets = [
      { name: 'README', columns: ['topic', 'text'], rows: [['What', 'atlas']] },
      { name: 'crops', columns: ['crop_id'], rows: [['oryza-sativa'], ['zea-mays']] },
    ];
    expect(countCells(sheets)).toBe(4 + 3);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-xlsx-')), 't.xlsx');
    fs.writeFileSync(file, buildXlsx(sheets));
    const names = listZip(file).map((e) => e.name);
    expect(names).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    expect(readZipEntry(file, listZip(file)[2]).toString()).toContain('<sheet name="crops" sheetId="2" r:id="rId2"/>');
    fs.rmSync(path.dirname(file), { recursive: true });
  });
});
