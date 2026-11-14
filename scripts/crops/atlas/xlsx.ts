/**
 * Minimal .xlsx writer: one worksheet per table, plain values only (inline strings and numbers),
 * header row bold and frozen. No formulas, no dates, no shared-string table: a pH of 5.5 is the
 * number 5.5 and a CPC code such as 01316 stays text, so Excel and Google Sheets convert nothing.
 */
import { buildZip } from './zip';
import type { Cell } from './csv';
import { formatNumber } from './csv';

export interface Sheet {
  name: string;
  columns: readonly string[];
  rows: readonly Cell[][];
  /** Column widths in characters; defaults to a width derived from the header. */
  widths?: readonly number[];
}

const xml = (s: string) =>
  s
    // Characters XML 1.0 forbids would make Excel refuse the whole file.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function columnLetter(index: number): string {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel limits a cell to 32,767 characters. */
const MAX_CELL = 32000;

function cellXml(ref: string, v: Cell, style: number): string {
  if (v == null || v === '') return '';
  const s = style ? ` s="${style}"` : '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${formatNumber(v)}</v></c>` : '';
  const text = v.length > MAX_CELL ? v.slice(0, MAX_CELL) + ' [cut]' : v;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

export function sheetXml(sheet: Sheet): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  out.push('<cols>');
  sheet.columns.forEach((c, i) => {
    const w = sheet.widths?.[i] ?? Math.min(40, Math.max(10, c.length + 2));
    out.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
  });
  out.push('</cols><sheetData>');
  out.push(`<row r="1">${sheet.columns.map((c, i) => cellXml(`${columnLetter(i)}1`, c, 1)).join('')}</row>`);
  sheet.rows.forEach((row, r) => {
    const n = r + 2;
    out.push(`<row r="${n}">${row.map((v, i) => cellXml(`${columnLetter(i)}${n}`, v, 0)).join('')}</row>`);
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

/** Sheet names: at most 31 characters, none of []:*?/\ . */
export const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, '_').slice(0, 31);

export function countCells(sheets: readonly Sheet[]): number {
  return sheets.reduce((n, s) => n + (s.rows.length + 1) * s.columns.length, 0);
}

export function buildXlsx(sheets: readonly Sheet[]): Buffer {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const contentTypes =
    head +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '</Types>';
  const rootRels =
    head +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook =
    head +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((s, i) => `<sheet name="${xml(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';
  const workbookRels =
    head +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';
  const styles =
    head +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '</styleSheet>';
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: '_rels/.rels', data: Buffer.from(rootRels) },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels) },
    { name: 'xl/styles.xml', data: Buffer.from(styles) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s)) })),
  ]);
}
