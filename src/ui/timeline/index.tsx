/**
 * State 4: the Master Timeline Scrubber. One cursor drives the parcel colour, the eight callouts
 * and the hub. Playback runs on requestAnimationFrame and writes the cursor only when the day
 * changes, so the instruments move at display rate without React work in between.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import { BRANCHES, type ISODate, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { primarySeries } from '@/lib/series';
import { addDays, diffDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { IconButton, Slider, type SliderMarker, type SliderRange, type SliderTick, Tooltip, cn } from '@/ui/design';
import { useMissionUi, useNarrow } from '@/ui/chrome/uiState';
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


export function TimelineScrubber({ className }: { className?: string }) {
  const t = useT();
  const lang = useLang();
  const narrow = useNarrow();
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
      const labelled = (m - 1) % 3 === 0;
      // Month names only: the year is in the date beside the track, and a longer label runs into its neighbour.
      out.push({ value: d, major: m === 1, label: labelled ? MONTHS[lang][m - 1] : undefined });
    }
    return out;
  }, [start, max, lang]);

  const markers = useMemo<SliderMarker[]>(() => {
    const out: SliderMarker[] = insights.map((i) => ({ value: diffDays(i.t, start), severity: i.severity, label: `${fmtDate(i.t, lang)}: ${pick(i.text, lang)}` }));
    for (const e of riskEvents ?? []) if (e.severity > 0) out.push({ value: diffDays(e.start, start), severity: e.severity >= 2 ? 'alert' : 'watch', label: `${fmtDate(e.start, lang)}: ${pick(e.title, lang)}` });
    // One marker per month (the strip is short beside the panels): the strongest stays, the others join its label, so the track
    // reads cleanly and nothing is lost on hover.
    const rank = (sev: SliderMarker['severity']) => (sev === 'alert' ? 2 : sev === 'watch' ? 1 : 0);
    const byBin = new Map<number, SliderMarker>();
    for (const m of out.sort((a, b) => rank(b.severity) - rank(a.severity) || a.value - b.value)) {
      if (m.value < 0 || m.value > max) continue;
      const bin = Math.floor(m.value / 30);
      const prev = byBin.get(bin);
      byBin.set(bin, prev ? { ...prev, label: `${prev.label}
${m.label}` } : m);
    }
    return [...byBin.values()];
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

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label={t('tl.timeline')}
      className={cn('flex min-w-0 items-center gap-3 bg-surface-0 pr-3 pl-4', className)}
    >
      <IconButton label={playing ? t('tl.pause') : t('tl.play')} icon={playing ? <Pause /> : <Play />} variant="primary" size="lg" className="rounded-full shadow-none [&_svg]:size-4 [&_svg]:fill-current" onClick={() => setPlaying(!playing)} />
      <div className="flex min-w-[5.75rem] shrink-0 flex-col">
        <span className="t-value text-base whitespace-nowrap text-ink-1">{fmtDate(cursor, lang)}</span>
        <span className="truncate text-xs text-ink-3">{rel === 0 ? t('tl.today') : rel < 0 ? t('tl.ago', { n: -rel }) : t('tl.ahead', { n: rel })}</span>
      </div>
      <div
        className="relative min-w-0 flex-1"
        onPointerDown={() => {
          setPlaying(false);
          setScrubbing(true);
        }}
        onPointerUp={() => setScrubbing(false)}
        onPointerCancel={() => setScrubbing(false)}
      >
        <Slider
          ariaLabel={t('tl.timeline')}
          size="md"
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
      {/* One button that steps 1x, 2x, 4x: three segments here crowded the track out of a short strip. */}
      <Tooltip content={t('tl.speed')}>
        <button
          type="button"
          aria-label={`${t('tl.speed')}: ${speed}×`}
          onClick={() => setSpeed(speed === 4 ? 1 : ((speed * 2) as 2 | 4))}
          className={cn('t-value flex shrink-0 items-center justify-center rounded-sm border border-line-1 text-xs text-ink-1 hover:bg-surface-2', narrow ? 'size-11 text-base' : 'h-8 w-10')}
        >
          {speed}×
        </button>
      </Tooltip>
    </div>
  );
}
