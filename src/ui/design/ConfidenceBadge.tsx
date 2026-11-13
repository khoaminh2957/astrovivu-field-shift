import type { ReactNode } from 'react';
import type { ConfidenceBadge as ConfidenceData, I18nText } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { cn } from './cn';
import './strings';
import { Popover } from './Tooltip';

export type ConfidenceLevel = ConfidenceData['level'];

const FILLED: Record<ConfidenceLevel, number> = { low: 1, medium: 2, high: 3 };

/** Thresholds from ARCHITECTURE.md §4.3, for callers that degrade the score with observation age. */
export function confidenceLevel(score: number): ConfidenceLevel {
  return score >= 0.7 ? 'high' : score >= 0.45 ? 'medium' : 'low';
}

/** Three signal bars: how much of the reading survives at field scale. */
export function ConfidenceBars({ level, size = 12, className }: { level: ConfidenceLevel; size?: number; className?: string }) {
  const n = FILLED[level];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className={cn('shrink-0', className)}>
      {[0, 1, 2].map((i) => {
        const h = 4 + i * 3.5;
        return <rect key={i} x={0.5 + i * 4} y={11.5 - h} width={3} height={h} fill={i < n ? 'currentColor' : 'var(--color-line-3)'} />;
      })}
    </svg>
  );
}

export interface ConfidenceBadgeProps {
  /** The contract object as delivered by a branch. `level` and `score` below override it. */
  badge?: ConfidenceData;
  level?: ConfidenceLevel;
  /** 0..1. Shown with two decimals in the detail. */
  score?: number;
  /** Why the reading can or cannot be trusted at this parcel. Plain strings or I18nText. */
  reasons?: (I18nText | string)[];
  /**
   * `glyph`: bars only (HUD callouts). `compact`: bars + level word (default).
   * `full`: bars, word, score and the reasons inline, no popover (detail panels, advisory evidence).
   */
  variant?: 'glyph' | 'compact' | 'full';
  /** Extra line in the detail, e.g. the freshness the UI multiplied in. */
  footnote?: ReactNode;
  className?: string;
}

/**
 * Confidence Badge. Neutral ink on purpose: low confidence is a property of the measurement, not
 * a hazard on the field, so it never borrows the watch or alert colours.
 */
export function ConfidenceBadge({ badge, level, score, reasons, variant = 'compact', footnote, className }: ConfidenceBadgeProps) {
  const t = useT();
  const lang = useLang();
  const lv = level ?? badge?.level ?? 'low';
  const sc = score ?? badge?.score;
  const why = (reasons ?? badge?.reasons ?? []).map((r) => pick(r, lang));
  const word = t(`design.conf.${lv}`);
  const name = `${t('design.conf.label')}: ${word}`;
  const tone = lv === 'high' ? 'text-ink-1' : lv === 'medium' ? 'text-ink-2' : 'text-ink-3';

  const detail = (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-label">{t('design.conf.title')}</span>
        {sc != null && <span className="t-value text-xs text-ink-1">{sc.toFixed(2)}</span>}
      </div>
      {why.length > 0 ? (
        <ul className="flex list-none flex-col gap-1.5 p-0 text-sm text-ink-2">
          {why.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="mt-2 h-px w-2 shrink-0 bg-line-3" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-caption">{t('design.conf.noReasons')}</p>
      )}
      {footnote != null && <p className="t-caption border-t border-line-1 pt-2">{footnote}</p>}
    </div>
  );

  if (variant === 'full') {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <span className={cn('inline-flex items-center gap-1.5', tone)}>
          <ConfidenceBars level={lv} />
          <span className="t-status">{word}</span>
        </span>
        {detail}
      </div>
    );
  }

  const face = (
    <>
      <ConfidenceBars level={lv} />
      {variant === 'compact' && <span className="t-status">{word}</span>}
    </>
  );

  return (
    <Popover
      label={t('design.conf.title')}
      side="bottom"
      align="end"
      trigger={
        <button
          type="button"
          aria-label={name}
          className={cn(
            'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-xs px-1 transition-colors duration-(--dur-instant) hover:bg-surface-3 data-[state=open]:bg-surface-3',
            tone,
            className,
          )}
        >
          {face}
        </button>
      }
    >
      {detail}
    </Popover>
  );
}
