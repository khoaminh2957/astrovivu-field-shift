/**
 * The living farm (docs/FARM.md): the field drawn as a farm for the date shown, three characters
 * who each report their part (weather, ground, crop), trials the grower can run from what the
 * characters propose, and the weather now and ahead. All of it comes from `src/core/farm`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Undo2 } from 'lucide-react';
import { type ISODate, pick } from '@/contracts';
import { type FarmOption, type FarmVoice, type FarmWeather, type SkyKind, farmLines, farmOptions, farmSceneAt, forecastDays, runTrial, seasonOutcome } from '@/core/farm';
import { useLang, useT } from '@/i18n';
import { addDays, diffDays } from '@/lib/time';
import { toModelInput, useMission } from '@/state/mission';
import { useMissionUi } from '@/ui/chrome/uiState';
import { Button, IconButton, Slider, cn } from '@/ui/design';
import { fmtDate, fmtNum } from '@/ui/hud/format';
import '@/ui/timeline/strings';
import { FarmSceneView } from './FarmScene';
import { MascotFigure } from './Mascots';
import './strings';

const VOICES: FarmVoice[] = ['space', 'soil', 'rice'];
/** Seconds each character speaks before the next takes over, while the reader has not picked one. */
const TURN_S = 8;

/** A small drawing of the day's sky for the forecast strip. */
function SkyIcon({ kind }: { kind: SkyKind }) {
  const cloud = <path d="M 6 16 a 4 4 0 0 1 1 -7.8 a 5 5 0 0 1 9.4 1 a 3.4 3.4 0 0 1 0.6 6.8 Z" fill={kind === 'heavy-rain' ? '#8d99a8' : '#c3ccd6'} />;
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden>
      {(kind === 'clear' || kind === 'hot' || kind === 'frost') && <circle cx={12} cy={11} r={5.5} fill={kind === 'hot' ? '#ffb02e' : kind === 'frost' ? '#bfe0ff' : '#ffd24a'} />}
      {kind === 'hot' && <path d="M 12 2 v 2.4 M 12 17.6 V 20 M 3 11 h 2.4 M 18.6 11 H 21 M 5.6 4.6 l 1.7 1.7 M 16.7 15.7 l 1.7 1.7 M 5.6 17.4 l 1.7 -1.7 M 16.7 6.3 l 1.7 -1.7" stroke="#ffb02e" strokeWidth={1.6} strokeLinecap="round" />}
      {kind === 'frost' && <path d="M 12 3 v 16 M 5 7 l 14 8 M 19 7 l -14 8" stroke="#7fb8ee" strokeWidth={1.4} strokeLinecap="round" />}
      {(kind === 'cloudy' || kind === 'rain' || kind === 'heavy-rain' || kind === 'unknown') && cloud}
      {kind === 'rain' && <path d="M 9 18 l -1 3 M 14 18 l -1 3" stroke="#5aa9e6" strokeWidth={1.6} strokeLinecap="round" />}
      {kind === 'heavy-rain' && <path d="M 7 18 l -1.2 3.4 M 11.5 18 l -1.2 3.4 M 16 18 l -1.2 3.4" stroke="#3f8fd0" strokeWidth={1.8} strokeLinecap="round" />}
    </svg>
  );
}

/** The score through the year, as it is and in the trial, with the date shown. */
function TrialChart({ base, trial, cursor, label }: { base: { t: ISODate; v: number }[]; trial: { t: ISODate; v: number }[]; cursor: ISODate; label: string }) {
  const t = useT();
  if (base.length < 2) return null;
  const W = 520;
  const H = 72;
  const start = base[0].t;
  const span = Math.max(1, diffDays(base.at(-1)!.t, start));
  const x = (d: ISODate) => (diffDays(d, start) / span) * W;
  const y = (v: number) => H - 4 - (v / 100) * (H - 8);
  const line = (pts: { t: ISODate; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  return (
    <figure className="flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[72px] w-full" role="img" aria-label={label} preserveAspectRatio="none">
        <line x1={0} y1={y(50)} x2={W} y2={y(50)} stroke="var(--color-line-1)" strokeDasharray="3 4" />
        <path d={line(base)} fill="none" stroke="var(--color-ink-3)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <path d={line(trial)} fill="none" stroke="var(--color-signal)" strokeWidth={2.2} vectorEffect="non-scaling-stroke" />
        <line x1={x(cursor)} y1={0} x2={x(cursor)} y2={H} stroke="var(--color-ink-1)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex items-center gap-4 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-ink-3" />
          {t('farm.trial.now')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-signal" />
          {t('farm.trial.then')}
        </span>
      </figcaption>
    </figure>
  );
}

function Cond({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-line-1 px-3 py-2.5">
      <span className="truncate text-xs text-ink-3">{label}</span>
      <span className="t-value truncate text-lg leading-6 text-ink-1">{value}</span>
      {note && <span className="t-caption line-clamp-2">{note}</span>}
    </div>
  );
}

export function FarmTab() {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const telemetry = useMission((s) => s.telemetry);
  const cropId = useMission((s) => s.cropId);
  const groundTruth = useMission((s) => s.groundTruth);
  const priorities = useMission((s) => s.priorities);
  const countryTable = useMission((s) => s.countryTable);
  const score = useMission((s) => s.score);
  const start = useMission((s) => s.timeline.start);
  const end = useMission((s) => s.timeline.end);
  const cursor = useMission((s) => s.timeline.cursor);
  const setCursor = useMission((s) => s.setCursor);
  const setCrop = useMission((s) => s.setCrop);
  const playing = useMissionUi((s) => s.playing);
  const setPlaying = useMissionUi((s) => s.setPlaying);

  const input = useMemo(() => toModelInput({ parcel, telemetry, cropId, groundTruth, priorities, countryTable }), [parcel, telemetry, cropId, groundTruth, priorities, countryTable]);

  const [picked, setPicked] = useState<FarmVoice | null>(null);
  const [turn, setTurn] = useState(0);
  const [trialId, setTrialId] = useState<string | null>(null);
  const [weatherDay, setWeatherDay] = useState<ISODate | null>(null);
  const [options, setOptions] = useState<FarmOption[] | null>(null);

  // Another field: nobody is picked, no trial runs, the sky is the day's own.
  const parcelId = parcel?.id;
  useEffect(() => {
    setPicked(null);
    setTrialId(null);
    setWeatherDay(null);
  }, [parcelId]);

  // The characters take turns until the reader picks one. No turns for readers who asked for less motion.
  useEffect(() => {
    if (picked || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const id = setInterval(() => setTurn((n) => n + 1), TURN_S * 1000);
    return () => clearInterval(id);
  }, [picked]);

  // The proposals re-score the year several times: worked out after the scene is on screen.
  useEffect(() => {
    if (!input || !score) return;
    const id = setTimeout(() => setOptions(farmOptions(input, score)), 250);
    return () => clearTimeout(id);
  }, [input, score]);

  const trial = useMemo(() => {
    const option = options?.find((o) => o.id === trialId);
    return option && input ? runTrial(input, option) : null;
  }, [options, trialId, input]);

  const shownInput = trial?.input ?? input;
  const shownScore = trial?.score ?? score;
  const scene = useMemo(() => (shownInput && shownScore ? farmSceneAt(shownInput, shownScore, cursor, weatherDay ?? cursor) : null), [shownInput, shownScore, cursor, weatherDay]);
  const lines = useMemo(() => (shownInput && scene ? farmLines(shownInput, scene) : null), [shownInput, scene]);
  const days = useMemo(() => (telemetry ? forecastDays(telemetry) : []), [telemetry]);

  if (!input || !score || !scene || !lines || !telemetry) {
    return <div aria-busy aria-label={t('farm.loading')} className="skeleton aspect-[560/330] w-full rounded-md" />;
  }

  const speaker = picked ?? VOICES[turn % VOICES.length];
  const line = lines[speaker];
  const today = telemetry.window.today;
  const w = scene.weather;
  const skyWord = t(`farm.sky.${w.kind}`);
  const sourceNames = (ids: string[]) => [...new Set(ids.map((id) => telemetry.sources[id]?.name ?? id))].join(', ');
  const names = { space: t('farm.speak.space'), soil: t('farm.speak.soil'), rice: t('farm.speak.rice') } satisfies Record<FarmVoice, string>;
  const mine = (options ?? []).filter((o) => o.by === speaker).slice(0, 3);
  const baseOutcome = seasonOutcome(score);
  const forecastSource = days.find((d) => d.forecast)?.sourceIds[0];
  const risks = (telemetry.branches.risk.events ?? []).filter((e) => e.severity > 0 && e.end >= today).sort((a, b) => a.start.localeCompare(b.start));

  const showDay = (d: FarmWeather) => {
    setPlaying(false);
    setCursor(today);
    setWeatherDay(d.t === today ? null : d.t);
  };
  const scrub = (v: number) => {
    setWeatherDay(null);
    setCursor(addDays(start, v));
  };

  return (
    <div className="flex flex-col gap-4" data-farm-tab>
      <div className="relative overflow-hidden rounded-md border border-line-1">
        <FarmSceneView scene={scene} lines={lines} speaker={speaker} onSpeak={(who) => setPicked(picked === who ? null : who)} title={t('farm.title', { d: fmtDate(w.t, lang), sky: skyWord })} names={names} />
        {/* The day in figures, over the sky. White plates keep the text readable under every sky. */}
        <div className="pointer-events-none absolute top-2 left-2 flex flex-col items-start gap-1 rounded-sm bg-white/80 px-2.5 py-1.5 text-[#17231c] backdrop-blur-sm">
          <span className="flex items-center gap-1.5 text-xs">
            {fmtDate(w.t, lang)}
            {w.forecast && <span className="rounded-xs bg-[#17231c] px-1 py-px text-[10px] font-medium tracking-wide text-white uppercase">{t('farm.forecast')}</span>}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="t-value text-3xl leading-8" data-farm-temp>
              {w.tMaxC == null ? '--' : `${Math.round(w.tMaxC)}°`}
            </span>
            <span className="text-sm font-medium">{skyWord}</span>
          </span>
        </div>
        <div className="pointer-events-none absolute top-2 right-2 flex flex-col items-end gap-1">
          {scene.score != null && (
            <span className="rounded-sm bg-white/80 px-2.5 py-1.5 text-xs text-[#17231c] backdrop-blur-sm" title={t('farm.scoreOf', { n: scene.score })}>
              {t('farm.score')} <span className="t-value text-base" data-farm-score>{scene.score}</span>
              <span className="text-[#17231c]/60">/100</span>
            </span>
          )}
        </div>
        {trial && (
          <span className="pointer-events-none absolute top-2 left-1/2 max-w-[46%] -translate-x-1/2 truncate rounded-sm bg-signal px-2.5 py-1 text-xs font-medium text-white" data-farm-trial-pill>
            {t('farm.trial')}: {pick(trial.option.label, lang)}
          </span>
        )}
      </div>

      {/* The date: the same cursor as the strip under the map. */}
      <div className="flex items-center gap-3">
        <IconButton label={playing ? t('tl.pause') : t('tl.play')} icon={playing ? <Pause /> : <Play />} variant="primary" size="md" className="shrink-0 rounded-full [&_svg]:size-4 [&_svg]:fill-current" onClick={() => setPlaying(!playing)} />
        <div className="min-w-0 flex-1">
          <Slider ariaLabel={t('farm.scrub')} size="md" value={diffDays(cursor, start)} onValueChange={scrub} min={0} max={Math.max(1, diffDays(end, start))} step={1} formatValue={(v) => fmtDate(addDays(start, v), lang)} />
        </div>
        <span className="t-value w-[5.5rem] shrink-0 text-right text-sm text-ink-1">{fmtDate(cursor, lang)}</span>
      </div>

      {/* The character speaking, its sentence, where the figures come from, and what it would try. */}
      <section aria-live="polite" className="flex flex-col gap-3 rounded-md border border-line-1 bg-surface-1 p-3" data-farm-speaker={speaker}>
        <div role="radiogroup" aria-label={t('farm.pick')} className="flex flex-wrap gap-1.5">
          {VOICES.map((who) => (
            <button
              key={who}
              type="button"
              role="radio"
              aria-checked={speaker === who}
              onClick={() => setPicked(who)}
              className={cn('rounded-full border px-3 py-1 text-sm', speaker === who ? 'border-signal bg-surface-0 font-medium text-ink-1' : 'border-line-1 text-ink-2 hover:bg-surface-2')}
            >
              {t(`farm.name.${who}`)} <span className="text-ink-3">· {t(`farm.role.${who}`)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-start gap-3">
          <svg viewBox="-34 -42 68 70" className="farm-scene shrink-0" style={{ width: 52, height: 54 }} aria-hidden>
            <MascotFigure who={speaker} mood={line.mood} talking={false} />
          </svg>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-base text-ink-1" data-farm-line>
              {pick(line.text, lang)}
            </p>
            {line.sourceIds.length > 0 && <p className="t-caption">{t('farm.source', { s: sourceNames(line.sourceIds) })}</p>}
          </div>
        </div>
        {speaker !== 'space' && (
          <div className="flex flex-col gap-2 border-t border-line-1 pt-3">
            <span className="text-xs font-medium text-ink-2">{t('farm.suggest')}</span>
            {options == null ? (
              <p className="t-caption">{t('farm.suggest.loading')}</p>
            ) : mine.length === 0 ? (
              <p className="t-caption">{t('farm.suggest.none')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {mine.map((o) => (
                  <Button key={o.id} variant={trialId === o.id ? 'primary' : 'secondary'} size="md" aria-pressed={trialId === o.id} onClick={() => setTrialId(trialId === o.id ? null : o.id)} data-farm-option={o.kind}>
                    {pick(o.label, lang)}
                    <span className={cn('t-value ml-1.5', trialId === o.id ? '' : 'text-signal-strong')} title={t('farm.suggest.gainLabel', { n: o.delta })}>
                      {t('farm.suggest.gain', { n: o.delta })}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {trial && (
        <section className="flex flex-col gap-3 rounded-md border border-signal p-3" data-farm-trial={trial.option.kind}>
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-medium text-ink-1">{t('farm.trial.title', { label: pick(trial.option.label, lang) })}</h3>
            <p className="text-sm text-ink-1">
              {t('farm.trial.outcome', { a: baseOutcome, b: seasonOutcome(trial.score) })} <span className="t-value text-signal-strong">({t('farm.suggest.gain', { n: seasonOutcome(trial.score) - baseOutcome })})</span>
            </p>
            <p className="t-caption">{t('farm.trial.same')}</p>
            <p className="t-caption">{pick(trial.option.caveat, lang)}</p>
          </div>
          <TrialChart base={score.snapshots.map((s) => ({ t: s.t, v: s.productivity }))} trial={trial.score.snapshots.map((s) => ({ t: s.t, v: s.productivity }))} cursor={cursor} label={t('farm.trial.chart')} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="md" icon={<Undo2 />} onClick={() => setTrialId(null)}>
              {t('farm.trial.back')}
            </Button>
            {trial.option.kind === 'crop' && trial.option.change.cropId && (
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  setCrop(trial.option.change.cropId ?? null);
                  setTrialId(null);
                }}
              >
                {t('farm.trial.adopt')}
              </Button>
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="farm-cond">
        <h3 id="farm-cond" className="text-lg font-medium text-ink-1">
          {t('farm.cond', { d: fmtDate(w.t, lang) })}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Cond label={t('farm.cond.temp')} value={w.tMaxC != null && w.tMinC != null ? `${fmtNum(w.tMaxC, 0)}° / ${fmtNum(w.tMinC, 0)}°` : '--'} note={w.tMaxC != null ? t('farm.cond.tempNote') : t('farm.cond.none')} />
          <Cond label={t('farm.cond.rain')} value={w.rainMm != null ? `${fmtNum(w.rainMm, 1)} mm` : '--'} note={w.rain7Mm != null ? t('farm.cond.rain7', { n: fmtNum(w.rain7Mm, 0) }) : w.rainMm == null ? t('farm.cond.none') : undefined} />
          <Cond label={t('farm.cond.soil')} value={scene.soil.moisture != null ? `${fmtNum(scene.soil.moisture, 2)} m³/m³` : '--'} note={scene.soil.state ? t(`farm.cond.soil.${scene.soil.state}`) : scene.soil.moisture == null ? t('farm.cond.none') : undefined} />
          <Cond label={t('farm.cond.ndvi')} value={scene.crop.ndvi != null ? fmtNum(scene.crop.ndvi, 2) : '--'} note={scene.crop.ndviDate ? t('farm.cond.ndviOn', { d: fmtDate(scene.crop.ndviDate, lang) }) : t('farm.cond.none')} />
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="farm-weather">
        <h3 id="farm-weather" className="text-lg font-medium text-ink-1">
          {t('farm.weather')}
        </h3>
        {days.length <= 1 ? (
          <p className="t-caption">{t('farm.weather.none')}</p>
        ) : (
          <>
            <p className="t-caption">{t('farm.weather.note', { s: forecastSource ? sourceNames([forecastSource]) : '' })}</p>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" data-farm-forecast>
              {days.map((d) => {
                const on = (weatherDay ?? (cursor === today ? today : null)) === d.t;
                return (
                  <button
                    key={d.t}
                    type="button"
                    aria-pressed={on}
                    aria-label={t('farm.weather.day', { d: fmtDate(d.t, lang, false), sky: t(`farm.sky.${d.kind}`), hi: d.tMaxC == null ? '--' : Math.round(d.tMaxC), lo: d.tMinC == null ? '--' : Math.round(d.tMinC), r: d.rainMm == null ? '--' : fmtNum(d.rainMm, 1) })}
                    onClick={() => showDay(d)}
                    className={cn('flex w-[4.25rem] shrink-0 flex-col items-center gap-0.5 rounded-sm border px-1.5 py-2 text-xs', on ? 'border-signal bg-surface-1' : 'border-line-1 hover:bg-surface-2')}
                  >
                    <span className="text-ink-3">{d.t === today ? t('farm.today') : fmtDate(d.t, lang, false)}</span>
                    <SkyIcon kind={d.kind} />
                    <span className="t-value text-sm text-ink-1">{d.tMaxC == null ? '--' : `${Math.round(d.tMaxC)}°`}</span>
                    <span className="t-value text-ink-3">{d.tMinC == null ? '--' : `${Math.round(d.tMinC)}°`}</span>
                    <span className="t-value text-[var(--color-branch-rainfall)]">{d.rainMm == null ? '--' : fmtNum(d.rainMm, d.rainMm < 10 ? 1 : 0)}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-2">{t('farm.warn')}</span>
              {risks.length === 0 ? (
                <p className="t-caption">{t('farm.warn.none')}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm text-ink-1">
                  {risks.slice(0, 4).map((e) => (
                    <li key={e.id}>
                      <span className="t-value">{fmtDate(e.start, lang, false)}{e.end !== e.start ? ` – ${fmtDate(e.end, lang, false)}` : ''}</span>: {pick(e.title, lang)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
