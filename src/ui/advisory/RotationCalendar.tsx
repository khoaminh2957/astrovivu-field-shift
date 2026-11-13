/**
 * Calendar of one rotation: every year of the rotation side by side, one column per month, crops
 * as blocks in lanes. Perennials (12-month seasons) run as a standing lane across all years.
 */
import type { Lang, RotationSeason } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { cn } from '@/ui/design';
import { monthShort } from './format';

interface Block {
  /** Absolute month index from the start of the rotation (0 = January of year 1). */
  from: number;
  /** Exclusive. */
  to: number;
  season: RotationSeason;
}

const duration = (s: RotationSeason) => ((s.endMonth - s.startMonth + 12) % 12) + 1;
const isStanding = (s: RotationSeason) => duration(s) === 12 && s.year == null;

/**
 * Places seasons on the absolute month axis. With `year` the placement is exact; without it the
 * seasons follow one another in order and the sequence repeats until the rotation is filled.
 */
export function layoutSeasons(seasons: RotationSeason[], years: number): Block[] {
  const span = Math.max(1, years) * 12;
  const blocks: Block[] = [];
  const sequential: RotationSeason[] = [];
  for (const s of seasons) {
    if (isStanding(s)) blocks.push({ from: 0, to: span, season: s });
    else if (s.year != null) {
      const from = s.year * 12 + s.startMonth - 1;
      blocks.push({ from, to: Math.min(span, from + duration(s)), season: s });
    } else sequential.push(s);
  }
  if (sequential.length) {
    let cursor = 0;
    let guard = 0;
    while (cursor < span && guard++ < 48) {
      for (const s of sequential) {
        const start0 = s.startMonth - 1;
        let from = Math.floor(cursor / 12) * 12 + start0;
        if (from < cursor) from += 12;
        if (from >= span) {
          cursor = span;
          break;
        }
        blocks.push({ from, to: Math.min(span, from + duration(s)), season: s });
        cursor = from + duration(s);
      }
    }
  }
  return blocks;
}

/** Greedy lane assignment so concurrent crops (an intercrop, a cover under a perennial) stack. */
function lanes(blocks: Block[]): Block[][] {
  const sorted = [...blocks].sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
  const out: Block[][] = [];
  for (const b of sorted) {
    const lane = out.find((l) => l.every((x) => b.from >= x.to || b.to <= x.from));
    if (lane) lane.push(b);
    else out.push([b]);
  }
  return out;
}

const LANE_H = 20;

export function RotationCalendar({ seasons, years, compactLabels }: { seasons: RotationSeason[]; years: number; compactLabels?: boolean }) {
  const lang = useLang();
  const t = useT();
  const y = Math.max(1, years);
  const span = y * 12;
  const rows = lanes(layoutSeasons(seasons, y));
  const pct = (m: number) => `${(m / span) * 100}%`;
  const summary = seasons.map((s) => `${pick(s.label, lang)} ${monthShort(s.startMonth, lang)}-${monthShort(s.endMonth, lang)}`).join('; ');

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-1" aria-label={`${t('advisory.calendar')}: ${summary}`}>
      <div className="relative" style={{ height: Math.max(1, rows.length) * (LANE_H + 2) }}>
        {/* Year separators and the month grid sit behind the blocks. */}
        {Array.from({ length: span + 1 }, (_, m) => (
          <span key={m} aria-hidden className={cn('absolute inset-y-0 w-px', m % 12 === 0 ? 'bg-line-2' : 'bg-line-1/60')} style={{ left: pct(m) }} />
        ))}
        {rows.map((lane, li) =>
          lane.map((b, bi) => <SeasonBlock key={`${li}-${bi}`} block={b} top={li * (LANE_H + 2)} pct={pct} lang={lang} compact={compactLabels} />),
        )}
      </div>
      <div aria-hidden className="relative h-3.5">
        {Array.from({ length: y }, (_, yi) => (
          <span key={yi} className="t-meta absolute top-0 pl-1" style={{ left: pct(yi * 12) }}>
            {t('advisory.yearN', { n: yi + 1 })}
          </span>
        ))}
        {y === 1 &&
          [1, 4, 7, 10].map((m) => (
            <span key={m} className="t-meta absolute top-0" style={{ left: pct(m - 1) }}>
              {monthShort(m, lang)}
            </span>
          ))}
      </div>
    </figure>
  );
}

function SeasonBlock({ block, top, pct, lang, compact }: { block: Block; top: number; pct: (m: number) => string; lang: Lang; compact?: boolean }) {
  const fallow = block.season.cropId === 'fallow';
  const label = pick(block.season.label, lang);
  const range = `${monthShort(block.season.startMonth, lang)}-${monthShort(block.season.endMonth, lang)}`;
  return (
    <span
      title={`${label} · ${range}`}
      className={cn(
        'absolute flex items-center overflow-hidden rounded-xs border px-1 text-2xs whitespace-nowrap',
        fallow ? 'border-line-2 bg-inset text-ink-3' : 'border-line-3 bg-surface-3 text-ink-1',
      )}
      style={{ left: `calc(${pct(block.from)} + 1px)`, width: `calc(${pct(block.to - block.from)} - 2px)`, top, height: LANE_H }}
    >
      <span className="truncate">{compact && block.to - block.from < 4 ? label.split(/\s+/)[0] : label}</span>
    </span>
  );
}
