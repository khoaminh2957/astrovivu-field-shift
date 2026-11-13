import type { ReactNode, Ref } from 'react';
import { CloudOff } from 'lucide-react';
import type { BranchId } from '@/contracts';
import { useT } from '@/i18n';
import { BranchIcon } from './BranchIcon';
import { cn } from './cn';
import type { HudSide } from './LeaderLines';
import './strings';
import { StatusTag } from './Tag';
import type { Status } from './tokens';

export interface CalloutProps {
  /** Side of the screen: decides which edge carries the leader-line anchor. */
  side: HudSide;
  /** Branch title, already translated. */
  title: ReactNode;
  /** Sets the icon and, when `active`, the hue of the icon. */
  branch?: BranchId;
  /** Replaces the branch icon. */
  icon?: ReactNode;
  /** Headline reading at the cursor date, formatted by the caller. Null or undefined shows `--`. */
  value?: ReactNode;
  unit?: ReactNode;
  /** One line under the value: departure from normal, age, or what the number means. */
  delta?: ReactNode;
  /** `nominal` (or nothing) draws no tag: a quiet plate means nothing needs attention. */
  status?: Status | null;
  /** With `status="ground-truth"`: the satellite estimate the farmer's value replaced (struck through). */
  estimate?: ReactNode;
  /** Slot for `<ConfidenceBadge variant="glyph" />`. */
  badge?: ReactNode;
  /** Slot under the chart for `<ProvenanceTag />`. */
  meta?: ReactNode;
  /** Slot for the `<Sparkline />` or `<CalloutFacts />`. */
  children?: ReactNode;
  /** The branch in focus (also the one painting the parcel). */
  active?: boolean;
  loading?: boolean;
  /** Reason the branch has no data. Replaces value and chart. */
  unavailable?: ReactNode;
  /** Focus this branch. Makes the title a button and the plate clickable. */
  onSelect?: () => void;
  /** Receives the anchor element on the inner edge: measure it with `anchorPoint()` for the leader. */
  anchorRef?: Ref<HTMLSpanElement>;
  className?: string;
}

/**
 * HUD callout: one telemetry branch as an instrument plate. Reads top to bottom as
 * what it is / the reading and its state / how it has moved / where it comes from.
 */
export function Callout({ side, title, branch, icon, value, unit, delta, status, estimate, badge, meta, children, active, loading, unavailable, onSelect, anchorRef, className }: CalloutProps) {
  const t = useT();
  const flagged = status === 'watch' || status === 'alert';
  const truth = status === 'ground-truth';
  const stale = status === 'stale';
  const head = (
    <>
      {icon ?? (branch && <BranchIcon branch={branch} colored={active} className={active ? undefined : 'text-ink-3'} />)}
      <span className={cn('t-label min-w-0 truncate', active && 'text-ink-1')}>{title}</span>
    </>
  );

  return (
    <div
      role="group"
      data-active={active || undefined}
      data-side={side}
      onClick={onSelect}
      className={cn(
        'plate relative flex w-(--hud-callout-w) min-w-0 flex-col gap-1.5 p-3 compact:gap-1 compact:p-1.5',
        'transition-[border-color,background-color] duration-(--dur-fast) ease-out',
        onSelect && 'cursor-pointer hover:border-line-3',
        active && 'border-ink-3 bg-surface-2',
        status === 'watch' && 'border-watch/45',
        status === 'alert' && 'border-alert/55',
        className,
      )}
    >
      {/* Where the leader line meets the plate: level with the title, on the edge facing the parcel. */}
      <span
        ref={anchorRef}
        data-leader-anchor
        aria-hidden
        className={cn('absolute top-[21px] size-[5px] -translate-y-1/2 bg-ink-3 compact:top-[15px] stacked:hidden', side === 'left' ? '-right-[3px]' : '-left-[3px]', active && 'bg-signal')}
      />

      <div className="flex h-[18px] items-center gap-1.5">
        {onSelect ? (
          <button type="button" aria-pressed={active} onClick={(e) => (e.stopPropagation(), onSelect())} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xs text-left">
            {head}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">{head}</div>
        )}
        <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {badge}
        </span>
      </div>

      {unavailable != null ? (
        <div className="flex flex-1 items-start gap-2 py-1 text-ink-3">
          <CloudOff size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-2">{t('design.callout.unavailable')}</p>
            <p className="t-caption">{unavailable}</p>
          </div>
        </div>
      ) : loading ? (
        <div aria-busy className="flex flex-col gap-2" aria-label={t('design.common.loading')}>
          <span className="skeleton h-6 w-24 compact:h-5" />
          <span className="skeleton h-8 w-full compact:h-6" />
          <span className="skeleton h-3 w-32" />
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={cn(
                't-value text-2xl leading-7 compact:text-xl compact:leading-6',
                stale && 'text-ink-3',
                truth && 'rounded-xs bg-signal px-1.5 text-on-signal',
                status === 'alert' && 'text-alert',
              )}
            >
              {value ?? '--'}
            </span>
            {unit != null && <span className="t-unit shrink-0">{unit}</span>}
            {truth && estimate != null && (
              <s className="t-meta shrink-0" title={t('design.callout.estimate')}>
                {estimate}
              </s>
            )}
            {status && status !== 'nominal' && <StatusTag status={status} className="ml-auto self-center" />}
          </div>
          {delta != null && <p className={cn('t-caption truncate compact:text-2xs compact:leading-[14px]', flagged && 'text-ink-2')}>{delta}</p>}
          {children != null && <div className="min-w-0">{children}</div>}
          {meta != null && <div className="flex h-5 min-w-0 items-center compact:h-4">{meta}</div>}
        </>
      )}
    </div>
  );
}

export interface CalloutFact {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
}

/** Static facts in place of a sparkline (terrain, soil): two or three label / value pairs in a row. */
export function CalloutFacts({ items, className }: { items: CalloutFact[]; className?: string }) {
  return (
    <dl className={cn('grid min-w-0 gap-x-3 gap-y-1 border-t border-line-1 pt-1.5', className)} style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 3)}, minmax(0, 1fr))` }}>
      {items.map((f, i) => (
        <div key={i} className="min-w-0">
          <dt className="t-caption truncate">{f.label}</dt>
          <dd className="m-0 flex items-baseline gap-1">
            <span className="t-value text-sm text-ink-1">{f.value ?? '--'}</span>
            {f.unit != null && <span className="t-unit text-2xs">{f.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
