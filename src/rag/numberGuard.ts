/**
 * The check that an answer written by a language model holds no number of its own (issue C4). Pure.
 *
 * `unsupportedNumbers(answer, sources)` reads every number in the answer and returns those that
 * are in none of the sources: the results of the lookup functions, the field context, the
 * retrieved passages and the question itself. The server drops an answer with such a number and
 * gives the extractive one instead. It is a net, not a proof: a number that is in the sources can
 * still be said of the wrong thing, and a quantity written in words ("three") is not read.
 *
 * How a number is read:
 *  - `7,089,041` and `7.089.041` are one number, and `6,1` and `6.1` are one number. A lone mark
 *    before exactly three digits (`6.094`, `1,173`) can be either: both readings are tried.
 *  - A written number may be a rounding of its source, to the digits it was written with:
 *    `6,1` stands for 6.094, `43 %` for 43.2, `7.1 million` for 7,089,041, and `7,100,000` (at
 *    least two digits before the zeros) for 7,089,041. Nothing looser: `170` does not stand for 168.
 *  - The sign is not compared: a hyphen is also a range mark (`5-95 %`).
 *
 * What is not a number of the answer: citation marks (`[S2]`), the numbering of a list (`1.` at
 * the start of a line) and digits inside a name (`ERA5`, `MOD13Q1`, `v2.0`, `Sentinel-2`).
 */

interface Reading {
  value: number;
  /** Digits after the decimal mark as written. */
  decimals: number;
  /** 1, or the size of the word that follows ("million", "triệu"). */
  scale: number;
}

const TOKEN = /\d+(?:[.,]\d+)*/g;

/** Size words after a number. "tỉ lệ" (ratio) is not a billion. */
const SCALES: [RegExp, number][] = [
  [/^\s?(?:millions?|triệu)(?!\p{L})/iu, 1e6],
  [/^\s?(?:billions?|tỷ|tỉ(?!\s*lệ))(?!\p{L})/iu, 1e9],
  [/^\s?(?:thousands?|nghìn|ngàn)(?!\p{L})/iu, 1e3],
];

const whole = (digits: string): Omit<Reading, 'scale'> => ({ value: Number(digits), decimals: 0 });

/** The ways a token can be read; each is a list of values that all have to be found. */
function readings(token: string): Omit<Reading, 'scale'>[][] {
  const parts = token.split(/[.,]/);
  const marks = token.replace(/\d/g, '');
  if (!marks) return [[whole(token)]];
  const last = parts[parts.length - 1];
  // Groups of three after a first group of one to three digits: the marks group thousands.
  const grouped = parts.slice(1).every((p) => p.length === 3) && parts[0].length <= 3 && !(parts[0].length > 1 && parts[0].startsWith('0'));
  if (marks.length === 1) {
    const out = [[{ value: Number(`${parts[0]}.${last}`), decimals: last.length }]];
    if (grouped && parts[0] !== '0') out.push([whole(parts.join(''))]);
    // "tháng 3,5": two small numbers, not three and a half.
    if (marks === ',' && parts[0].length <= 2 && last.length <= 2) out.push([whole(parts[0]), whole(last)]);
    return out;
  }
  if (new Set(marks).size === 1) return grouped ? [[whole(parts.join(''))]] : [parts.map(whole)];
  // Two kinds of mark: the last is the decimal mark, those before it group thousands (1.234.567,89).
  const head = parts.slice(0, -1);
  const headMarks = marks.slice(0, -1);
  if (new Set(headMarks).size === 1 && headMarks[0] !== marks[marks.length - 1] && head.slice(1).every((p) => p.length === 3))
    return [[{ value: Number(`${head.join('')}.${last}`), decimals: last.length }]];
  return [parts.map(whole)];
}

function scaleAfter(text: string, end: number): number {
  const rest = text.slice(end, end + 12);
  for (const [re, size] of SCALES) if (re.test(rest)) return size;
  return 1;
}

/** A token that is part of a name: glued to a letter before it (`ERA5`), or a short number after `letter-` (`Sentinel-2`). */
function inName(text: string, start: number, token: string): boolean {
  const before = text.slice(Math.max(0, start - 2), start);
  if (/\p{L}$/u.test(before)) return true;
  return /^\d{1,2}$/.test(token) && /\p{L}-$/u.test(before);
}

interface Known {
  /** Every value the sources hold, under every reading; with a size word, both the figure and the product. */
  values: number[];
  /** Digits inside a name (`v2.0` of "SoilGrids v2.0"), as written: they stand for themselves only, not for a quantity "2". */
  names: Set<string>;
}

function sourceValues(sources: string[]): Known {
  const values = new Set<number>();
  const names = new Set<string>();
  for (const text of sources) {
    for (const m of text.matchAll(TOKEN)) {
      if (inName(text, m.index, m[0])) {
        names.add(m[0]);
        continue;
      }
      const scale = scaleAfter(text, m.index + m[0].length);
      for (const reading of readings(m[0]))
        for (const r of reading) {
          values.add(Math.abs(r.value));
          if (scale !== 1) values.add(Math.abs(r.value) * scale);
        }
    }
  }
  return { values: [...values], names };
}

/** True when some source value, rounded to the digits the number was written with, is that number. */
function supported(r: Reading, known: number[]): boolean {
  const unit = 10 ** r.decimals;
  const written = r.value * unit;
  const slack = 0.5 + 1e-9 * Math.max(1, written);
  if (known.some((x) => Math.abs((x / r.scale) * unit - written) <= slack)) return true;
  // A whole number ending in zeros, with two digits or more before them: rounded to those digits.
  if (r.decimals === 0 && r.scale === 1 && r.value >= 100) {
    const digits = String(r.value);
    const zeros = digits.length - digits.replace(/0+$/, '').length;
    if (zeros >= 1 && digits.length - zeros >= 2) {
      const step = 10 ** zeros;
      return known.some((x) => Math.abs(x - r.value) <= step / 2 + 1e-9 * r.value);
    }
  }
  return false;
}

/** The answer without what is not a number of its own: citation marks and the numbering of lists. */
function strip(answer: string): string {
  return answer.replace(/\[S\d+(?:\s*[,;]\s*S\d+)*\]/g, ' ').replace(/^([ \t]*)\d{1,2}[.)](?=\s)/gm, '$1');
}

/**
 * The numbers of `answer` that are in none of `sources`, as written, in order of first use.
 * `sources` are the texts the model was given: function results, field context, passages, question.
 */
export function unsupportedNumbers(answer: string, sources: string[]): string[] {
  const known = sourceValues(sources);
  const text = strip(answer);
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const token = m[0];
    if (inName(text, m.index, token) || known.names.has(token)) continue;
    const scale = scaleAfter(text, m.index + token.length);
    const ok = readings(token).some((reading) => reading.every((r) => supported({ ...r, scale }, known.values) || (scale !== 1 && supported({ ...r, scale: 1 }, known.values))));
    if (!ok && !out.includes(token)) out.push(token);
  }
  return out;
}
