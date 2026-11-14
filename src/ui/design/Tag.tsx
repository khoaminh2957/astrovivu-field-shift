import type { HTMLAttributes, ReactNode } from 'react';
import type { Provenance } from '@/contracts';
import { useT } from '@/i18n';
import { cn } from './cn';
import './strings';
import { type Status, STATUS_VAR } from './tokens';

// ---------------------------------------------------------------------------------------------
// Status glyphs: each state has its own shape, so colour is never the only signal.
// ---------------------------------------------------------------------------------------------

export interface StatusGlyphProps {
  status: Status | 'info';
  /** Pixel size of the square glyph. */
  size?: number;
  /** Overrides the state colour, e.g. `currentColor` inside a tag that already carries it. */
  color?: string;
  className?: string;
}

/** 12 x 12 shape for a state: dot, triangle, diamond, broken ring, hatched square, solid square. */
export function StatusGlyph({ status, size = 10, color: override, className }: StatusGlyphProps) {
  const color = override ?? (status === 'info' ? 'var(--color-ink-3)' : STATUS_VAR[status]);
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className={cn('shrink-0', className)} style={{ color }}>
      {status === 'nominal' && <circle cx="6" cy="6" r="3.5" fill="currentColor" />}
      {status === 'info' && <circle cx="6" cy="6" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {status === 'watch' && <path d="M6 1.2 11.2 10.4H0.8Z" fill="currentColor" />}
      {status === 'alert' && <path d="M6 0.6 11.4 6 6 11.4 0.6 6Z" fill="currentColor" />}
      {status === 'stale' && <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2.4" />}
      {status === 'simulated' && (
        <>
          <rect x="1.25" y="1.25" width="9.5" height="9.5" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M1.5 6.5 6.5 1.5M4 10.5 10.5 4M1.5 10.5 10.5 1.5" stroke="currentColor" strokeWidth="1" />
        </>
      )}
      {status === 'ground-truth' && <rect x="1.5" y="1.5" width="9" height="9" fill="currentColor" />}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------------------------

export type TagTone = 'neutral' | Status;

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
  /** `outline` is the default; `solid` is reserved for ground truth and the selected state. */
  variant?: 'outline' | 'soft' | 'solid';
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

const toneOutline: Record<TagTone, string> = {
  neutral: 'border-line-2 text-ink-2',
  nominal: 'border-nominal/45 text-nominal',
  watch: 'border-watch/55 text-watch',
  alert: 'border-alert/60 text-alert',
  stale: 'border-stale/45 text-stale border-dashed',
  simulated: 'border-simulated/50 text-simulated hatch-simulated',
  // Outline only: the solid signal fill is kept for the measured value itself.
  'ground-truth': 'border-signal text-signal-strong',
};

const toneSoft: Record<TagTone, string> = {
  neutral: 'border-transparent bg-surface-3 text-ink-2',
  nominal: 'border-transparent bg-nominal/12 text-nominal',
  watch: 'border-transparent bg-watch/14 text-watch',
  alert: 'border-transparent bg-alert/14 text-alert',
  stale: 'border-transparent bg-stale/12 text-stale',
  simulated: 'border-transparent bg-simulated/10 text-simulated hatch-simulated',
  'ground-truth': 'border-transparent bg-signal/12 text-signal-strong',
};

const toneSolid: Record<TagTone, string> = {
  neutral: 'border-ink-2 bg-ink-2 text-on-signal',
  nominal: 'border-nominal bg-nominal text-on-signal',
  watch: 'border-watch bg-watch text-on-signal',
  alert: 'border-alert bg-alert text-on-signal',
  stale: 'border-stale bg-stale text-on-signal',
  simulated: 'border-simulated bg-simulated text-on-signal',
  'ground-truth': 'border-signal bg-signal text-on-signal',
};

/** A short, non-interactive label. For a state of the data use `StatusTag`; for a source `ProvenanceTag`. */
export function Tag({ tone = 'neutral', variant = 'outline', size = 'sm', icon, className, children, ...rest }: TagProps) {
  const palette = variant === 'solid' ? toneSolid : variant === 'soft' ? toneSoft : toneOutline;
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-xs border align-middle whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-2xs' : 'h-6 px-2 text-xs',
        'font-medium [font-stretch:var(--stretch-semi)]',
        palette[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export interface StatusTagProps extends Omit<TagProps, 'tone' | 'icon' | 'children'> {
  status: Status;
  /** Replaces the built-in word (still upper-cased). */
  label?: ReactNode;
  /** Glyph only, with the word as accessible name: for tight rows. */
  compact?: boolean;
}

/** Shape + word for a state. The word is translated; pass `label` only for a more specific term. */
export function StatusTag({ status, label, compact, className, ...rest }: StatusTagProps) {
  const t = useT();
  const word = label ?? t(`design.status.${status}`);
  if (compact) {
    return (
      <span role="img" aria-label={typeof word === 'string' ? word : undefined} className={cn('inline-flex', className)}>
        <StatusGlyph status={status} />
      </span>
    );
  }
  return (
    <Tag tone={status} icon={<StatusGlyph status={status} size={9} color="currentColor" />} className={cn('t-status', className)} {...rest}>
      {word}
    </Tag>
  );
}

// ---------------------------------------------------------------------------------------------
// Provenance: how a number was produced. The swatch repeats the line style the sparkline uses.
// ---------------------------------------------------------------------------------------------

function ProvenanceSwatch({ provenance }: { provenance: Provenance }) {
  return (
    <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden className="shrink-0">
      {provenance === 'observed' && (
        <>
          <path d="M1 5H11" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="13" cy="5" r="2" fill="currentColor" />
        </>
      )}
      {provenance === 'modelled' && <path d="M1 6.5C3.5 6.5 3.5 2.5 6 2.5S8.5 7.5 11 7.5 13 4 15 4" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {provenance === 'derived' && <path d="M1 2H5L8 5H15M1 8H5L8 5" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {provenance === 'forecast' && <path d="M1 5H15" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.5" />}
      {provenance === 'simulated' && <path d="M1 5H15" stroke="currentColor" strokeWidth="1.5" strokeDasharray="0.1 3" strokeLinecap="round" />}
      {provenance === 'ground-truth' && <rect x="4" y="1" width="8" height="8" fill="currentColor" />}
    </svg>
  );
}

export interface ProvenanceTagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  provenance: Provenance;
  /** Dataset short name, e.g. `SMAP L4`. */
  source?: ReactNode;
  /** Resolution, age or cadence, e.g. `9 km · 2 d`. Set in the measurement face. */
  detail?: ReactNode;
  /** Hide the provenance word and keep swatch + source (when the row is narrow). */
  compact?: boolean;
}

/** "How was this number produced, by what, how coarse, how old." Lives under every reading. */
export function ProvenanceTag({ provenance, source, detail, compact, className, ...rest }: ProvenanceTagProps) {
  const t = useT();
  const word = t(`design.prov.${provenance}`);
  const tone =
    provenance === 'ground-truth'
      ? 'text-signal-strong'
      : provenance === 'simulated'
        ? 'text-simulated hatch-simulated px-1'
        : provenance === 'forecast'
          ? 'text-ink-2'
          : 'text-ink-3';
  return (
    <span className={cn('inline-flex h-5 w-fit max-w-full min-w-0 items-center gap-1.5 rounded-xs align-middle whitespace-nowrap', tone, className)} title={compact ? word : undefined} {...rest}>
      <ProvenanceSwatch provenance={provenance} />
      {!compact && <span className="t-status shrink-0">{word}</span>}
      {source != null && <span className={cn('truncate text-xs font-medium [font-stretch:var(--stretch-semi)]', provenance === 'ground-truth' ? 'text-ink-1' : 'text-ink-2')}>{source}</span>}
      {detail != null && <span className="t-meta shrink-0">{detail}</span>}
    </span>
  );
}
