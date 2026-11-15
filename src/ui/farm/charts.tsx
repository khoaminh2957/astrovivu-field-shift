/**
 * Small drawings shared by the characters' detail sheets and the dossier: the year in twelve
 * months, a reading against its usual range, a row of factor scores. Each is given its numbers;
 * none reads the store. A missing number leaves its mark out instead of drawing a zero.
 */
import type { ReactNode } from 'react';
import type { Lang } from '@/contracts';
import { cn } from '@/ui/design';
import { monthShort } from '@/ui/advisory/format';

export interface MonthDatum {
  id: string;
  month: number;
  rainMm: number | null;
  tMaxC: number | null;
  tMinC: number | null;
  score: number | null;
}

/** Rain as bars, the daily highs and lows as two lines, one column per month. The month shown is marked. */
export function YearClimate({ months, activeId, lang, label, height = 132 }: { months: MonthDatum[]; activeId?: string | null; lang: Lang; label: string; height?: number }) {
  const W = 480;
  const H = height;
  const top = 10;
  const base = H - 20;
  const col = W / Math.max(1, months.length);
  const rainMax = Math.max(50, ...months.map((m) => m.rainMm ?? 0));
  const temps = months.flatMap((m) => [m.tMaxC, m.tMinC]).filter((v): v is number => v != null);
  const tLo = temps.length ? Math.min(...temps) - 2 : 0;
  const tHi = temps.length ? Math.max(...temps) + 2 : 1;
  const ty = (v: number) => top + (1 - (v - tLo) / Math.max(1, tHi - tLo)) * (base - top);
  const line = (key: 'tMaxC' | 'tMinC') => {
    let d = '';
    let pen = false;
    months.forEach((m, i) => {
      const v = m[key];
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'} ${(col * (i + 0.5)).toFixed(1)} ${ty(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label}>
      {months.map((m, i) => {
        const h = m.rainMm == null ? 0 : (m.rainMm / rainMax) * (base - top);
        const on = m.id === activeId;
        return (
          <g key={m.id}>
            {on && <rect x={col * i + 1} y={0} width={col - 2} height={H} rx={4} fill="var(--color-signal)" opacity={0.1} />}
            {m.rainMm != null && <rect x={col * i + col * 0.22} y={base - h} width={col * 0.56} height={Math.max(1, h)} rx={2} fill="var(--color-branch-rainfall)" opacity={on ? 0.95 : 0.55} />}
            <text x={col * (i + 0.5)} y={H - 5} textAnchor="middle" fontSize={11} fill={on ? 'var(--color-ink-1)' : 'var(--color-ink-3)'} fontWeight={on ? 600 : 400}>
              {monthShort(m.month, lang)}
            </text>
          </g>
        );
      })}
      <line x1={0} y1={base} x2={W} y2={base} stroke="var(--color-line-2)" />
      <path d={line('tMaxC')} fill="none" stroke="var(--color-alert)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <path d={line('tMinC')} fill="none" stroke="var(--color-ink-3)" strokeWidth={1.4} strokeDasharray="3 3" strokeLinejoin="round" />
    </svg>
  );
}

/** The score of each month as a column, 0..100. */
export function YearScore({ months, activeId, lang, label }: { months: MonthDatum[]; activeId?: string | null; lang: Lang; label: string }) {
  const W = 480;
  const H = 96;
  const base = H - 20;
  const col = W / Math.max(1, months.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label}>
      <line x1={0} y1={base - (base - 6) * 0.5} x2={W} y2={base - (base - 6) * 0.5} stroke="var(--color-line-1)" strokeDasharray="3 4" />
      {months.map((m, i) => {
        const on = m.id === activeId;
        const h = m.score == null ? 0 : (m.score / 100) * (base - 6);
        return (
          <g key={m.id}>
            {m.score != null && <rect x={col * i + col * 0.2} y={base - h} width={col * 0.6} height={Math.max(1, h)} rx={2} fill={m.score >= 70 ? 'var(--color-signal)' : m.score >= 45 ? 'var(--color-crop-cereal)' : 'var(--color-alert)'} opacity={on ? 1 : 0.6} />}
            {m.score != null && on && (
              <text x={col * (i + 0.5)} y={base - h - 3} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-ink-1)">
                {m.score}
              </text>
            )}
            <text x={col * (i + 0.5)} y={H - 5} textAnchor="middle" fontSize={11} fill={on ? 'var(--color-ink-1)' : 'var(--color-ink-3)'} fontWeight={on ? 600 : 400}>
              {monthShort(m.month, lang)}
            </text>
          </g>
        );
      })}
      <line x1={0} y1={base} x2={W} y2={base} stroke="var(--color-line-2)" />
    </svg>
  );
}

/**
 * A reading on a scale, with the band it should sit in. Used for soil moisture against its usual
 * range and for pH against what the crop takes.
 */
export function RangeBar({ min, max, band, value, bandLabel, valueLabel, tone = 'ok' }: { min: number; max: number; band: [number, number] | null; value: number | null; bandLabel?: string; valueLabel?: string; tone?: 'ok' | 'warn' }) {
  const pct = (v: number) => `${(Math.max(0, Math.min(1, (v - min) / (max - min))) * 100).toFixed(1)}%`;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3 rounded-full bg-surface-3">
        {band && <div className="absolute inset-y-0 rounded-full bg-signal/35" style={{ left: pct(band[0]), right: `calc(100% - ${pct(band[1])})` }} />}
        {value != null && <div className={cn('absolute top-1/2 size-4 -translate-1/2 rounded-full border-2 border-surface-0 shadow-sm', tone === 'warn' ? 'bg-watch' : 'bg-signal-strong')} style={{ left: pct(value) }} />}
      </div>
      <div className="flex justify-between gap-3 text-xs text-ink-3">
        <span>{bandLabel}</span>
        <span className={cn('t-value', tone === 'warn' ? 'text-watch' : 'text-ink-1')}>{valueLabel}</span>
      </div>
    </div>
  );
}

/** One bar per factor of the score, 0..1; a factor without a reading has no bar. */
export function FactorBars({ rows }: { rows: { key: string; label: string; score: number | null; note?: string; limiting?: boolean }[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2.5rem] items-center gap-2 text-sm">
          <span className={cn('truncate', r.limiting ? 'font-medium text-ink-1' : 'text-ink-2')} title={r.note}>
            {r.label}
          </span>
          <span className="relative h-2 rounded-full bg-surface-3">
            {r.score != null && <span className={cn('absolute inset-y-0 left-0 rounded-full', r.limiting ? 'bg-watch' : r.score >= 0.7 ? 'bg-signal' : 'bg-crop-cereal')} style={{ width: `${Math.round(r.score * 100)}%` }} />}
          </span>
          <span className="t-value text-right text-xs text-ink-2">{r.score == null ? '--' : Math.round(r.score * 100)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A figure with its label: the tiles at the head of a sheet. */
export function Tile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'warn' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-line-1 bg-surface-0 px-3 py-2.5">
      <span className="truncate text-xs text-ink-3">{label}</span>
      <span className={cn('t-value truncate text-lg leading-6', tone === 'warn' ? 'text-watch' : 'text-ink-1')}>{value}</span>
      {note && <span className="t-caption line-clamp-2">{note}</span>}
    </div>
  );
}
