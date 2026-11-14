/** One CSV record on one line (FAOSTAT quotes every text field and never breaks a line inside one). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let v = '';
      i++;
      for (;;) {
        const q = line.indexOf('"', i);
        if (q < 0) {
          v += line.slice(i);
          i = n;
          break;
        }
        v += line.slice(i, q);
        if (line[q + 1] === '"') {
          v += '"'; // a doubled quote is a literal quote
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      out.push(v);
      i++; // the comma after the closing quote
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

const NEEDS_QUOTES = /[",\n\r]/;
export const csvCell = (v: string | number | boolean | null | undefined): string => {
  const s = v == null ? '' : String(v);
  return NEEDS_QUOTES.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const csvLine = (cells: (string | number | boolean | null | undefined)[]): string => cells.map(csvCell).join(',');
