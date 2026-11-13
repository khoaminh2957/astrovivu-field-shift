import type { ReactNode, Ref, SVGAttributes } from 'react';
import type { BranchId, ScreenAnchor } from '@/contracts';
import { cn } from './cn';
import { BRANCH_VAR } from './tokens';

export interface Point {
  x: number;
  y: number;
}

export type HudSide = 'left' | 'right';

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Geometry of one leader line, the way a technical drawing does it: a horizontal shelf leaving the
 * label, then a single straight run to the feature. `side` is the side of the screen the callout
 * sits on; the shelf always runs toward the parcel.
 */
export function leaderPath(from: Point, to: Point, side: HudSide, shelf = 28): string {
  const dir = side === 'left' ? 1 : -1;
  const room = Math.max(0, (to.x - from.x) * dir - 8);
  const elbow = from.x + dir * Math.min(shelf, room);
  return `M${r1(from.x)} ${r1(from.y)}H${r1(elbow)}L${r1(to.x)} ${r1(to.y)}`;
}

/**
 * Where the leaders of one side land on the parcel: points on the ellipse inscribed in the parcel
 * footprint, fanned around the horizontal and ordered top to bottom so lines never cross.
 * `anchor` is the `ScreenAnchor` the globe publishes (x, y = centre of the footprint).
 */
export function footprintTargets(anchor: Pick<ScreenAnchor, 'x' | 'y' | 'w' | 'h'>, side: HudSide, count: number, opts: { spreadDeg?: number; pad?: number; minRadius?: number } = {}): Point[] {
  const { spreadDeg = 38, pad = 0, minRadius = 18 } = opts;
  const rx = Math.max(minRadius, anchor.w / 2 + pad);
  const ry = Math.max(minRadius, anchor.h / 2 + pad);
  return Array.from({ length: count }, (_, i) => {
    const frac = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const deg = side === 'right' ? frac * spreadDeg : 180 - frac * spreadDeg;
    const a = (deg * Math.PI) / 180;
    return { x: anchor.x + rx * Math.cos(a), y: anchor.y + ry * Math.sin(a) };
  });
}

/** Centre of an element (a callout's leader anchor) in the coordinate space of `relativeTo`. */
export function anchorPoint(el: Element, relativeTo?: Element | null): Point {
  const r = el.getBoundingClientRect();
  const o = relativeTo?.getBoundingClientRect();
  return { x: r.left + r.width / 2 - (o?.left ?? 0), y: r.top + r.height / 2 - (o?.top ?? 0) };
}

export interface LeaderLineProps {
  /** The callout's anchor point. */
  from: Point;
  /** The point on the parcel. */
  to: Point;
  side: HudSide;
  /** Length of the horizontal shelf in px. Defaults to 28 (use the `--hud-shelf` value). */
  shelf?: number;
  /** The branch in focus: the line takes the branch hue, the same hue that paints the parcel. */
  active?: boolean;
  branch?: BranchId;
  /** Branch still loading or unavailable: dashed and dim, no terminal dot. */
  muted?: boolean;
  /** Draw the line on once when it mounts (the lock-on moment). Ignored under reduced motion. */
  drawOn?: boolean;
  /** Seconds to wait before drawing on; stagger siblings by `MOTION.stagger`. */
  delay?: number;
  ref?: Ref<SVGGElement>;
}

/**
 * One leader line: a dark casing so it survives bright imagery, the hairline, and a terminal dot
 * on the parcel. Render inside `LeaderLayer`. For camera moves, keep a ref and call `updateLeader`
 * from `requestAnimationFrame` instead of re-rendering.
 */
export function LeaderLine({ from, to, side, shelf = 28, active, branch, muted, drawOn, delay = 0, ref }: LeaderLineProps) {
  const d = leaderPath(from, to, side, shelf);
  const color = muted ? 'var(--color-ink-4)' : active ? (branch ? BRANCH_VAR[branch] : 'var(--color-signal)') : 'var(--color-ink-3)';
  const animate = drawOn && !muted;
  return (
    <g ref={ref} data-leader-side={side} data-leader-shelf={shelf} style={{ color, transition: 'color var(--dur-fast) var(--ease-out)' }}>
      <path data-leader="casing" d={d} fill="none" stroke="var(--color-void)" strokeOpacity={0.6} strokeWidth={active ? 4.5 : 3.5} strokeLinejoin="round" />
      <path
        data-leader="line"
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 1.5 : 1}
        strokeLinejoin="round"
        pathLength={animate ? 1 : undefined}
        strokeDasharray={muted ? '2 3' : animate ? 1 : undefined}
        className={animate ? 'animate-leader-draw' : undefined}
        style={animate ? { animationDelay: `${delay}s` } : undefined}
      />
      {!muted && <circle data-leader="dot" cx={r1(to.x)} cy={r1(to.y)} r={active ? 3.5 : 2.5} fill="currentColor" stroke="var(--color-void)" strokeWidth={1.5} />}
    </g>
  );
}

/** Moves an already rendered `LeaderLine` without React: for the 60 fps path while the globe moves. */
export function updateLeader(g: SVGGElement | null, from: Point, to: Point): void {
  if (!g) return;
  const side = (g.dataset.leaderSide as HudSide) ?? 'left';
  const shelf = Number(g.dataset.leaderShelf ?? 28);
  const d = leaderPath(from, to, side, shelf);
  for (const el of g.querySelectorAll('path[data-leader]')) el.setAttribute('d', d);
  const dot = g.querySelector('circle[data-leader="dot"]');
  dot?.setAttribute('cx', String(r1(to.x)));
  dot?.setAttribute('cy', String(r1(to.y)));
}

export interface LeaderLayerProps extends SVGAttributes<SVGSVGElement> {
  children: ReactNode;
  ref?: Ref<SVGSVGElement>;
}

/** Full-size SVG overlay for leader lines. Sits between the globe and the callouts, ignores the pointer. */
export function LeaderLayer({ children, className, ref, ...rest }: LeaderLayerProps) {
  return (
    <svg ref={ref} aria-hidden className={cn('pointer-events-none absolute inset-0 z-(--z-leader) size-full overflow-visible', className)} {...rest}>
      {children}
    </svg>
  );
}
