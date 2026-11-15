/**
 * One tile per rotation strategy, the current practice first as the baseline. The strip stays at the
 * top of the page while it scrolls, so a tile is short: what the strategy is, what it grows, its
 * score for the farmer's priorities and the gap to today. What changes against today is the
 * trade-off chart's job. Choosing a tile drives the rest of the page.
 */
import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Award, Check } from 'lucide-react';
import type { RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { Tag, cn } from '@/ui/design';
import { FALLOW_HATCH, GROUP_SOLID, cropGroup } from './cropGroups';
import { cropNameOnly, fmtNum, fmtSigned } from './format';
import { layoutRotation } from './seasonLayout';

interface Props {
  /** Already ordered: current first, then by score. */
  rotations: RotationStrategy[];
  current: RotationStrategy | null;
  bestId: string | null;
  selectedId: string;
  onSelect: (id: string) => void;
}

export function StrategyCards({ rotations, current, bestId, selectedId, onSelect }: Props) {
  const t = useT();
  const refs = useRef(new Map<string, HTMLButtonElement>());

  // Radio group keys: arrows move the choice, as they do between native radio buttons.
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = rotations[(i + step + rotations.length) % rotations.length];
    onSelect(next.id);
    const el = refs.current.get(next.id);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div role="radiogroup" aria-label={t('advisory.compareTitle')} className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 py-1">
      {rotations.map((r, i) => (
        <Card
          key={r.id}
          strategy={r}
          current={current}
          best={r.id === bestId}
          selected={r.id === selectedId}
          onSelect={() => onSelect(r.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
          buttonRef={(el) => (el ? refs.current.set(r.id, el) : refs.current.delete(r.id))}
        />
      ))}
    </div>
  );
}

interface CardProps {
  strategy: RotationStrategy;
  current: RotationStrategy | null;
  best: boolean;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

function Card({ strategy: r, current, best, selected, onSelect, onKeyDown, buttonRef }: CardProps) {
  const t = useT();
  const lang = useLang();
  const isCurrent = r.kind === 'current';
  const scoreDelta = !isCurrent && current ? Math.round(r.score) - Math.round(current.score) : null;
  const nameId = useId();
  const crops = [...new Set(r.seasons.map((s) => cropNameOnly(pick(s.label, lang))))].join(' · ');

  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-labelledby={nameId}
      aria-describedby={`${nameId}-d`}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        // `relative` keeps the visually hidden words inside the card, so they scroll with it.
        'relative flex min-w-44 flex-[1_0_11rem] snap-start flex-col gap-1.5 rounded-sm border px-3 py-2 text-left transition-colors duration-(--dur-instant) narrow:min-w-40 narrow:gap-1 narrow:py-1.5',
        selected ? 'border-signal bg-signal/8 ring-1 ring-signal' : best ? 'border-signal-strong bg-surface-0 hover:bg-surface-2' : 'border-line-2 bg-surface-0 hover:bg-surface-2',
      )}
    >
      <span className="flex min-h-5 items-center gap-1.5">
        <Tag tone="neutral" variant={isCurrent ? 'solid' : 'outline'}>
          {isCurrent ? t('advisory.card.baseline') : t(`advisory.kind.${r.kind}`)}
        </Tag>
        {best && (
          <span title={t('advisory.card.best')} className="inline-flex items-center gap-1 text-xs font-medium text-signal-strong">
            <Award size={14} strokeWidth={2} aria-hidden />
            <span className="compact:sr-only">{t('advisory.card.best')}</span>
          </span>
        )}
        {/* The radio mark: selection is a shape, not only the green rim. */}
        <span aria-hidden className={cn('ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-signal bg-signal text-on-signal' : 'border-line-3 bg-surface-0')}>
          {selected && <Check size={11} strokeWidth={3} />}
        </span>
      </span>

      {/* `t-heading` balances its wrapping, which would undo `truncate`: one line is forced, the full name is the tooltip. */}
      <span id={nameId} className="t-heading truncate text-nowrap! text-ink-1" title={pick(r.name, lang)}>
        {pick(r.name, lang)}
      </span>

      {/* Read after the name: the card is named by its strategy and described by the rest. */}
      <span id={`${nameId}-d`} className="flex flex-col gap-1.5">
        <span className="flex flex-col gap-1">
          <Ribbon strategy={r} />
          <span className="t-caption truncate narrow:hidden" title={crops}>
            {crops || t('advisory.card.noSeasons')}
            {r.years > 1 && ` · ${t('advisory.card.years', { n: r.years })}`}
          </span>
        </span>

        <span className="flex items-baseline gap-1.5">
          <span className="t-value text-xl leading-6 text-ink-1">{fmtNum(r.score, lang)}</span>
          <span className="t-unit">/100</span>
          {scoreDelta != null && (
            <span className={cn('t-value ml-auto truncate text-xs', scoreDelta > 0 ? 'text-nominal' : scoreDelta < 0 ? 'text-alert' : 'text-ink-3')}>
              {fmtSigned(scoreDelta, lang)} {t('advisory.card.vsCurrent')}
            </span>
          )}
          {isCurrent && <span className="t-caption ml-auto truncate">{t('advisory.card.yourToday')}</span>}
        </span>

      </span>
    </button>
  );
}

/** The rotation as a thin strip, all its years end to end; the calendar below carries the names. */
function Ribbon({ strategy }: { strategy: RotationStrategy }) {
  const rows = layoutRotation(strategy.seasons, strategy.years);
  return (
    <span aria-hidden className="flex gap-1">
      {rows.map((row) => (
        <span key={row.year} className="grid flex-1 grid-cols-12 gap-y-px overflow-hidden rounded-xs bg-surface-3" style={{ gridTemplateRows: `repeat(${Math.max(1, row.lanes.length)}, 6px)` }}>
          {row.lanes.map((lane, li) =>
            lane.map((seg) => {
              const group = cropGroup(seg.season.cropId);
              return (
                <span
                  key={`${seg.index}-${seg.col}`}
                  className={cn('border-r border-surface-0 last:border-r-0', GROUP_SOLID[group])}
                  style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: li + 1, ...(group === 'fallow' ? { backgroundImage: FALLOW_HATCH } : null) }}
                />
              );
            }),
          )}
        </span>
      ))}
    </span>
  );
}
