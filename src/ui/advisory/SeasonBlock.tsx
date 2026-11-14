/**
 * One season on the calendar: a block spanning its months, tinted by crop group, with the crop
 * name inside. Pointing at it, focusing it or tapping it opens what the engine says about that
 * season. Every detail field is optional, so only what exists is shown.
 */
import type { CSSProperties } from 'react';
// The design-system Popover opens on click and takes focus; this one must open on hover and on
// focus without moving focus, so it uses the same primitive directly with the same card styling.
import * as RPopover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { RotationSeason } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { cn } from '@/ui/design';
import { FALLOW_HATCH, GROUP_FILL, cropGroup } from './cropGroups';
import { type CurrencyCode, cropNameOnly, fmtNum, monthLong, monthSpan, moneyText } from './format';
import { type Segment, seasonMonths } from './seasonLayout';

export interface OpenBlock {
  key: string;
  /** Opened by a click or tap: it stays until dismissed, instead of following the pointer. */
  pinned: boolean;
}

interface Props {
  segment: Segment;
  blockKey: string;
  open: OpenBlock | null;
  setOpen: (next: OpenBlock | null) => void;
  currency: CurrencyCode;
  usesReference: boolean;
  style?: CSSProperties;
}

export function SeasonBlock({ segment, blockKey, open, setOpen, currency, usesReference, style }: Props) {
  const lang = useLang();
  const t = useT();
  const { season } = segment;
  const group = cropGroup(season.cropId);
  const full = pick(season.label, lang);
  const months = seasonMonths(season);
  const span = monthSpan(season.startMonth, season.endMonth, lang);
  const when = months >= 12 ? t('advisory.cal.allYear') : months === 1 ? span : `${span} · ${t('advisory.cal.months', { n: months })}`;
  const isOpen = open?.key === blockKey;
  const pinned = isOpen && open.pinned;
  const closeIfMine = () => isOpen && !pinned && setOpen(null);
  // The short end of a season that wraps the year keeps only its arrow: the long end carries the name.
  const bare = segment.otherSpan != null && segment.span < segment.otherSpan && segment.span <= 2;

  return (
    <RPopover.Root open={isOpen} onOpenChange={(o) => !o && setOpen(null)}>
      <RPopover.Anchor asChild>
        <button
          type="button"
          data-season-block
          style={{ ...style, ...(group === 'fallow' ? { backgroundImage: FALLOW_HATCH } : null) }}
          title={`${full} · ${when}`}
          aria-label={`${full}, ${when}. ${t(`advisory.group.${group}`)}`}
          aria-expanded={isOpen}
          onPointerEnter={(e) => e.pointerType === 'mouse' && !open?.pinned && setOpen({ key: blockKey, pinned: false })}
          onPointerLeave={(e) => e.pointerType === 'mouse' && closeIfMine()}
          onFocus={() => !open?.pinned && setOpen({ key: blockKey, pinned: false })}
          onBlur={closeIfMine}
          onClick={() => setOpen(pinned ? null : { key: blockKey, pinned: true })}
          className={cn(
            'flex h-full min-w-0 items-center gap-0.5 rounded-xs px-1.5 text-left text-xs font-medium text-ink-1 narrow:px-1',
            GROUP_FILL[group],
            group === 'fallow' && 'text-ink-2',
            segment.openStart && 'rounded-l-none pl-0.5',
            segment.openEnd && 'rounded-r-none pr-0.5',
            isOpen ? 'ring-2 ring-ink-1' : 'hover:ring-1 hover:ring-ink-3',
          )}
        >
          {segment.openStart && <ChevronLeft size={12} strokeWidth={2} aria-hidden className="shrink-0 text-ink-3" />}
          {/* On the hatch the word gets a plain ground, so the texture never runs through the letters. */}
          {!bare && <span className={cn('min-w-0 truncate', group === 'fallow' ? 'rounded-xs bg-surface-2 px-1' : 'flex-1')}>{cropNameOnly(full)}</span>}
          {(bare || group === 'fallow') && <span className="flex-1" />}
          {segment.openEnd && <ChevronRight size={12} strokeWidth={2} aria-hidden className="shrink-0 text-ink-3" />}
        </button>
      </RPopover.Anchor>
      <RPopover.Portal>
        <RPopover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={full}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // A click on the block itself is handled by the block; without this it would close and reopen.
          onInteractOutside={(e) => (e.target as Element | null)?.closest?.('[data-season-block]') && e.preventDefault()}
          // On a short screen the card scrolls inside the room it has, instead of running off the edge.
          className={cn('z-(--z-popover) max-h-[max(var(--radix-popper-available-height),12rem)] w-72 max-w-[calc(100vw-16px)] overflow-y-auto rounded-sm border border-line-1 bg-surface-0 p-3 text-sm text-ink-1 shadow-lg', !pinned && 'pointer-events-none')}
        >
          <SeasonDetail season={season} when={when} currency={currency} usesReference={usesReference} />
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

function SeasonDetail({ season, when, currency, usesReference }: { season: RotationSeason; when: string; currency: CurrencyCode; usesReference: boolean }) {
  const lang = useLang();
  const t = useT();
  const d = season.detail;
  const group = cropGroup(season.cropId);
  const reason = d?.reason ? pick(d.reason, lang) : '';
  const rows: [label: string, value: string, note?: string][] = [];
  const sown = monthLong(season.startMonth, lang);
  const standing = seasonMonths(season) >= 12;
  if (d?.suitability != null) rows.push([standing ? t('advisory.detail.fitStand') : t('advisory.detail.fit', { month: lang === 'vi' ? sown.toLowerCase() : sown }), `${fmtNum(d.suitability, lang)}/100`]);
  if (d?.metInYears) rows.push([t('advisory.detail.met'), t('advisory.detail.metValue', { met: d.metInYears.met, of: d.metInYears.of })]);
  if (d?.yieldTHa != null) rows.push([t('advisory.detail.yield'), `${fmtNum(d.yieldTHa, lang, d.yieldTHa < 10 ? 1 : 0)} t/ha`]);
  if (d?.marginUsdPerHa != null) rows.push([t('advisory.detail.margin'), `${moneyText(d.marginUsdPerHa, currency, lang, { compact: true, signed: true })}/ha`, usesReference ? t('advisory.refShort') : undefined]);
  if (d?.nitrogenKgHa != null) rows.push([t('advisory.detail.nitrogen'), `${fmtNum(d.nitrogenKgHa, lang)} kg N/ha`]);
  const hasWater = d?.waterNeedMm != null || d?.rainMm != null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="t-heading">{pick(season.label, lang)}</p>
        <p className="t-caption">
          {when} · {d?.role ? t(`advisory.role.${d.role}`) : t(`advisory.group.${group}`)}
        </p>
      </div>
      {rows.length > 0 && (
        <dl className="m-0 flex flex-col">
          {rows.map(([label, value, note]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line-1 py-1 last:border-b-0">
              <dt className="t-label">{label}</dt>
              <dd className="m-0 text-right">
                <span className="t-value text-sm text-ink-1">{value}</span>
                {note && <span className="t-caption block">{note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {(d?.yieldTHa != null || d?.marginUsdPerHa != null) && <p className="t-caption">{t('advisory.detail.perHa')}</p>}
      {hasWater && <WaterBars need={d?.waterNeedMm} rain={d?.rainMm} />}
      {reason && <p className="text-sm text-ink-2">{reason}</p>}
      {!rows.length && !hasWater && !reason && <p className="t-caption">{t('advisory.detail.none')}</p>}
    </div>
  );
}

/** Crop water need beside the normal rain of the same months, on one scale. */
function WaterBars({ need, rain }: { need?: number; rain?: number }) {
  const lang = useLang();
  const t = useT();
  const max = Math.max(need ?? 0, rain ?? 0, 1);
  const gap = need != null && rain != null ? Math.round(rain - need) : null;
  const bar = (label: string, v: number | undefined, fill: string) =>
    v != null && (
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.75rem] items-center gap-2">
        <span className="t-label">{label}</span>
        <span className="h-2 bg-surface-2">
          <span className={cn('block h-full rounded-r-xs', fill)} style={{ width: `${(v / max) * 100}%` }} />
        </span>
        <span className="t-value text-right text-xs text-ink-1">{fmtNum(v, lang)} mm</span>
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      {bar(t('advisory.detail.waterNeed'), need, 'bg-ink-3')}
      {bar(t('advisory.detail.rain'), rain, 'bg-branch-rainfall')}
      {gap != null && <p className="t-caption">{gap >= 0 ? t('advisory.detail.rainOver', { n: fmtNum(gap, lang) }) : t('advisory.detail.rainUnder', { n: fmtNum(-gap, lang) })}</p>}
    </div>
  );
}
