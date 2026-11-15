/**
 * The controls that sit over the farm scene: the time bar (months or quarters, then today), the
 * rotation picker (one line, opening into the strategy cards), a character with its three-dot
 * bubble, and the short note it gives when pressed.
 */
import type { ReactNode } from 'react';
import { ChevronDown, CircleAlert, FileText, Pause, Play, Sparkles, Sprout, Undo2, X } from 'lucide-react';
import { type Lang, type RotationStrategy, pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { type FarmNote, type FarmOption, type FarmPeriod, type FarmStep, type FarmTrial, type FarmVoice, type PeriodLand, cropLook, seasonOutcome } from '@/core/farm';
import { useLang, useT } from '@/i18n';
import { cropNameOnly, monthLong, monthShort } from '@/ui/advisory/format';
import { StrategyCards } from '@/ui/advisory/StrategyCards';
import { Button, IconButton, Segmented, cn } from '@/ui/design';
import { Mascot, type MascotClip, type MascotId } from '@/ui/mascot';
import { MascotFigure } from './Mascots';
import { FieldChip, PlantIcon } from './plants';

export const MASCOT_OF: Record<FarmVoice, MascotId> = { space: 'Satellite', soil: 'Seed', rice: 'Rice' };

export function periodLabel(p: FarmPeriod, lang: Lang, long = false): string {
  const year = p.to.slice(0, 4);
  if (p.months.length === 1) return long ? `${monthLong(p.months[0], lang)} ${year}` : monthShort(p.months[0], lang);
  const span = `${monthShort(p.months[0], lang)}–${monthShort(p.months.at(-1)!, lang)}`;
  return long ? `${span} ${year}` : span;
}

// ------------------------------------------------------------------------------------------------
// Time
// ------------------------------------------------------------------------------------------------

export interface TimeBarProps {
  periods: FarmPeriod[];
  /** Index of the period shown; null for today. */
  idx: number | null;
  step: FarmStep;
  playing: boolean;
  holdMs: number;
  onStep: (s: FarmStep) => void;
  onPlay: () => void;
  onPick: (idx: number | null) => void;
  trailing?: ReactNode;
  /** What stands on the field in each period, in the order of `periods`: drawn under each step. */
  land?: (PeriodLand & { name: string | null })[];
}

export function TimeBar({ periods, idx, step, playing, holdMs, onStep, onPlay, onPick, trailing, land }: TimeBarProps) {
  const t = useT();
  const lang = useLang();
  return (
    <div role="group" aria-label={t('farm.time')} className="farm-plate flex items-center gap-2 rounded-md p-2 md:gap-3 md:px-3" data-farm-timebar>
      <IconButton label={playing ? t('farm.pause') : t('farm.play')} icon={playing ? <Pause /> : <Play />} variant="primary" size="lg" className="shrink-0 rounded-full [&_svg]:size-4 [&_svg]:fill-current" onClick={onPlay} data-farm-play />
      <Segmented
        ariaLabel={t('farm.stepBy')}
        size="sm"
        className="shrink-0"
        value={step}
        onValueChange={onStep}
        options={[
          { value: 'month', label: t('farm.step.month') },
          { value: 'quarter', label: t('farm.step.quarter') },
        ]}
      />
      <ol className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" data-farm-steps>
        {periods.map((p, i) => {
          const on = idx === i;
          const done = idx == null || i < idx;
          const newYear = i > 0 && p.to.slice(0, 4) !== periods[i - 1].to.slice(0, 4);
          const l = land?.[i];
          const what = !l ? null : l.bare ? t('farm.land.bare') : l.harvested != null ? t('farm.land.harvest', { crop: l.name ?? '' }) : l.name;
          return (
            <li key={p.id} className={cn('flex min-w-9 flex-1', newYear && 'ml-1 border-l border-line-2 pl-1')}>
              <button
                type="button"
                aria-current={on ? 'step' : undefined}
                aria-label={[periodLabel(p, lang, true), what].filter(Boolean).join(': ')}
                title={what ?? undefined}
                onClick={() => onPick(i)}
                className={cn('group flex w-full flex-col items-center gap-1 rounded-sm px-1 pt-1.5 pb-1 text-xs transition-colors', on ? 'bg-surface-0 font-semibold text-ink-1 shadow-sm' : 'text-ink-2 hover:bg-surface-2')}
              >
                {l && (
                  <span className={cn('farm-land flex h-[30px] items-end justify-center', l.bare && 'opacity-70')} data-farm-land={l.bare ? 'bare' : l.harvested != null ? 'harvest' : 'crop'}>
                    <FieldChip look={l.look} growth={l.growth} ripeness={l.ripeness} cut={l.harvested != null && l.harvested >= 0.5} />
                  </span>
                )}
                <span className="whitespace-nowrap">{periodLabel(p, lang)}</span>
                <span className="relative h-1 w-full overflow-hidden rounded-full bg-line-2">
                  {on ? (
                    <span key={`${p.id}-${playing}`} className={cn('absolute inset-0 rounded-full bg-signal', playing && 'farm-hold')} style={{ '--farm-hold-ms': `${holdMs}ms` } as React.CSSProperties} />
                  ) : (
                    done && <span className="absolute inset-0 rounded-full bg-signal/45" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
        <li className="ml-1 flex shrink-0 border-l border-line-2 pl-1">
          <button
            type="button"
            aria-current={idx == null ? 'step' : undefined}
            onClick={() => onPick(null)}
            className={cn('flex items-center gap-1.5 rounded-sm px-2.5 text-xs whitespace-nowrap transition-colors', idx == null ? 'bg-signal font-semibold text-on-signal' : 'text-ink-1 hover:bg-surface-2')}
            data-farm-today
          >
            <span aria-hidden className={cn('size-1.5 rounded-full', idx == null ? 'bg-on-signal' : 'bg-signal')} />
            {t('farm.today')}
          </button>
        </li>
      </ol>
      {trailing}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Rotation
// ------------------------------------------------------------------------------------------------

export interface RotationPickerProps {
  rotations: RotationStrategy[];
  current: RotationStrategy | null;
  bestId: string | null;
  selected: RotationStrategy;
  open: boolean;
  onOpen: (open: boolean) => void;
  onSelect: (id: string) => void;
}

/** Crop ids of a strategy, each once, in season order. */
const cropsOf = (r: RotationStrategy): string[] => [...new Set(r.seasons.map((s) => s.cropId))];

export function RotationPicker({ rotations, current, bestId, selected, open, onOpen, onSelect }: RotationPickerProps) {
  const t = useT();
  const lang = useLang();
  const names = [...new Set(selected.seasons.map((s) => cropNameOnly(pick(s.label, lang))))].join(' · ');
  return (
    <div className="relative" data-farm-rotation>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="farm-rotation-tray"
        onClick={() => onOpen(!open)}
        className="farm-plate flex w-full max-w-[26rem] items-center gap-3 rounded-md py-2 pr-2.5 pl-3 text-left transition-colors hover:bg-surface-0"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            <Sprout size={13} strokeWidth={2} aria-hidden />
            {t('farm.rotation')}
            {selected.id === bestId && <span className="rounded-xs bg-signal/15 px-1 py-px text-[10px] font-semibold text-signal-strong">{t('farm.rotation.best')}</span>}
          </span>
          <span className="truncate text-sm font-semibold text-ink-1">{pick(selected.name, lang)}</span>
          <span className="truncate text-xs text-ink-2">{names}</span>
        </span>
        <span className="flex shrink-0 items-end" aria-hidden>
          {cropsOf(selected)
            .slice(0, 4)
            .map((id) => (
              <PlantIcon key={id} look={id === 'fallow' ? 'none' : cropLook(getCrop(id))} size={30} />
            ))}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="t-value text-lg leading-5 text-ink-1">{Math.round(selected.score)}</span>
          <span className="text-[10px] text-ink-3">/100</span>
        </span>
        <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          {/* A press anywhere else closes the tray. */}
          <button type="button" aria-label={t('farm.rotation.close')} className="fixed inset-0 z-10 cursor-default" onClick={() => onOpen(false)} />
          <div id="farm-rotation-tray" className="farm-plate farm-pop absolute top-full left-0 z-20 mt-2 flex w-[min(60rem,calc(100vw-var(--rail-w,0px)-1.5rem))] flex-col gap-1 rounded-md p-2.5" style={{ '--farm-pop-origin': '0 0' } as React.CSSProperties}>
            <p className="t-caption px-1">{t('farm.rotation.hint', { n: rotations.length })}</p>
            <StrategyCards
              rotations={rotations}
              current={current}
              bestId={bestId}
              selectedId={selected.id}
              onSelect={(id) => {
                onSelect(id);
                onOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// A character and its note
// ------------------------------------------------------------------------------------------------

export interface MascotSpotProps {
  who: FarmVoice;
  note: FarmNote;
  open: boolean;
  onToggle: () => void;
  clip?: MascotClip;
  beat: number;
  /** Where the character looks, from the stage director; null to follow the pointer. */
  look?: { x: number; y: number } | null;
  /** Order of the entrance, so the three come on one after the other. */
  order?: number;
  /** Motion off: the character stays at rest. */
  reduced?: boolean;
  className?: string;
}

export function MascotSpot({ who, note, open, onToggle, clip, beat, look = null, order = 0, reduced, className }: MascotSpotProps) {
  const t = useT();
  const lang = useLang();
  const flying = who === 'space';
  return (
    <div className={cn('farm-mascot-enter absolute flex flex-col items-center', className)} style={{ '--farm-enter-delay': `${150 + order * 220}ms` } as React.CSSProperties} data-farm-mascot={who} data-farm-speaking={open || undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('farm.ask', { name: t(`farm.name.${who}`), role: t(`farm.role.${who}`) })}
        title={open ? undefined : pick(note.headline, lang)}
        onClick={onToggle}
        className="group relative flex flex-col items-center rounded-lg outline-offset-4"
      >
        {/* The three dots: something to say, waiting to be pressed. Amber, with a mark, when it needs a look. */}
        <span
          aria-hidden
          className={cn(
            'farm-bubble farm-plate relative -mb-1 flex h-8 items-center rounded-full px-3 transition-opacity',
            note.alert ? 'text-watch' : 'text-ink-2',
            open && 'opacity-0',
          )}
        >
          <span className="farm-dots">
            <i />
            <i />
            <i />
          </span>
          {note.alert && <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-watch text-[10px] font-bold text-surface-0">!</span>}
          <span className="absolute top-full left-1/2 size-2 -translate-x-1/2 -translate-y-1 rotate-45 border-r border-b border-line-2/70 bg-surface-0/90" />
        </span>
        {/* The figure floats over a soft shadow on the ground (the Satellite's falls far below: none); it lifts on hover. */}
        <span className="relative block">
          {!flying && <span aria-hidden className="farm-ground-shadow" />}
          <span className={cn('block', flying ? 'farm-hover-fly' : 'farm-hover-stand')}>
            <span className="farm-lift block">
              <Mascot who={MASCOT_OF[who]} clip={clip} beat={beat} look={look} reduced={reduced} className="h-[8.5rem] w-28 md:h-[11.5rem] md:w-[9.25rem]" fallback={<MascotFigure who={who} mood={note.mood} />} />
            </span>
          </span>
        </span>
        <span className="farm-plate -mt-2 rounded-full px-2.5 py-0.5 text-xs font-medium text-ink-1">
          {t(`farm.name.${who}`)} <span className="font-normal text-ink-3">· {t(`farm.role.${who}`)}</span>
        </span>
      </button>
    </div>
  );
}

export interface NoteCardProps {
  who: FarmVoice;
  note: FarmNote;
  /** Trials this character can propose; empty for the weather. */
  options: FarmOption[];
  optionsLoading: boolean;
  trial: FarmTrial | null;
  baseOutcome: number;
  onTrial: (id: string | null) => void;
  onAdopt: (cropId: string) => void;
  onDeep: () => void;
  onClose: () => void;
  className?: string;
}

export function NoteCard({ who, note, options, optionsLoading, trial, baseOutcome, onTrial, onAdopt, onDeep, onClose, className }: NoteCardProps) {
  const t = useT();
  const lang = useLang();
  const mine = trial && trial.option.by === who ? trial : null;
  return (
    <section aria-live="polite" aria-label={t(`farm.name.${who}`)} className={cn('farm-plate farm-pop absolute z-20 flex w-[min(21rem,calc(100%-1.5rem))] flex-col gap-2.5 rounded-lg p-3.5', className)} data-farm-note={who}>
      <header className="flex items-center gap-2">
        <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">
          {t(`farm.name.${who}`)} · {t(`farm.role.${who}`)}
        </span>
        <IconButton label={t('farm.note.close')} icon={<X />} size="sm" className="-my-1 -mr-1.5 ml-auto" onClick={onClose} />
      </header>
      <p className={cn('text-lg leading-6 font-semibold text-balance', note.alert ? 'text-watch' : 'text-ink-1')} data-farm-headline>
        {pick(note.headline, lang)}
      </p>
      {note.points.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-ink-1">
          {note.points.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />
              {pick(p, lang)}
            </li>
          ))}
        </ul>
      )}

      {mine ? (
        <div className="flex flex-col gap-2 rounded-sm border border-signal/60 bg-signal/8 p-2.5" data-farm-trial={mine.option.kind}>
          <p className="text-sm font-medium text-ink-1">
            {t('farm.trial.of', { label: pick(mine.option.label, lang) })}
            <span className="t-value ml-1.5 text-signal-strong">
              {baseOutcome} → {seasonOutcome(mine.score)}
            </span>
          </p>
          <p className="t-caption">{pick(mine.option.caveat, lang)}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" icon={<Undo2 />} onClick={() => onTrial(null)}>
              {t('farm.trial.back')}
            </Button>
            {mine.option.kind === 'crop' && mine.option.change.cropId && (
              <Button size="sm" variant="primary" onClick={() => onAdopt(mine.option.change.cropId!)}>
                {t('farm.trial.adopt')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        who !== 'space' &&
        (optionsLoading ? (
          <p className="t-caption">{t('farm.try.loading')}</p>
        ) : (
          options.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-3">{t('farm.try')}</span>
              <div className="flex flex-wrap gap-1.5">
                {options.slice(0, 2).map((o) => (
                  <Button key={o.id} size="sm" variant="secondary" onClick={() => onTrial(o.id)} data-farm-option={o.kind}>
                    {pick(o.label, lang)}
                    <OptionFigure o={o} />
                  </Button>
                ))}
              </div>
            </div>
          )
        ))
      )}

      {/* The "!" opens the measurements behind the verdict. */}
      <button type="button" onClick={onDeep} className="-mx-1 -mb-1 flex items-center gap-2 rounded-sm px-1 py-1 text-left text-sm font-medium text-signal-strong hover:bg-surface-2" data-farm-deep-open>
        <CircleAlert size={16} strokeWidth={2.2} aria-hidden />
        {t('farm.note.deep')}
      </button>
    </section>
  );
}

/** The two ways down from the stage: the analysis under it, and the dossier at the end. */
/** What an option does to the field, in one short figure: a gain in green, a trade-off in a neutral tag with its cost. */
export function OptionFigure({ o, full = false }: { o: FarmOption; full?: boolean }) {
  const t = useT();
  const title = [
    t('farm.option.season', { a: o.before, b: o.after }),
    t('farm.option.growth', { a: o.growthBefore, b: o.growthAfter }),
    o.monthsAfter !== o.monthsBefore ? t('farm.option.months', { a: o.monthsBefore, b: o.monthsAfter }) : null,
  ].filter(Boolean).join(' · ');
  if (o.tradeOff) {
    return (
      <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-ink-2" title={title} data-farm-tradeoff>
        <span className="rounded-xs bg-surface-2 px-1 py-px font-medium">{t('farm.option.tradeOff')}</span>
        <span className="t-value">{full ? title : o.monthsAfter < o.monthsBefore - 2 ? t('farm.option.monthsShort', { b: o.monthsAfter }) : `${o.before} → ${o.after}`}</span>
      </span>
    );
  }
  return (
    <span className="t-value ml-1.5 text-signal-strong" title={title}>
      {o.delta > 0 ? `+${o.delta}` : t('farm.option.growthShort', { n: o.growthDelta })}
    </span>
  );
}

export function StageLinks({ onDossier, reduced, onMotion }: { onDossier: () => void; reduced?: boolean; onMotion?: () => void }) {
  const t = useT();
  return (
    <>
    {onMotion && (
      <IconButton label={t(reduced ? 'farm.motion.on' : 'farm.motion.off')} icon={<Sparkles />} pressed={!reduced} size="sm" variant="secondary" className="shrink-0" onClick={onMotion} data-farm-motion />
    )}
    <Button size="sm" variant="secondary" icon={<FileText />} className="shrink-0" onClick={onDossier} data-farm-dossier-open>
      <span className="narrow:sr-only">{t('farm.dossier.open')}</span>
    </Button>
    </>
  );
}
