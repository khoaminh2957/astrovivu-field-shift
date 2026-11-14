/** Small instruments shared by the plant card and the plant detail: score, difficulty, sowing months. */
import type { ReactNode } from 'react';
import { Sprout } from 'lucide-react';
import type { Lang, UrbanRecommendation } from '@/contracts';
import { nextSow, sowLevels, type SowLevel } from '@/core/urban';
import { useLang, useT } from '@/i18n';
import { Tag, cn } from '@/ui/design';
import { fmtNum, monthLong, monthShort } from '@/ui/advisory/format';
import './strings';

/** One character per month so twelve fit in a card: initials in English, numbers in Vietnamese. */
export const monthTick = (m: number, lang: Lang): string => (lang === 'vi' ? String(m) : 'JFMAMJJASOND'[m - 1]);

/** The recommender returns 0-100; a 0-1 score from older data is scaled up, not shown as 1/100. */
export const score100 = (score: number): number => Math.round(score <= 1 ? score * 100 : score);

export function ScoreRing({ score, size = 40 }: { score: number; size?: number }) {
  const t = useT();
  const lang = useLang();
  const v = Math.max(0, Math.min(100, score100(score)));
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <span role="img" aria-label={t('urban.scoreLabel', { score: fmtNum(v, lang) })} className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden className="-rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-surface-3" />
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} className="stroke-signal" />
      </svg>
      <span aria-hidden className={cn('t-value absolute text-ink-1', size >= 48 ? 'text-base' : 'text-xs')}>
        {fmtNum(v, lang)}
      </span>
    </span>
  );
}

/** One to three filled marks and the word: the marks never stand alone. */
export function Difficulty({ level, className }: { level: 1 | 2 | 3; className?: string }) {
  const t = useT();
  const word = t(`urban.diff.${level}`);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-ink-2', className)}>
      <span aria-hidden className="inline-flex items-end gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('w-1 rounded-xs border', i === 1 ? 'h-1.5' : i === 2 ? 'h-2.5' : 'h-3.5', i <= level ? 'border-ink-2 bg-ink-2' : 'border-line-3 bg-surface-0')} />
        ))}
      </span>
      <span className="sr-only">{t('urban.diffLabel', { word })}</span>
      <span aria-hidden>{word}</span>
    </span>
  );
}

/** "Sow now", or the next sowing month and how far away it is. */
export function SowStatus({ rec, month }: { rec: UrbanRecommendation; month: number }) {
  const t = useT();
  const lang = useLang();
  const next = nextSow(rec.care.sowMonths, month);
  if (!next) return null;
  if (next.wait === 0)
    return (
      <Tag tone="nominal" variant="soft" icon={<Sprout size={12} strokeWidth={1.75} aria-hidden />}>
        {t('urban.sowNow')}
      </Tag>
    );
  return (
    <span className="text-xs text-ink-2">
      {t('urban.sowFrom', { month: monthShort(next.month, lang) })} <span className="t-unit">· {t('urban.sowIn', { n: next.wait })}</span>
    </span>
  );
}

const MARK: Record<SowLevel, string> = {
  good: 'size-2.5 rounded-full bg-signal-strong',
  marginal: 'size-1.5 rounded-full border border-ink-3 bg-surface-0',
  no: 'h-px w-1.5 bg-line-3',
};

export function SowMark({ level }: { level: SowLevel }) {
  return <span aria-hidden className={cn('block shrink-0', MARK[level])} />;
}

/**
 * Twelve months, January first: a full dot is a sowing month, a small ring a marginal one, a dash
 * a month to avoid; this month sits in a frame. Size and shape carry the meaning, not colour.
 */
export function MonthDots({ rec, month, className }: { rec: UrbanRecommendation; month: number; className?: string }) {
  const t = useT();
  const lang = useLang();
  const levels = sowLevels(rec.care.sowMonths, rec.care.sowFit);
  const names = (lv: SowLevel) => levels.flatMap((l, i) => (l === lv ? [monthLong(i + 1, lang)] : []));
  const marginal = names('marginal');
  const label = t('urban.dots.label', {
    good: names('good').join(', ') || t('urban.dots.none'),
    marginal: marginal.length ? t('urban.dots.marginal', { months: marginal.join(', ') }) : '',
    now: monthLong(month, lang),
  });
  return (
    <span role="img" aria-label={label} className={cn('grid grid-cols-12 gap-px', className)}>
      {levels.map((lv, i) => (
        <span key={i} className={cn('flex flex-col items-center gap-0.5 rounded-xs border py-0.5', i + 1 === month ? 'border-ink-1' : 'border-transparent')}>
          <span className="flex h-3 items-center justify-center">
            <SowMark level={lv} />
          </span>
          <span className={cn('text-2xs leading-none tabular-nums', i + 1 === month ? 'font-medium text-ink-1' : 'text-ink-3')}>{monthTick(i + 1, lang)}</span>
        </span>
      ))}
    </span>
  );
}

/** What the marks of `MonthDots` mean. Shown once, in the detail. */
export function MonthKey({ showMarginal }: { showMarginal: boolean }) {
  const t = useT();
  const item = (mark: ReactNode, text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex size-3 items-center justify-center">{mark}</span>
      {text}
    </span>
  );
  return (
    <p className="t-caption flex flex-wrap gap-x-4 gap-y-1">
      {item(<SowMark level="good" />, t('urban.key.good'))}
      {showMarginal && item(<SowMark level="marginal" />, t('urban.key.marginal'))}
      {item(<SowMark level="no" />, t('urban.key.no'))}
      {item(<span aria-hidden className="block size-3 rounded-xs border border-ink-1" />, t('urban.key.now'))}
    </p>
  );
}

/** An icon, a short label for screen readers, and one line of care text. */
export function IconLine({ icon, label, children, clamp }: { icon: ReactNode; label: string; children: ReactNode; clamp?: boolean }) {
  return (
    <span className="flex min-w-0 items-start gap-2 text-sm text-ink-2">
      <span aria-hidden className="mt-0.5 shrink-0 text-ink-3 [&_svg]:size-4">
        {icon}
      </span>
      <span className={cn('min-w-0', clamp && 'line-clamp-2')}>
        <span className="sr-only">{label}: </span>
        {children}
      </span>
    </span>
  );
}
