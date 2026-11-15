/**
 * The farm stage (docs/FARM.md): the first screen of the rotation page. The field is drawn as a
 * farm that fills the screen, for today by default. Over it: where the field is, the rotation
 * being shown (one line that opens into the strategies), the three characters with their bubbles,
 * and a time bar that rewinds a year and steps forward by month or by quarter.
 *
 * Everything shown comes from `src/core/farm`. A strategy other than the current practice is a
 * simulation (the same year of weather, the strategy's crops) and is labelled so.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDown, FlaskConical, MapPin } from 'lucide-react';
import { type AdvisoryReport, type RotationStrategy, pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { type FarmOption, type FarmStep, type FarmVoice, bareRun, farmNotes, farmOptions, farmPeriods, farmSceneAt, farmSceneOfPeriod, runOn, runTrial, seasonOutcome, seasonRuns } from '@/core/farm';
import { useLang, useT } from '@/i18n';
import { toModelInput, useMission } from '@/state/mission';
import { Button, Dialog, cn, usePrefersReducedMotion } from '@/ui/design';
import { fmtDate, fmtNum } from '@/ui/hud/format';
import { DeepSheet } from './DeepSheet';
import { VOICES, frameOf } from './direct';

/** A crop's name in the reader's language. */
const cropLabel = (id: string, lang: string): string => {
  const c = getCrop(id);
  return c ? (lang === 'vi' && c.names.vi ? c.names.vi : c.names.en) : id;
};
import { FarmSceneView, sunOf } from './FarmScene';
import { MascotSpot, NoteCard, RotationPicker, StageLinks, TimeBar, periodLabel } from './StageParts';
import { useStageDirector } from './useStageDirector';
import { useFarmYear } from './year';
import './strings';

/** How long the stage holds on a month or on a quarter during playback. */
const HOLD_MS: Record<FarmStep, number> = { month: 2400, quarter: 3400 };

/** Where each character stands over the scene, and where its note opens beside it. */
const SPOT: Record<FarmVoice, { at: string; note: string }> = {
  space: { at: 'top-[16%] right-[11%] narrow:top-[24%] narrow:right-1', note: 'top-[18%] right-[calc(11%+10.5rem)] narrow:inset-x-3 narrow:top-auto narrow:right-auto narrow:bottom-[5.25rem] narrow:w-auto' },
  soil: { at: 'bottom-[7.25rem] left-[9%] narrow:bottom-[5.5rem] narrow:left-1', note: 'bottom-[9.5rem] left-[calc(9%+10.5rem)] narrow:inset-x-3 narrow:bottom-[5.25rem] narrow:left-auto narrow:w-auto' },
  rice: { at: 'bottom-[7.25rem] right-[10%] narrow:bottom-[5.5rem] narrow:right-1', note: 'bottom-[9.5rem] right-[calc(10%+10.5rem)] narrow:inset-x-3 narrow:bottom-[5.25rem] narrow:right-auto narrow:w-auto' },
};

export interface FarmStageProps {
  /** Ordered as on the page: the current practice first. Empty when the report has no strategy. */
  rotations: RotationStrategy[];
  current: RotationStrategy | null;
  bestId: string | null;
  selected: RotationStrategy | null;
  onSelect: (id: string) => void;
  report: AdvisoryReport | null;
  /** Scrolls to the analysis under the stage, and to the dossier at the end of the page. */
  onAnalysis: () => void;
  onDossier: () => void;
}

export function FarmView({ rotations, current, bestId, selected, onSelect, report, onAnalysis, onDossier }: FarmStageProps) {
  const t = useT();
  const lang = useLang();
  const reduced = usePrefersReducedMotion();
  const parcel = useMission((s) => s.parcel);
  const telemetry = useMission((s) => s.telemetry);
  const cropId = useMission((s) => s.cropId);
  const groundTruth = useMission((s) => s.groundTruth);
  const priorities = useMission((s) => s.priorities);
  const countryTable = useMission((s) => s.countryTable);
  const score = useMission((s) => s.score);
  const setCrop = useMission((s) => s.setCrop);
  const setPhase = useMission((s) => s.setPhase);
  const setCursor = useMission((s) => s.setCursor);

  const input = useMemo(() => toModelInput({ parcel, telemetry, cropId, groundTruth, priorities, countryTable }), [parcel, telemetry, cropId, groundTruth, priorities, countryTable]);

  const [step, setStep] = useState<FarmStep>('month');
  const [idx, setIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState<FarmVoice | null>(null);
  const [deep, setDeep] = useState<FarmVoice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trialId, setTrialId] = useState<string | null>(null);
  const [options, setOptions] = useState<FarmOption[] | null>(null);
  /** A crop the grower asked to adopt from a trial, waiting for their yes: it changes the field everywhere. */
  const [adopting, setAdopting] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);

  const periods = useMemo(() => (telemetry ? farmPeriods(telemetry.window, step) : []), [telemetry, step]);
  const period = idx == null ? null : (periods[idx] ?? null);

  // Another field or another strategy: back to today, nothing open, no trial.
  const parcelId = parcel?.id;
  const strategyId = selected?.id;
  useEffect(() => {
    setIdx(null);
    setPlaying(false);
    setOpen(null);
    setTrialId(null);
  }, [parcelId]);
  useEffect(() => setTrialId(null), [strategyId]);

  // The date of the stage is the date of the whole app: back on the field (step 1) the map, the timeline and the
  // panel stand on the last day of the month or quarter shown here, and on today when the stage shows today.
  const periodEnd = period?.to ?? null;
  const today = telemetry?.window.today ?? null;
  useEffect(() => {
    const day = periodEnd ?? today;
    if (day) setCursor(day);
  }, [periodEnd, today, setCursor]);

  // Playback: rewind to the first period, hold on each, end on today.
  useEffect(() => {
    if (!playing) return;
    if (idx == null) {
      setIdx(0);
      return;
    }
    const id = setTimeout(() => {
      if (idx >= periods.length - 1) {
        setIdx(null);
        setPlaying(false);
      } else setIdx(idx + 1);
    }, HOLD_MS[step]);
    return () => clearTimeout(id);
  }, [playing, idx, periods.length, step]);

  // The proposals re-score the year several times: worked out after the scene is on screen.
  useEffect(() => {
    setOptions(null);
    if (!input || !score) return;
    const id = setTimeout(() => setOptions(farmOptions(input, score)), 300);
    return () => clearTimeout(id);
  }, [input, score]);

  const trial = useMemo(() => {
    const option = options?.find((o) => o.id === trialId);
    return option && input ? runTrial(input, option) : null;
  }, [options, trialId, input]);

  // A strategy other than the current practice is played on the stage with its own crops.
  const runs = useMemo(() => (input && selected && selected.kind !== 'current' ? seasonRuns(input, selected) : null), [input, selected]);
  const bare = useMemo(() => (input && runs ? bareRun(input) : null), [input, runs]);
  const simulated = !!runs && !trial;

  const day = period?.to ?? telemetry?.window.today ?? null;
  const shown = useMemo(() => {
    if (!input || !score || !day) return null;
    if (trial) return { input: trial.input, score: trial.score };
    if (runs) return runOn(runs, day) ?? bare ?? { input, score };
    return { input, score };
  }, [input, score, day, trial, runs, bare]);

  const view = useMemo(() => {
    if (!shown || !day) return null;
    if (period) return farmSceneOfPeriod(shown.input, shown.score, period);
    return { scene: farmSceneAt(shown.input, shown.score, day), summary: null };
  }, [shown, period, day]);
  // The soil plan of the report is for the field's own crop: it is not quoted over a simulated one.
  const notes = useMemo(() => (shown && view ? farmNotes(shown.input, view.scene, { summary: view.summary, report: simulated ? null : report }) : null), [shown, view, simulated, report]);
  const year = useFarmYear(shown?.input ?? null, shown?.score ?? null);
  const frame = useMemo(() => (view && notes ? frameOf(view.scene, notes) : null), [view, notes]);
  const { beats, looks, act } = useStageDirector({ root: stageRef, open, frame, reduced });

  if (!parcel) return null;
  if (!input || !score || !telemetry || !shown || !view || !notes) {
    return <div aria-busy aria-label={t('farm.loading')} className="skeleton h-full min-h-[560px] w-full" />;
  }

  const { scene, summary } = view;
  const w = scene.weather;
  const when = period ? periodLabel(period, lang, true) : `${t('farm.today')}, ${fmtDate(telemetry.window.today, lang)}`;
  const shownCrop = getCrop(shown.input.cropId);
  const cropName = shownCrop ? (lang === 'vi' && shownCrop.names.vi ? shownCrop.names.vi : shownCrop.names.en) : t('farm.bare');
  const place = [parcel.place?.admin1, parcel.place?.country].filter(Boolean).join(', ') || parcel.place?.label || `${fmtNum(parcel.centroid[1], 3)}°, ${fmtNum(parcel.centroid[0], 3)}°`;
  const activeMonthId = period ? (period.step === 'month' ? period.id : period.id.split('_').at(-1)!) : (year.at(-1)?.id ?? null);

  // The speaker's Talk and the others' turn toward it come from the stage director.
  const toggle = (who: FarmVoice) => setOpen(open === who ? null : who);
  const play = () => {
    if (!playing) act('space', 'Scan');
    setPlaying(!playing);
  };
  const pickStep = (i: number | null) => {
    setPlaying(false);
    setIdx(i);
  };
  const startTrial = (id: string | null) => {
    setTrialId(id);
    const by = options?.find((o) => o.id === id)?.by;
    if (by) act(by, 'Jump');
  };

  return (
    <section ref={stageRef} aria-label={t('farm.page')} className="relative h-full min-h-[560px] w-full overflow-hidden bg-[#74a57b]" data-farm-stage data-farm-when={period?.id ?? 'today'}>
      <FarmSceneView scene={scene} beat={`${period?.id ?? 'today'}|${shown.input.cropId ?? 'none'}|${trialId ?? ''}`} title={t('farm.title', { d: when, sky: t(`farm.sky.${w.kind}`) })} className="absolute inset-0 h-full w-full" />
      {/* Daylight breathing over the land, as strong as the sun shows in the sky drawn. Decoration only. */}
      <div aria-hidden className="farm-daylight pointer-events-none absolute inset-0" style={{ '--farm-sun': sunOf(w.kind) } as React.CSSProperties} />
      {/* A little shade under the plates at the top and the bar at the bottom, so the drawing never fights them. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-linear-to-b from-[#0c1f16]/30 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-[#0c1f16]/35 to-transparent" />

      <div className="absolute inset-x-3 top-3 z-30 flex flex-wrap items-start justify-between gap-2 md:inset-x-4 md:top-4">
        <div className="flex min-w-0 flex-col gap-2">
          {/* Which field this is. */}
          <div className="farm-plate flex max-w-[26rem] items-center gap-3 rounded-md py-2 pr-2 pl-3" data-farm-field>
            <MapPin size={18} strokeWidth={2} aria-hidden className="shrink-0 text-signal-strong" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-ink-1">{parcel.name}</span>
              <span className="truncate text-xs text-ink-2">
                {place} · {fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0)} ha · {cropName}
              </span>
            </div>
            <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setPhase('locked')}>
              {t('farm.field.map')}
            </Button>
          </div>
          {selected && <RotationPicker rotations={rotations} current={current} bestId={bestId} selected={selected} open={pickerOpen} onOpen={setPickerOpen} onSelect={onSelect} />}
        </div>

        {/* What the stage shows now: the day or the period, in three figures. */}
        <div className="farm-plate flex flex-col gap-1 rounded-md px-3 py-2" data-farm-when-plate>
          <span className="flex items-center gap-2 text-xs text-ink-2">
            {when}
            {simulated && (
              <span className="rounded-xs bg-ink-1 px-1.5 py-px text-[10px] font-semibold tracking-wide text-surface-0 uppercase" title={t('farm.simulated.hint')}>
                {t('farm.simulated')}
              </span>
            )}
          </span>
          <span className="flex items-baseline gap-2">
            <span className="t-value text-3xl leading-8 text-ink-1" data-farm-temp>
              {w.tMaxC == null ? '--' : `${Math.round(w.tMaxC)}°`}
            </span>
            <span className="text-sm font-medium text-ink-1">{t(`farm.sky.${w.kind}`)}</span>
          </span>
          <span className="flex items-center gap-3 text-xs text-ink-2">
            <span>
              {summary ? t('farm.when.rainTotal') : t('farm.when.rain')} <span className="t-value text-ink-1">{w.rainMm == null ? '--' : `${fmtNum(w.rainMm, summary ? 0 : 1)} mm`}</span>
            </span>
            {scene.score != null && (
              <span title={t('farm.scoreHint')}>
                {t('farm.score')}{' '}
                <span className="t-value text-ink-1" data-farm-score>
                  {scene.score}
                </span>
                /100
              </span>
            )}
          </span>
        </div>
      </div>

      {trial && (
        <div className="farm-plate absolute top-[5.5rem] left-1/2 z-20 flex max-w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-full py-1 pr-1 pl-3 text-sm narrow:top-auto narrow:bottom-[5.25rem]" data-farm-trial-pill>
          <FlaskConical size={15} aria-hidden className="shrink-0 text-signal-strong" />
          <span className="truncate text-ink-1">
            {t('farm.trial')}: {pick(trial.option.label, lang)}
          </span>
          <span className="t-value shrink-0 text-signal-strong">
            {seasonOutcome(score)} → {seasonOutcome(trial.score)}
          </span>
          <Button size="sm" variant="ghost" className="shrink-0 rounded-full" onClick={() => startTrial(null)}>
            {t('farm.trial.end')}
          </Button>
        </div>
      )}

      {VOICES.map((who, k) => (
        <MascotSpot key={who} who={who} note={notes[who]} open={open === who} onToggle={() => toggle(who)} clip={beats[who].clip} beat={beats[who].n} look={looks[who]} order={k} className={cn('z-10', SPOT[who].at)} />
      ))}
      {open && (
        <NoteCard
          key={open}
          who={open}
          note={notes[open]}
          options={simulated ? [] : (options ?? []).filter((o) => o.by === open)}
          optionsLoading={options == null && !simulated}
          trial={trial}
          baseOutcome={seasonOutcome(score)}
          onTrial={startTrial}
          onAdopt={setAdopting}
          onDeep={() => setDeep(open)}
          onClose={() => setOpen(null)}
          className={SPOT[open].note}
        />
      )}

      <div className="absolute inset-x-3 bottom-3 z-30 flex flex-col gap-2 md:inset-x-4 md:bottom-4">
        <TimeBar periods={periods} idx={idx} step={step} playing={playing} holdMs={reduced ? 0 : HOLD_MS[step]} onStep={(s) => { setPlaying(false); setIdx(null); setStep(s); }} onPlay={play} onPick={pickStep} trailing={<StageLinks onDossier={onDossier} />} />
        <button type="button" onClick={onAnalysis} className="mx-auto flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium text-white [text-shadow:0_1px_3px_rgb(8_20_14/0.7)] hover:bg-white/15" data-farm-analysis>
          <ChevronsDown size={14} aria-hidden />
          {t('farm.analysis')}
        </button>
      </div>

      <Dialog
        open={adopting != null}
        onOpenChange={(o) => !o && setAdopting(null)}
        size="sm"
        title={t('farm.adopt.title', { crop: adopting ? cropLabel(adopting, lang) : '' })}
        description={t('farm.adopt.body')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdopting(null)}>
              {t('farm.adopt.keep')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (adopting) setCrop(adopting);
                setAdopting(null);
                setTrialId(null);
              }}
            >
              {t('farm.adopt.go')}
            </Button>
          </>
        }
      />
      <DeepSheet who={deep} onClose={() => setDeep(null)} input={shown.input} score={shown.score} scene={scene} summary={summary} when={when} report={report} options={options} months={year} activeMonthId={activeMonthId} simulated={simulated} />
    </section>
  );
}
