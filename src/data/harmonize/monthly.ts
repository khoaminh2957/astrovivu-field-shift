/** Daily → monthly aggregation for `climateHistory`. Pure. */
import type { ISODate, YearClimate } from '@/contracts';

export interface DailyClimate {
  t: ISODate;
  rain: number | null;
  tMean: number | null;
  tMin: number | null;
  tMax: number | null;
  et0?: number | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Monthly totals (rain, ET0) and means (temperatures) per calendar year. A month with more than
 * 3 missing days gets null for that variable rather than a biased total. Only years in
 * [fromYear, toYear] are returned.
 */
export function monthlyClimate(days: DailyClimate[], fromYear: number, toYear: number): YearClimate[] {
  type Acc = { n: number; rain: number; rainN: number; tm: number; tmN: number; tn: number; tnN: number; tx: number; txN: number; et: number; etN: number };
  const acc = new Map<string, Acc>();
  for (const d of days) {
    const y = Number(d.t.slice(0, 4));
    if (y < fromYear || y > toYear) continue;
    const k = d.t.slice(0, 7);
    const a = acc.get(k) ?? { n: 0, rain: 0, rainN: 0, tm: 0, tmN: 0, tn: 0, tnN: 0, tx: 0, txN: 0, et: 0, etN: 0 };
    a.n++;
    if (d.rain != null) (a.rain += d.rain), a.rainN++;
    if (d.tMean != null) (a.tm += d.tMean), a.tmN++;
    if (d.tMin != null) (a.tn += d.tMin), a.tnN++;
    if (d.tMax != null) (a.tx += d.tMax), a.txN++;
    if (d.et0 != null) (a.et += d.et0), a.etN++;
    acc.set(k, a);
  }
  const out: YearClimate[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const a = acc.get(`${y}-${String(m).padStart(2, '0')}`);
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const ok = (count: number) => !!a && count >= dim - 3;
      months.push({
        month: m,
        rainMm: a && ok(a.rainN) ? r1((a.rain * dim) / a.rainN) : null,
        tMean: a && ok(a.tmN) ? r1(a.tm / a.tmN) : null,
        tMin: a && ok(a.tnN) ? r1(a.tn / a.tnN) : null,
        tMax: a && ok(a.txN) ? r1(a.tx / a.txN) : null,
        et0Mm: a && ok(a.etN) ? r1((a.et * dim) / a.etN) : null,
      });
    }
    if (months.some((m) => m.tMean != null || m.rainMm != null)) out.push({ year: y, months });
  }
  return out;
}
