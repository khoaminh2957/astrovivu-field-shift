import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from './cn';
import './strings';
import { Tooltip } from './Tooltip';
import type { Severity } from './tokens';

const SEVERITY_VAR: Record<Severity, string> = {
  info: 'var(--color-ink-2)',
  watch: 'var(--color-watch)',
  alert: 'var(--color-alert)',
};

/** Outline of each marker in a box of side `s` centred on 0,0: ring, triangle, diamond. */
function markerPath(severity: Severity, s: number): string {
  const r = s / 2;
  if (severity === 'watch') return `M0 ${-r}L${r} ${r * 0.82}H${-r}Z`;
  if (severity === 'alert') return `M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z`;
  return `M${-r * 0.8} 0A${r * 0.8} ${r * 0.8} 0 1 0 ${r * 0.8} 0A${r * 0.8} ${r * 0.8} 0 1 0 ${-r * 0.8} 0Z`;
}

export interface AnomalyGlyphProps {
  severity: Severity;
  /** Centre of the glyph in the parent SVG's coordinates. */
  x: number;
  y: number;
  size?: number;
  /** Colour of the casing that separates the glyph from the trace under it. */
  halo?: string;
}

/** The marker as an SVG group, for use inside charts and the timeline track. */
export function AnomalyGlyph({ severity, x, y, size = 8, halo = 'var(--color-surface-1)' }: AnomalyGlyphProps) {
  const d = markerPath(severity, size);
  const hollow = severity === 'info';
  return (
    <g transform={`translate(${x} ${y})`} style={{ color: SEVERITY_VAR[severity] }}>
      <path d={d} fill={halo} stroke={halo} strokeWidth={3} strokeLinejoin="round" />
      <path d={d} fill={hollow ? halo : 'currentColor'} stroke="currentColor" strokeWidth={hollow ? 1.5 : 0.5} strokeLinejoin="round" />
    </g>
  );
}

export interface AnomalyMarkerProps {
  severity: Severity;
  /** What happened, in a sentence. Shown on hover and focus and read by screen readers. */
  label?: ReactNode;
  size?: number;
  /** Makes the marker a button (jump the timeline to this event). */
  onSelect?: () => void;
  className?: string;
}

/**
 * Anomaly Marker. Ring = note, triangle = watch, diamond = alert: the shape carries the severity,
 * the colour repeats it. Standalone HTML version; charts use `AnomalyGlyph`.
 */
export function AnomalyMarker({ severity, label, size = 10, onSelect, className }: AnomalyMarkerProps) {
  const t = useT();
  const word = t(`design.sev.${severity}`);
  const box = size + 4;
  const svg = (
    <svg width={box} height={box} viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`} aria-hidden>
      <AnomalyGlyph severity={severity} x={0} y={0} size={size} halo="transparent" />
    </svg>
  );
  const name = typeof label === 'string' ? `${word}: ${label}` : word;
  const node = onSelect ? (
    <button type="button" aria-label={name} onClick={onSelect} className={cn('inline-flex size-6 items-center justify-center rounded-xs hover:bg-surface-3', className)}>
      {svg}
    </button>
  ) : (
    <span role="img" aria-label={name} tabIndex={label != null ? 0 : undefined} className={cn('inline-flex items-center justify-center rounded-xs', className)}>
      {svg}
    </span>
  );
  if (label == null) return node;
  return (
    <Tooltip
      content={
        <span>
          <span className="t-status mr-1.5" style={{ color: SEVERITY_VAR[severity] }}>
            {word}
          </span>
          {label}
        </span>
      }
    >
      {node}
    </Tooltip>
  );
}
