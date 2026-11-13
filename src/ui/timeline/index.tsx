/**
 * State 4: the Master Timeline Scrubber. One cursor drives the parcel colour, the eight callouts
 * and the hub. Playback runs on requestAnimationFrame and writes the cursor only when the day
 * changes, so the instruments move at display rate without React work in between.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { BRANCHES, type ISODate, type Insight, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { insightsNear, primarySeries, scoreAt } from '@/lib/series';
import { addDays, diffDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { AnomalyMarker, IconButton, Segmented, Slider, type SliderMarker, type SliderRange, type SliderTick, useHudDensity } from '@/ui/design';
import { useMissionUi } from '@/ui/chrome/uiState';
import { MONTHS, fmtDate } from '@/ui/hud/format';
import './strings';

/** Days the cursor travels per second at 1×: a year in about 15 s. */
const DAYS_PER_SECOND = 24;
const STEP_DAYS = 7;

/** Earliest "latest observation" among the time-varying branches: after it, something is still unpublished. */
function pendingFrom(s: ReturnType<typeof useMission.getState>): ISODate | null {
  const tel = s.telemetry;
  if (!tel) return null;
  let earliest: ISODate | null = null;
  for (const b of BRANCHES) {
    if (b === 'risk' || b === 'terrain' || b === 'soil') continue;
    const series = primarySeries(tel.branches[b]);
    if (!series || series.cadence === 'static') continue;
    let last: ISODate | null = null;
    for (let i = series.samples.length - 1; i >= 0; i--) {
      if (series.samples[i].v != null) {
        last = series.samples[i].t;
        break;
      }
    }
    if (last && (!earliest || last < earliest)) earliest = last;
  }
  return earliest && earliest < tel.window.today ? earliest : null;
}

function usePlayback() {
  const playing = useMissionUi((s) => s.playing);
  const speed = useMissionUi((s) => s.speed);
  const setPlaying = useMissionUi((s) => s.setPlaying);

  useEffect(() => {
    if (!playing) return;
    const store = useMission.getState();
    // The store's own interval playback must not run alongside this one.
    store.pause();
    if (store.timeline.cursor >= store.timeline.end) store.setCursor(store.timeline.start);
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      carry += ((now - last) / 1000) * DAYS_PER_SECOND * speed;
      last = now;
      if (carry >= 1) {
        const days = Math.floor(carry);
        carry -= days;
        const { timeline, setCursor } = useMission.getState();
        const next = addDays(timeline.cursor, days);
        if (next >= timeline.end) {
          setCursor(timeline.end);
          setPlaying(false);
          return;
        }
        setCursor(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, setPlaying]);

  // Leaving the locked state stops playback.
  useEffect(() => () => setPlaying(false), [setPlaying]);
}

/** Productivity along the whole window, drawn behind the Anomaly Markers. Memoised: it never moves. */
function ScoreTrack({ max }: { max: number }) {
  const score = useMission((s) => s.score);
  const start = useMission((s) => s.timeline.start);
  const d = useMemo(() => {
    if (!score?.snapshots.length || max <= 0) return null;
    const pts = score.snapshots.map((s) => `${((diffDays(s.t, start) / max) * 1000).toFixed(1)},${(17 - (s.productivity / 100) * 16).toFixed(1)}`);
    return { line: `M${pts.join('L')}`, area: `M${pts[0].split(',')[0]},18L${pts.join('L')}L${pts[pts.length - 1].split(',')[0]},18Z` };
  }, [score, start, max]);
  if (!d) return null;
  return (
    <svg aria-hidden viewBox="0 0 1000 18" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 h-[18px] w-full">
      <path d={d.area} fill="var(--color-ink-4)" fillOpacity={0.18} />
      <path d={d.line} fill="none" stroke="var(--color-ink-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const SEV_RANK = { alert: 0, watch: 1, info: 2 } as const;

/** What changed on the field near the cursor and why it matters, said calmly when nothing did. */
function Commentary() {
  const t = useT();
  const lang = useLang();
  const cursor = useMission((s) => s.timeline.cursor);
  const insights = useMission((s) => s.insights);
  const score = useMission((s) => s.score);
  const near: Insight[] = useMemo(() => insightsNear(insights, cursor).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || Math.abs(diffDays(a.t, cursor)) - Math.abs(diffDays(b.t, cursor))), [insights, cursor]);

  if (near.length) {
    const top = near[0];
    return (
      <>
        <AnomalyMarker severity={top.severity} className="shrink-0" />
        <span className="min-w-0 truncate text-ink-1">{pick(top.text, lang)}</span>
        {near.length > 1 && <span className="t-meta shrink-0">{t('tl.more', { n: near.length - 1 })}</span>}
      </>
    );
  }
  const now = scoreAt(score, cursor);
  const then = scoreAt(score, addDays(cursor, -30));
  let trend = '';
  if (now && then && then.t < now.t) {
    const d = now.productivity - then.productivity;
    trend = Math.abs(d) < 3 ? t('tl.scoreFlat', { v: now.productivity }) : t(d > 0 ? 'tl.scoreUp' : 'tl.scoreDown', { v: now.productivity, d: Math.abs(d), date: fmtDate(then.t, lang, false) });
  }
  return (
    <span className="min-w-0 truncate text-ink-3">
      {t('tl.quiet')} {trend && <span className="text-ink-2">{trend}</span>}
    </span>
  );
}

function Keys() {
  const t = useT();
  return (
    <span className="t-meta hidden shrink-0 items-center gap-3 font-sans xl:flex" aria-hidden>
      <span className="flex items-center gap-1">
        <span className="hatch-pending inline-block h-2.5 w-3 border-x border-stale/60" />
        {t('tl.keyPending')}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-[3px] w-3 bg-[repeating-linear-gradient(90deg,var(--color-ink-3)_0_3px,transparent_3px_6px)]" />
        {t('tl.keyForecast')}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-3 border-t border-ink-3 bg-ink-4/20" />
        {t('tl.keyScore')}
      </span>
    </span>
  );
}

export function TimelineScrubber() {
  const t = useT();
  const lang = useLang();
  const density = useHudDensity();
  const start = useMission((s) => s.timeline.start);
  const end = useMission((s) => s.timeline.end);
  const cursor = useMission((s) => s.timeline.cursor);
  const forecastEnd = useMission((s) => s.telemetry?.window.forecastEnd ?? null);
  const today = useMission((s) => s.telemetry?.window.today ?? s.timeline.end);
  const pending = useMission(pendingFrom);
  const insights = useMission((s) => s.insights);
  const riskEvents = useMission((s) => s.telemetry?.branches.risk.events);
  const setCursor = useMission((s) => s.setCursor);
  const playing = useMissionUi((s) => s.playing);
  const speed = useMissionUi((s) => s.speed);
  const setPlaying = useMissionUi((s) => s.setPlaying);
  const setSpeed = useMissionUi((s) => s.setSpeed);
  const setScrubbing = useMissionUi((s) => s.setScrubbing);
  const rootRef = useRef<HTMLDivElement | null>(null);
  usePlayback();

  const last = forecastEnd && forecastEnd > end ? forecastEnd : end;
  const max = Math.max(1, diffDays(last, start));
  const todayIdx = diffDays(today, start);
  const value = diffDays(cursor, start);

  const ticks = useMemo<SliderTick[]>(() => {
    const out: SliderTick[] = [];
    for (let d = 0; d <= max; d++) {
      const date = addDays(start, d);
      if (!date.endsWith('-01')) continue;
      const m = Number(date.slice(5, 7));
      const labelled = density !== 'stacked' || (m - 1) % 3 === 0;
      out.push({ value: d, major: m === 1, label: labelled ? (m === 1 ? `${MONTHS[lang][0]} ${date.slice(0, 4)}` : MONTHS[lang][m - 1]) : undefined });
    }
    return out;
  }, [start, max, lang, density]);

  const markers = useMemo<SliderMarker[]>(() => {
    const out: SliderMarker[] = insights.map((i) => ({ value: diffDays(i.t, start), severity: i.severity, label: `${fmtDate(i.t, lang)}: ${pick(i.text, lang)}` }));
    for (const e of riskEvents ?? []) if (e.severity > 0) out.push({ value: diffDays(e.start, start), severity: e.severity >= 2 ? 'alert' : 'watch', label: `${fmtDate(e.start, lang)}: ${pick(e.title, lang)}` });
    return out.filter((m) => m.value >= 0 && m.value <= max);
  }, [insights, riskEvents, start, max, lang]);

  const ranges = useMemo<SliderRange[]>(() => {
    const out: SliderRange[] = [];
    if (pending) out.push({ from: diffDays(pending, start), to: todayIdx, kind: 'pending' });
    if (max > todayIdx) out.push({ from: todayIdx, to: max, kind: 'forecast' });
    return out;
  }, [pending, start, todayIdx, max]);

  const step = (days: number) => {
    setPlaying(false);
    setCursor(addDays(useMission.getState().timeline.cursor, days));
  };

  // Space plays, arrows step, from anywhere on the screen that is not a text field or another control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, [role="slider"], [role="listbox"], [role="combobox"], [role="dialog"], [role="radiogroup"], [role="tablist"]') || el.isContentEditable)) return;
      if (e.key === ' ' && !(el instanceof HTMLButtonElement)) {
        e.preventDefault();
        setPlaying(!useMissionUi.getState().playing);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const n = e.shiftKey ? 30 : STEP_DAYS;
        step(e.key === 'ArrowLeft' ? -n : n);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // step only reads the store; it is stable in behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPlaying]);

  const rel = diffDays(cursor, today);
  const stacked = density === 'stacked';

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={t('tl.timeline')}
      className="absolute inset-x-0 bottom-0 z-(--z-dock) grid h-(--timeline-h) items-center gap-x-5 border-t border-line-1 bg-surface-1/94 px-(--panel-pad) shadow-md lg:grid-cols-[auto_minmax(0,1fr)] stacked:h-auto stacked:min-h-(--timeline-h) stacked:gap-y-1 stacked:py-2"
    >
      <div className="flex items-center gap-2">
        <IconButton label={playing ? t('tl.pause') : t('tl.play')} icon={playing ? <Pause /> : <Play />} variant="primary" size={stacked ? 'lg' : 'md'} onClick={() => setPlaying(!playing)} />
        <IconButton label={t('tl.back')} icon={<ChevronLeft />} size={stacked ? 'lg' : 'sm'} onClick={() => step(-STEP_DAYS)} />
        <IconButton label={t('tl.forward')} icon={<ChevronRight />} size={stacked ? 'lg' : 'sm'} onClick={() => step(STEP_DAYS)} />
        <div className="ml-1 flex w-40 flex-col">
          <span className="t-value text-xl leading-6 text-ink-1">{fmtDate(cursor, lang)}</span>
          <span className="t-meta">{rel === 0 ? t('tl.today') : rel < 0 ? t('tl.ago', { n: -rel }) : t('tl.ahead', { n: rel })}</span>
        </div>
        <Segmented
          ariaLabel={t('tl.speed')}
          size="sm"
          value={String(speed)}
          onValueChange={(v) => setSpeed(Number(v) as 1 | 2 | 4)}
          options={[
            { value: '1', label: '1×' },
            { value: '2', label: '2×' },
            { value: '4', label: '4×' },
          ]}
        />
      </div>
      <div className="flex min-w-0 flex-col">
        <p className="flex h-5 min-w-0 items-center gap-2 text-sm" aria-live="polite">
          <Commentary />
          <span className="ml-auto pl-3">
            <Keys />
          </span>
        </p>
        <div
          className="relative"
          onPointerDown={() => {
            setPlaying(false);
            setScrubbing(true);
          }}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
        >
          <ScoreTrack max={max} />
          {/* Without markers the slider drops its top row; keep the row so the curve has its place. */}
          {markers.length === 0 && <div className="h-[18px]" aria-hidden />}
          <Slider
            ariaLabel={t('tl.timeline')}
            size="lg"
            value={value}
            onValueChange={(v) => setCursor(addDays(start, Math.min(v, todayIdx)))}
            min={0}
            max={max}
            step={1}
            formatValue={(v) => fmtDate(addDays(start, v), lang)}
            ticks={ticks}
            markers={markers}
            ranges={ranges}
          />
        </div>
      </div>
    </div>
  );
}
