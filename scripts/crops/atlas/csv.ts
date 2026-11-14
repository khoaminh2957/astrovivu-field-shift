/**
 * CSV in and out. Output follows RFC 4180 quoting (a field is quoted when it holds a comma, a quote
 * or a line break; quotes are doubled) with LF line ends, as `.gitattributes` asks for the repo.
 */
export type Cell = string | number | null | undefined;

/** Numbers are written plainly (no exponent, no thousands separator) so a sheet reads them as numbers. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, '');
}

export function csvField(v: Cell): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? formatNumber(v) : v;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: readonly string[], rows: readonly Cell[][]): string {
  const lines = [columns.map(csvField).join(',')];
  for (const r of rows) lines.push(r.map(csvField).join(','));
  return lines.join('\n') + '\n';
}

/**
 * Splits one physical line. Enough for the large FAOSTAT and MapSPAM files, whose fields never
 * contain a line break; files with multi-line cells go through `parseCsv`.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let s = '';
      i++;
      for (;;) {
        const q = line.indexOf('"', i);
        if (q < 0) {
          s += line.slice(i);
          i = n;
          break;
        }
        s += line.slice(i, q);
        if (line[q + 1] === '"') {
          s += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      out.push(s);
      const c = line.indexOf(',', i);
      i = c < 0 ? n + 1 : c + 1;
    } else {
      const c = line.indexOf(',', i);
      if (c < 0) {
        out.push(line.slice(i));
        break;
      }
      out.push(line.slice(i, c));
      i = c + 1;
    }
  }
  return out;
}

/** Whole-text parser (quoted fields may span lines). Returns rows of fields, header included. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const src = text.replace(/^﻿/, '');
  const endField = () => {
    // Some FAO files pad quoted fields with spaces (` "0015" , "1" `): the padding is dropped.
    row.push(wasQuoted ? field : field.trim());
    field = '';
    wasQuoted = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '' && !wasQuoted) {
      field = '';
      quoted = true;
      wasQuoted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endField();
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (!wasQuoted) field += ch;
  }
  if (field !== '' || row.length) {
    endField();
    rows.push(row);
  }
  return rows;
}

/** Rows as objects keyed by the header row. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

export const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
