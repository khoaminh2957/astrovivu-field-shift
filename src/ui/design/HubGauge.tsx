import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from './cn';
import './strings';

/** Gauge sweep: 270 degrees, open at the bottom where the limiting factor is written. */
const START = 135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export type HubStatus = 'nominal' | 'watch' | 'alert';

/** Default banding of a 0-100 score. Pass `status` explicitly when the scorer knows better. */
export function hubStatus(value: number): HubStatus {
  return value >= 65 ? 'nominal' : value >= 40 ? 'watch' : 'alert';
}

export interface HubGaugeProps {
  /** Headline score, 0..100. Null renders the empty state. */
  value: number | null;
  /** What the headline is: "Productivity". */
  label: ReactNode;
  /** Second reading on the inner arc, 0..100 (compatibility, or condition). */
  secondary?: number | null;
  secondaryLabel?: ReactNode;
  /** The limiting factor at the cursor date, already translated: "Water". */
  limiting?: ReactNode;
  /** Colour band of the outer arc. `auto` derives it from `value`. */
  status?: HubStatus | 'auto';
  /** Diameter in px. Defaults to the `--hud-hub` token. */
  size?: number;
  /** True while the timeline plays or scrubs: the arc follows the value with no easing. */
  instant?: boolean;
  /** Marks the score as computed from simulated telemetry. */
  simulated?: boolean;
  loading?: boolean;
  /** Makes the hub a button (open the factor breakdown). */
  onSelect?: () => void;
  className?: string;
}

const STATUS_STROKE: Record<HubStatus, string> = {
  // A healthy score is plain light: colour is kept for when the farmer has to act.
  nominal: 'var(--color-signal)',
  watch: 'var(--color-watch)',
  alert: 'var(--color-alert)',
};

/**
 * Center Productivity Hub. A 270 degree gauge with a scale: outer arc = headline score, inner arc
 * = secondary score, the gap at the bottom names what limits the score.
 */
export function HubGauge({ value, label, secondary, secondaryLabel, limiting, status = 'auto', size, instant, simulated, loading, onSelect, className }: HubGaugeProps) {
  const t = useT();
  const d = size ?? 148;
  const c = d / 2;
  const rOuter = c - 11;
  const rInner = rOuter - 8;
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const s = secondary == null ? null : Math.max(0, Math.min(100, secondary));
  const band = v == null ? 'nominal' : status === 'auto' ? hubStatus(v) : status;
  const ease = instant ? 'none' : 'stroke-dasharray var(--dur-base) var(--ease-out), stroke var(--dur-base) var(--ease-out)';
  const ticks = Array.from({ length: 11 }, (_, i) => i * 10);
  const Root = onSelect ? 'button' : 'div';
  // With no explicit size the hub follows the --hud-hub token, so text scales with it in CSS.
  const dim = size == null ? 'var(--hud-hub)' : `${d}px`;

  return (
    <Root
      {...(onSelect ? { type: 'button' as const, onClick: onSelect } : {})}
      className={cn('relative block shrink-0 rounded-full text-ink-1', className)}
      style={{ width: dim, height: dim }}
      aria-label={v != null ? `${typeof label === 'string' ? label : ''} ${Math.round(v)} / 100` : t('design.hub.noScore')}
    >
      <svg viewBox={`0 0 ${d} ${d}`} className="absolute inset-0 size-full" aria-hidden>
        <circle cx={c} cy={c} r={c - 0.5} fill="var(--color-surface-0)" fillOpacity={0.9} stroke="var(--color-line-2)" />
        {ticks.map((tick) => {
          const deg = START + (tick / 100) * SWEEP;
          const major = tick % 50 === 0;
          const [x0, y0] = polar(c, c, rOuter + 4.5, deg);
          const [x1, y1] = polar(c, c, rOuter + (major ? 9 : 7), deg);
          return <line key={tick} x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? 'var(--color-ink-3)' : 'var(--color-line-3)'} strokeWidth={1} />;
        })}
        <path d={arc(c, c, rOuter, START, START + SWEEP)} fill="none" stroke="var(--color-line-2)" strokeWidth={5} />
        {v != null && (
          <path
            d={arc(c, c, rOuter, START, START + SWEEP)}
            fill="none"
            stroke={STATUS_STROKE[band]}
            strokeWidth={5}
            pathLength={100}
            strokeDasharray={`${v} 100`}
            style={{ transition: ease }}
          />
        )}
        {secondary !== undefined && (
          <>
            <path d={arc(c, c, rInner, START, START + SWEEP)} fill="none" stroke="var(--color-line-1)" strokeWidth={2} />
            {s != null && (
              <path d={arc(c, c, rInner, START, START + SWEEP)} fill="none" stroke="var(--color-ink-3)" strokeWidth={2} pathLength={100} strokeDasharray={`${s} 100`} style={{ transition: ease }} />
            )}
          </>
        )}
      </svg>

      <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="t-label max-w-[62%] truncate" style={{ marginTop: `calc(${dim} * -0.05)` }}>
          {label}
        </span>
        {loading ? (
          <span className="skeleton my-1 block" style={{ width: `calc(${dim} * 0.34)`, height: `calc(${dim} * 0.22)` }} />
        ) : (
          <span className={cn('t-value leading-none', v == null && 'text-ink-4')} style={{ fontSize: `calc(${dim} * 0.27)`, color: v != null && band !== 'nominal' ? STATUS_STROKE[band] : undefined }}>
            {v == null ? '--' : Math.round(v)}
          </span>
        )}
        {secondary !== undefined && (
          <span className="t-meta mt-0.5 flex max-w-[70%] items-baseline gap-1">
            <span className="truncate font-sans [font-stretch:var(--stretch-semi)]">{secondaryLabel}</span>
            <span className="text-ink-2">{s == null ? '--' : Math.round(s)}</span>
          </span>
        )}
      </span>

      {(limiting != null || simulated) && (
        <span className="absolute top-full left-1/2 flex -translate-x-1/2 -translate-y-[15%] flex-col items-center gap-1 whitespace-nowrap">
          {limiting != null && (
            <span className="plate flex h-6 items-center gap-1.5 px-2 text-xs">
              <span className="text-ink-3 [font-stretch:var(--stretch-semi)]">{t('design.hub.limited')}</span>
              <span className="font-semibold" style={{ color: band === 'nominal' ? undefined : STATUS_STROKE[band] }}>
                {limiting}
              </span>
            </span>
          )}
          {simulated && <span className="t-status hatch-simulated px-1 text-simulated">{t('design.status.simulated')}</span>}
        </span>
      )}
    </Root>
  );
}
