import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from './cn';
import { type Status, STATUS_VAR } from './tokens';

export interface StatProps {
  label: ReactNode;
  /** Formatted by the caller. Null shows `--`: missing is never zero. */
  value: ReactNode;
  unit?: ReactNode;
  /** Change against a reference, e.g. `+12 %` with `deltaLabel="vs last season"`. */
  delta?: ReactNode;
  deltaLabel?: ReactNode;
  /** Draws an arrow. It states direction only; good or bad is `tone`. */
  trend?: 'up' | 'down';
  /** Colours the delta. Leave unset when the change is neither good nor bad. */
  tone?: Extract<Status, 'nominal' | 'watch' | 'alert'>;
  /** Line under the value: the basis of the number or its range. */
  hint?: ReactNode;
  /** Slot at the right of the label: a `ProvenanceTag compact` or a `StatusTag`. */
  aside?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  align?: 'start' | 'end';
  className?: string;
}

const valueSize = { sm: 'text-base leading-5', md: 'text-xl leading-7', lg: 'text-3xl leading-10' } as const;

/**
 * A labelled number. Stats sit in rows separated by hairlines or in a `Panel`; they are not cards
 * and never get their own border.
 */
export function Stat({ label, value, unit, delta, deltaLabel, trend, tone, hint, aside, size = 'md', align = 'start', className }: StatProps) {
  const Arrow = trend === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', align === 'end' && 'items-end text-right', className)}>
      <div className="flex max-w-full min-w-0 items-center gap-2">
        <span className="t-label truncate">{label}</span>
        {aside}
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn('t-value text-ink-1', valueSize[size], value == null && 'text-ink-4')}>{value ?? '--'}</span>
        {unit != null && <span className="t-unit">{unit}</span>}
      </div>
      {(delta != null || hint != null) && (
        <div className="t-caption flex min-w-0 items-center gap-1">
          {delta != null && (
            <span className="t-value inline-flex shrink-0 items-center gap-0.5 text-xs text-ink-2" style={tone ? { color: STATUS_VAR[tone] } : undefined}>
              {trend && <Arrow size={12} strokeWidth={2} aria-hidden />}
              {delta}
            </span>
          )}
          {deltaLabel != null && <span className="truncate">{deltaLabel}</span>}
          {hint != null && delta == null && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  );
}

export interface MeterProps {
  /** Current value on the `min..max` scale. Null draws an empty track. */
  value: number | null;
  min?: number;
  max?: number;
  /** A reference to compare against (the current rotation, the crop optimum), drawn as a tick. */
  reference?: number | null;
  /** Shaded target window on the track, e.g. the ideal pH range. */
  target?: [from: number, to: number];
  label?: ReactNode;
  /** Formatted value shown at the right of the label row. */
  valueLabel?: ReactNode;
  /** Bar colour: quiet ink by default; a state only when the bar itself is the warning. */
  tone?: 'ink' | 'signal' | Extract<Status, 'nominal' | 'watch' | 'alert'>;
  /** Accessible name when there is no visible `label`. */
  ariaLabel?: string;
  className?: string;
}

/** A value on a scale, for comparing options side by side (rotation strategies, factor scores). */
export function Meter({ value, min = 0, max = 100, reference, target, label, valueLabel, tone = 'ink', ariaLabel, className }: MeterProps) {
  const pct = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min || 1)) * 100;
  const fill = tone === 'ink' ? 'var(--color-ink-2)' : tone === 'signal' ? 'var(--color-signal)' : STATUS_VAR[tone];
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {(label != null || valueLabel != null) && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="t-label truncate">{label}</span>
          {valueLabel != null && <span className="t-value shrink-0 text-xs text-ink-1">{valueLabel}</span>}
        </div>
      )}
      <div
        role="meter"
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value ?? undefined}
        aria-valuetext={typeof valueLabel === 'string' ? valueLabel : undefined}
        className="relative h-1.5 w-full bg-line-1"
      >
        {target && <span aria-hidden className="absolute inset-y-0 bg-ink-4/45" style={{ left: `${pct(target[0])}%`, width: `${pct(target[1]) - pct(target[0])}%` }} />}
        {value != null && <span aria-hidden className="absolute inset-y-0 left-0" style={{ width: `${pct(value)}%`, background: fill }} />}
        {reference != null && <span aria-hidden className="absolute -inset-y-1 w-px bg-ink-1" style={{ left: `${pct(reference)}%` }} />}
      </div>
    </div>
  );
}

export interface KeyValueProps {
  label: ReactNode;
  children: ReactNode;
  /** Set the value in the measurement face (numbers, dates, coordinates). */
  numeric?: boolean;
  className?: string;
}

/** One row of a definition list: label left, value right, hairline under. Wrap rows in a `<dl>`. */
export function KeyValue({ label, children, numeric, className }: KeyValueProps) {
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-4 border-b border-line-1 py-1.5 last:border-b-0', className)}>
      <dt className="t-label shrink-0">{label}</dt>
      <dd className={cn('m-0 min-w-0 text-right text-sm text-ink-1', numeric && 't-value')}>{children}</dd>
    </div>
  );
}
