import type { CSSProperties, ReactNode } from 'react';
import * as RScroll from '@radix-ui/react-scroll-area';
import { useT } from '@/i18n';
import { cn } from './cn';
import type { RampMode } from './tokens';
import { type MapMetric, RAMPS } from './tokens';
import './strings';

export interface SkeletonProps {
  /** Size it with utilities: `h-4 w-24`. */
  className?: string;
  style?: CSSProperties;
}

/** Placeholder with the shape of what is loading. Never a spinner in the middle of content. */
export function Skeleton({ className, style }: SkeletonProps) {
  return <span aria-hidden className={cn('skeleton block', className)} style={style} />;
}

/** Lines of text loading. The last line is shorter, like a paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const t = useT();
  return (
    <span role="status" aria-label={t('design.common.loading')} className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: i === lines - 1 ? '62%' : '100%' }} />
      ))}
    </span>
  );
}

export interface EmptyStateProps {
  /** A lucide icon element, 20 px. */
  icon?: ReactNode;
  /** What is missing, in the user's words: "No field locked yet". */
  title: ReactNode;
  /** Why, and what to do about it. An empty state teaches the next step. */
  body?: ReactNode;
  /** The next step as a Button. */
  action?: ReactNode;
  /** `inline` for a row inside a panel; `block` for a whole empty panel. */
  layout?: 'inline' | 'block';
  className?: string;
}

export function EmptyState({ icon, title, body, action, layout = 'block', className }: EmptyStateProps) {
  if (layout === 'inline') {
    return (
      <div className={cn('flex min-w-0 items-start gap-2.5 py-2', className)}>
        {icon != null && <span className="mt-0.5 shrink-0 text-ink-3 [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-1">{title}</p>
          {body != null && <p className="t-caption mt-0.5">{body}</p>}
        </div>
        {action}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col items-start gap-3 rounded-sm border border-dashed border-line-2 p-5', className)}>
      {icon != null && <span className="text-ink-3 [&_svg]:size-5">{icon}</span>}
      <div className="max-w-[46ch]">
        <p className="t-heading">{title}</p>
        {body != null && <p className="mt-1 text-sm text-ink-2">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export interface RampLegendProps {
  metric: MapMetric;
  /** `sequential` for absolute values, `diverging` for departures from normal. */
  mode?: RampMode;
  /** Numeric ends of the scale. Omit to show the words low / high (or below / above normal). */
  min?: number;
  max?: number;
  unit?: ReactNode;
  /** What is painted: "NDVI", "Rain, last 30 days". */
  label?: ReactNode;
  /** Marks the parcel's own value on the scale. */
  value?: number | null;
  className?: string;
}

/** Legend for whatever colours the parcel or the overlay. The map never shows colour without it. */
export function RampLegend({ metric, mode = 'sequential', min, max, unit, label, value, className }: RampLegendProps) {
  const t = useT();
  const ramp = RAMPS[metric][mode];
  const lo = min != null ? String(min) : t(mode === 'diverging' ? 'design.ramp.below' : 'design.ramp.low');
  const hi = max != null ? String(max) : t(mode === 'diverging' ? 'design.ramp.above' : 'design.ramp.high');
  const at = value != null && min != null && max != null && max !== min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : null;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {label != null && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="t-label truncate">{label}</span>
          {unit != null && <span className="t-unit shrink-0">{unit}</span>}
        </div>
      )}
      <div className="relative h-2 w-full rounded-xs border border-line-2" style={{ background: ramp.cssVar }}>
        {at != null && <span aria-hidden className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-signal outline outline-1 outline-void" style={{ left: `${at * 100}%` }} />}
      </div>
      <div className="t-meta flex justify-between">
        <span>{lo}</span>
        {mode === 'diverging' && <span>0</span>}
        <span>{hi}</span>
      </div>
    </div>
  );
}

export interface ScrollAreaProps {
  children: ReactNode;
  /** Give it a height or let a flex parent bound it: `className="max-h-80"`. */
  className?: string;
  /** Classes for the scrolling viewport (padding). */
  viewportClassName?: string;
}

/** Scroll container with the system's thin scrollbar, for lists inside panels and sheets. */
export function ScrollArea({ children, className, viewportClassName }: ScrollAreaProps) {
  return (
    <RScroll.Root type="hover" className={cn('relative min-h-0 overflow-hidden', className)}>
      <RScroll.Viewport className={cn('size-full [&>div]:!block', viewportClassName)}>{children}</RScroll.Viewport>
      <RScroll.Scrollbar orientation="vertical" className="flex w-2 touch-none p-px select-none">
        <RScroll.Thumb className="relative flex-1 rounded-full bg-line-3 hover:bg-ink-4" />
      </RScroll.Scrollbar>
    </RScroll.Root>
  );
}

/** The team name, set in the wide cut. `hero` is for the first screen only. */
export function Wordmark({ size = 'sm', className }: { size?: 'sm' | 'md' | 'hero'; className?: string }) {
  const scale = size === 'hero' ? 'text-[clamp(2.25rem,7.2vw,6rem)]' : size === 'md' ? 'text-xl' : 'text-sm';
  // The negative margin takes back the tracking after the last letter so the mark centres optically.
  return <span className={cn('t-display -mr-[0.22em] inline-block text-ink-1', scale, className)}>Astrovivu</span>;
}
