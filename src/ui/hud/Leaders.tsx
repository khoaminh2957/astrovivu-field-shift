import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BRANCHES, BRANCH_SIDE, type BranchId, type ScreenAnchor } from '@/contracts';
import { useMission } from '@/state/mission';
import { LeaderLayer, LeaderLine, MOTION, anchorPoint, footprintTargets, updateLeader, usePrefersReducedMotion, type Point } from '@/ui/design';

const SIDES = ['left', 'right'] as const;
const IDS: Record<'left' | 'right', BranchId[]> = {
  left: BRANCHES.filter((b) => BRANCH_SIDE[b] === 'left'),
  right: BRANCHES.filter((b) => BRANCH_SIDE[b] === 'right'),
};

function targetsFor(anchor: ScreenAnchor): Map<BranchId, Point> {
  const out = new Map<BranchId, Point>();
  for (const side of SIDES) {
    const pts = footprintTargets(anchor, side, IDS[side].length, { spreadDeg: 38 });
    IDS[side].forEach((b, i) => out.set(b, pts[i]));
  }
  return out;
}

interface Props {
  stage: RefObject<HTMLDivElement | null>;
  anchors: RefObject<Map<BranchId, HTMLSpanElement>>;
  shelf: number;
  /** Changes whenever callout heights may have changed (language, density). */
  layoutKey: string;
}

/**
 * Leader lines from each callout anchor to the parcel footprint. Callout anchors are measured on
 * layout changes only (ResizeObserver); the parcel end follows the camera through a store
 * subscription that rewrites the paths directly, so a moving globe never re-renders React.
 */
export function Leaders({ stage, anchors, shelf, layoutKey }: Props) {
  const focus = useMission((s) => s.focusBranch);
  const status = useMission((s) => s.branchStatus);
  const reduced = usePrefersReducedMotion();
  const [from, setFrom] = useState<Map<BranchId, Point> | null>(null);
  const [visible, setVisible] = useState(() => !!useMission.getState().anchor?.visible);
  const groups = useRef(new Map<BranchId, SVGGElement>());
  const fromRef = useRef(from);
  fromRef.current = from;

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const next = new Map<BranchId, Point>();
      for (const [b, a] of anchors.current) next.set(b, anchorPoint(a, el));
      setFrom((prev) => {
        if (prev && prev.size === next.size && [...next].every(([b, p]) => prev.get(b)?.x === p.x && prev.get(b)?.y === p.y)) return prev;
        return next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const col of el.querySelectorAll('[data-hud-column]')) ro.observe(col);
    return () => ro.disconnect();
  }, [stage, anchors, layoutKey]);

  useEffect(() => {
    const apply = (a: ScreenAnchor | null) => {
      const ok = !!a?.visible;
      setVisible((v) => (v === ok ? v : ok));
      const f = fromRef.current;
      if (!a || !ok || !f) return;
      const to = targetsFor(a);
      for (const [b, g] of groups.current) {
        const p = f.get(b);
        const q = to.get(b);
        if (p && q) updateLeader(g, p, q);
      }
    };
    apply(useMission.getState().anchor);
    return useMission.subscribe((s, prev) => {
      if (s.anchor !== prev.anchor) apply(s.anchor);
    });
  }, [from]);

  const anchor = useMission.getState().anchor;
  if (!from || !anchor || !visible) return null;
  const to = targetsFor(anchor);
  let i = 0;
  return (
    <LeaderLayer>
      {BRANCHES.map((b) => {
        const p = from.get(b);
        const q = to.get(b);
        if (!p || !q) return null;
        const delay = i++ * MOTION.stagger;
        return (
          <LeaderLine
            key={b}
            ref={(g) => {
              if (g) groups.current.set(b, g);
              else groups.current.delete(b);
            }}
            from={p}
            to={q}
            side={BRANCH_SIDE[b]}
            shelf={shelf}
            branch={b}
            active={focus === b}
            muted={status[b] !== 'ready'}
            drawOn={!reduced}
            delay={delay}
          />
        );
      })}
    </LeaderLayer>
  );
}
