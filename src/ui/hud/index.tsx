/**
 * State 3: the Focal Parcel Radial HUD. Eight telemetry callouts (four per side, BRANCHES order)
 * joined to the parcel by leader lines, the Center Productivity Hub on the parcel centre, and the
 * expanded reading of the branch in focus. Layout rules: docs/DESIGN.md, "Radial HUD".
 */
import { useCallback, useRef } from 'react';
import { BRANCHES, BRANCH_SIDE, type BranchId, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { HUD_METRICS, ScrollArea, StatusTag, useHudDensity } from '@/ui/design';
import { useMissionUi } from '@/ui/chrome/uiState';
import { BranchCallout } from './BranchCallout';
import { FocusPanel } from './FocusPanel';
import { Hub } from './Hub';
import { Leaders } from './Leaders';
import './strings';

const LEFT = BRANCHES.filter((b) => BRANCH_SIDE[b] === 'left');
const RIGHT = BRANCHES.filter((b) => BRANCH_SIDE[b] === 'right');

/** Says plainly when the screen is simulated, still loading, or failed. Quiet when all is well. */
function HudNotice() {
  const t = useT();
  const lang = useLang();
  const mode = useMission((s) => s.telemetry?.mode);
  const loadError = useMission((s) => s.loadError);
  const status = useMission((s) => s.branchStatus);
  const notes = useMission((s) => s.telemetry?.branches.soilMoisture.notes);
  const done = BRANCHES.filter((b) => status[b] === 'ready' || status[b] === 'error').length;

  let body: React.ReactNode = null;
  if (loadError) {
    body = (
      <>
        <StatusTag status="alert" label={t('hud.error.title')} />
        <span className="t-caption min-w-0 truncate">{loadError}</span>
      </>
    );
  } else if (mode === 'mock') {
    const why = notes?.length ? pick(notes[notes.length - 1], lang) : t('hud.sim.body');
    body = (
      <>
        <StatusTag status="simulated" label={t('hud.sim.title')} />
        <span className="min-w-0 text-sm text-ink-2">{why}</span>
      </>
    );
  } else if (done < BRANCHES.length) {
    body = (
      <>
        <span className="skeleton h-3 w-10 shrink-0" aria-hidden />
        <span className="min-w-0 text-sm text-ink-2">
          <span className="text-ink-1">{t('hud.loading.title')}</span> · {t('hud.loading.body', { done })}
        </span>
      </>
    );
  }
  if (!body) return null;
  return (
    <div role="status" className="pointer-events-none absolute top-[calc(var(--topbar-h)+8px)] left-1/2 z-(--z-hud) flex max-w-[min(640px,calc(100vw-2*var(--hud-callout-w)-4*var(--hud-gutter)))] -translate-x-1/2 stacked:max-w-[calc(100vw-24px)]">
      <div className="plate pointer-events-auto flex min-w-0 items-center gap-2 px-3 py-1.5">{body}</div>
    </div>
  );
}

export function RadialHud() {
  const t = useT();
  const lang = useLang();
  const density = useHudDensity();
  const metrics = HUD_METRICS[density];
  const focus = useMission((s) => s.focusBranch);
  const overrideOpen = useMissionUi((s) => s.overrideOpen);
  // Callout heights change when a branch resolves: re-measure the anchors then.
  const readyKey = useMission((s) => BRANCHES.map((b) => s.branchStatus[b][0]).join(''));
  const stage = useRef<HTMLDivElement | null>(null);
  const anchors = useRef(new Map<BranchId, HTMLSpanElement>());
  const anchorRefs = useRef(new Map<BranchId, (el: HTMLSpanElement | null) => void>());
  const refFor = useCallback((b: BranchId) => {
    let fn = anchorRefs.current.get(b);
    if (!fn) {
      fn = (el) => {
        if (el) anchors.current.set(b, el);
        else anchors.current.delete(b);
      };
      anchorRefs.current.set(b, fn);
    }
    return fn;
  }, []);

  if (density === 'stacked') {
    // Below lg there is no radial layout: the map keeps the top of the screen, the hub and the
    // callouts become a list, and the focus hue alone ties a callout to the parcel paint.
    return (
      <>
        <HudNotice />
        <section aria-label={t('hud.aria.hud')} className="absolute inset-x-0 top-[calc(var(--topbar-h)+300px)] bottom-(--timeline-h) z-(--z-hud) border-t border-line-1 bg-surface-0/94">
          <ScrollArea className="h-full" viewportClassName="p-3">
            <Hub stacked />
            <div className="grid gap-2 sm:grid-cols-2">
              {BRANCHES.map((b) => (
                <BranchCallout key={b} branch={b} side={BRANCH_SIDE[b]} sparkHeight={metrics.sparkline} />
              ))}
            </div>
          </ScrollArea>
        </section>
        {focus && !overrideOpen && <FocusPanel branch={focus} />}
      </>
    );
  }

  return (
    <section ref={stage} aria-label={t('hud.aria.hud')} className="pointer-events-none absolute inset-0 z-(--z-hud)">
      <HudNotice />
      <Hub />
      {(
        [
          ['left', LEFT],
          ['right', RIGHT],
        ] as const
      ).map(([side, ids]) => (
        <div
          key={side}
          data-hud-column
          className="pointer-events-none absolute top-[calc(var(--topbar-h)+8px)] bottom-[calc(var(--timeline-h)+8px)] flex flex-col justify-center gap-2"
          style={side === 'left' ? { left: 'var(--hud-gutter)' } : { right: 'var(--hud-gutter)' }}
        >
          {ids.map((b) => (
            <BranchCallout key={b} branch={b} side={side} sparkHeight={metrics.sparkline} anchorRef={refFor(b)} className="pointer-events-auto h-[168px] overflow-hidden compact:h-[130px]" />
          ))}
        </div>
      ))}
      {/* After the columns, so the callout anchors exist when the leaders measure them. */}
      <Leaders stage={stage} anchors={anchors} shelf={metrics.shelf} layoutKey={`${density}-${lang}-${readyKey}`} />
      {focus && !overrideOpen && (
        <div className="pointer-events-auto">
          <FocusPanel branch={focus} />
        </div>
      )}
    </section>
  );
}
