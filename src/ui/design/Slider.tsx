import type { ReactNode } from 'react';
import * as RSlider from '@radix-ui/react-slider';
import { AnomalyGlyph } from './AnomalyMarker';
import { cn } from './cn';
import type { Severity } from './tokens';

export interface SliderTick {
  value: number;
  /** Short text under the tick (month name). */
  label?: ReactNode;
  /** Taller tick: month or year boundary. */
  major?: boolean;
}

export interface SliderRange {
  from: number;
  to: number;
  /** `pending`: data not received yet (hatched). `forecast`: beyond today (dashed rule). `mark`: neutral highlight. */
  kind: 'pending' | 'forecast' | 'mark';
}

export interface SliderMarker {
  value: number;
  severity: Severity;
  label?: string;
}

export interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  /** Fires when the user lets go (use it to resume playback or commit a value). */
  onValueCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Names the control: "Timeline", "Overlay opacity". */
  ariaLabel: string;
  /** Spoken value, e.g. the cursor date in words. */
  formatValue?: (value: number) => string;
  /** Scale under the track. */
  ticks?: SliderTick[];
  /** Shaded spans on the track. */
  ranges?: SliderRange[];
  /** Anomaly Markers above the track. */
  markers?: SliderMarker[];
  /** Text carried above the thumb (the cursor date on the scrubber). */
  thumbLabel?: ReactNode;
  /** Fill the track from `min` to the thumb. Off for a timeline, on for an amount. */
  fill?: boolean;
  /** `lg` gives the thumb a 44 px hit area and a taller cursor: the Timeline Scrubber size. */
  size?: 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}

/**
 * Slider base. With `ticks`, `ranges`, `markers` and `thumbLabel` it is the track of the Master
 * Timeline Scrubber; bare, it is an ordinary amount slider. Arrow keys step, Page keys step x10,
 * Home and End jump to the ends.
 */
export function Slider({ value, onValueChange, onValueCommit, min, max, step = 1, ariaLabel, formatValue, ticks, ranges, markers, thumbLabel, fill, size = 'md', disabled, className }: SliderProps) {
  const pct = (v: number) => `${((Math.max(min, Math.min(max, v)) - min) / (max - min || 1)) * 100}%`;
  const lg = size === 'lg';
  const hasScale = !!ticks?.length;
  const hasMarkers = !!markers?.length;

  return (
    <div className={cn('relative w-full select-none', disabled && 'opacity-45', className)} style={{ paddingTop: hasMarkers || thumbLabel != null ? 18 : 0, paddingBottom: hasScale ? 18 : 0 }}>
      {hasMarkers && (
        <svg aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[18px] w-full overflow-visible">
          {markers.map((m) => (
            <svg key={`${m.value}-${m.severity}`} x={pct(m.value)} y={9} className="overflow-visible">
              {m.label && <title>{m.label}</title>}
              <AnomalyGlyph severity={m.severity} x={0} y={0} size={8} halo="var(--color-surface-1)" />
            </svg>
          ))}
        </svg>
      )}

      <RSlider.Root
        value={[value]}
        onValueChange={(v) => onValueChange(v[0])}
        onValueCommit={onValueCommit ? (v) => onValueCommit(v[0]) : undefined}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={cn('relative flex w-full touch-none items-center', lg ? 'h-9' : 'h-6')}
      >
        <RSlider.Track className={cn('relative w-full grow rounded-full bg-line-2', lg ? 'h-1' : 'h-[3px]')}>
          {ranges?.map((r) => (
            <span
              key={`${r.kind}-${r.from}-${r.to}`}
              aria-hidden
              className={cn(
                'absolute top-1/2 -translate-y-1/2',
                r.kind === 'pending' && 'hatch-pending h-2.5 border-x border-stale/50',
                // Dashed rule with opaque gaps, so the solid track underneath reads as broken.
                r.kind === 'forecast' && 'h-full bg-[repeating-linear-gradient(90deg,var(--color-ink-3)_0_4px,var(--color-surface-1)_4px_8px)]',
                r.kind === 'mark' && 'h-full bg-ink-3',
              )}
              style={{ left: pct(r.from), width: `calc(${pct(r.to)} - ${pct(r.from)})` }}
            />
          ))}
          {fill && <RSlider.Range className="slider-fill absolute h-full bg-ink-2" />}
        </RSlider.Track>
        <RSlider.Thumb
          aria-label={ariaLabel}
          aria-valuetext={formatValue?.(value)}
          className={cn(
            // A round knob: white rim so it reads on the track, the ranges and the tick marks alike.
            'relative block rounded-full border-2 border-white bg-signal shadow-md outline-offset-2',
            'transition-transform duration-(--dur-instant) ease-out hover:scale-110 active:scale-110',
            lg ? 'size-5' : 'size-4',
            // Invisible hit area so a small knob is still an easy target.
            'before:absolute before:top-1/2 before:left-1/2 before:size-11 before:-translate-1/2 before:content-[""]',
          )}
        >
          {thumbLabel != null && (
            <span className="t-value pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-xs bg-signal px-1.5 text-xs leading-5 whitespace-nowrap text-on-signal">{thumbLabel}</span>
          )}
        </RSlider.Thumb>
      </RSlider.Root>

      {hasScale && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px]">
          {ticks.map((t) => (
            <span key={t.value} className="absolute top-0 flex items-start" style={{ left: pct(t.value) }}>
              <span className={cn('w-px', t.major ? 'h-2 bg-ink-4' : 'h-1 bg-line-2')} />
              {t.label != null && <span className="mt-px pl-1 text-[11px] leading-[14px] whitespace-nowrap text-ink-4 narrow:text-xs">{t.label}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
