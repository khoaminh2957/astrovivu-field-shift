/**
 * One tile per rotation strategy, the current practice first as the baseline. The strip stays at the
 * top of the page while it scrolls, so a tile is short: what the strategy is, what it grows, its
 * score for the farmer's priorities and the gap to today. What changes against today is the
 * trade-off chart's job. Choosing a tile drives the rest of the page.
 */
import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { RotationStrategy } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { cn } from '@/ui/design';
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
  const horizon = Math.max(1, ...rotations.map((strategy) => strategy.years));

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
    <div role="radiogroup" aria-label={t('advisory.compareTitle')} className="rotation-card-grid">
      {rotations.map((r, i) => (
        <Card
          key={r.id}
          strategy={r}
          current={current}
          best={r.id === bestId}
          horizon={horizon}
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
  horizon: number;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

function Card({ strategy: r, current, best, horizon, selected, onSelect, onKeyDown, buttonRef }: CardProps) {
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
      className="rotation-card"
    >
      <span className="flex min-h-5 items-center gap-1.5">
        <span className={cn('rotation-badge', isCurrent && 'rotation-badge-neutral')}>
          {isCurrent ? t('advisory.workspace.baseline') : best ? t('advisory.card.best') : t(`advisory.kind.${r.kind}`)}
        </span>
        <span aria-hidden className="rotation-radio" />
      </span>

      {/* `t-heading` balances its wrapping, which would undo `truncate`: one line is forced, the full name is the tooltip. */}
      <span id={nameId} className="rotation-card-title" title={pick(r.name, lang)}>
        {pick(r.name, lang)}
      </span>

      {/* Read after the name: the card is named by its strategy and described by the rest. */}
      <span id={`${nameId}-d`} className="flex flex-col gap-2">
        <span className="rotation-card-crops" title={crops}>
          {isCurrent && crops && new Set(r.seasons.map((season) => season.cropId)).size === 1
            ? t('advisory.workspace.everyYear', { crop: crops })
            : [crops || t('advisory.card.noSeasons'), r.years > 1 && t('advisory.card.years', { n: r.years })].filter(Boolean).join(' · ')}
        </span>
        <Ribbon strategy={r} repeatYears={isCurrent && r.years === 1 ? horizon : 1} />

        <span className="rotation-score-line">
          <span><strong>{fmtNum(r.score, lang)}</strong> /100</span>
          {scoreDelta != null && (
            <span className={cn('rotation-badge ml-auto', scoreDelta < 0 && 'rotation-badge-neutral')}>
              {fmtSigned(scoreDelta, lang)} {t('advisory.card.vsCurrent')}
            </span>
          )}
          {isCurrent && <span className="rotation-badge rotation-badge-neutral ml-auto">{t('advisory.workspace.currentPractice')}</span>}
        </span>

      </span>
    </button>
  );
}

/** The rotation as a thin strip, all its years end to end; the calendar below carries the names. */
function Ribbon({ strategy, repeatYears }: { strategy: RotationStrategy; repeatYears: number }) {
  const cycle = layoutRotation(strategy.seasons, strategy.years);
  const rows = repeatYears === 1 ? cycle : Array.from({ length: repeatYears }, (_, year) => ({ ...cycle[0], year }));
  return (
    <span aria-hidden className="flex gap-1">
      {rows.map((row) => (
        <span key={row.year} className="grid flex-1 grid-cols-12 gap-y-px overflow-hidden rounded-xs bg-surface-3" style={{ gridTemplateRows: `repeat(${Math.max(1, row.lanes.length)}, 8px)` }}>
          {row.lanes.map((lane, li) =>
            lane.map((seg) => {
              const group = cropGroup(seg.season.cropId);
              return (
                <span
                  key={`${seg.index}-${seg.col}`}
                  className={cn('border-r border-surface-0 last:border-r-0', GROUP_SOLID[group], group !== 'fallow' && 'rotation-ribbon-crop')}
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
