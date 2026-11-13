import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { BRANCHES, BRANCH_SIDE, type BranchId, type ISODate, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES } from '@/lib/series';
import { addDays, diffDays } from '@/lib/time';
import { AnomalyMarker } from '../AnomalyMarker';
import { IconButton } from '../Button';
import { Callout, CalloutFacts } from '../Callout';
import { ConfidenceBadge } from '../ConfidenceBadge';
import { HubGauge } from '../HubGauge';
import { HUD_METRICS, useHudDensity } from '../layout';
import { anchorPoint, footprintTargets, LeaderLayer, LeaderLine, type Point } from '../LeaderLines';
import { Segmented } from '../Segmented';
import { Slider, type SliderTick } from '../Slider';
import { Sparkline } from '../Sparkline';
import { ProvenanceTag, StatusTag } from '../Tag';
import { BRANCH_RAMP, MOTION, rampColor, type Status } from '../tokens';
import { baselineOf, DEMO_TELEMETRY, factOf, fmtDate, fmtRes, FORECAST_END, insightNear, MONTHS, rain30, readingAt, seriesOf, SOURCE, specimenConfidence, specimenInsights, specimenScore, type SpecimenInsight, TODAY, WINDOW } from './demo';
import { Group, Section } from './parts';

const DOMAIN: [ISODate, ISODate] = [WINDOW.start, WINDOW.end];
const DAYS_OBSERVED = diffDays(TODAY, WINDOW.start);
const DAYS_TOTAL = diffDays(FORECAST_END, WINDOW.start);
const LEFT = BRANCHES.filter((b) => BRANCH_SIDE[b] === 'left');
const RIGHT = BRANCHES.filter((b) => BRANCH_SIDE[b] === 'right');

/** Deterministic stand-in for satellite imagery: a jittered mosaic of fields with row texture. */
function FieldMosaic() {
  const cells = useMemo(() => {
    let seed = 20261114;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const cols = 11;
    const rows = 6;
    const W = 1320;
    const H = 660;
    const px: number[][] = [];
    const py: number[][] = [];
    for (let j = 0; j <= rows; j++) {
      px.push([]);
      py.push([]);
      for (let i = 0; i <= cols; i++) {
        const edge = i === 0 || i === cols || j === 0 || j === rows;
        px[j].push((i / cols) * W + (edge ? 0 : (rnd() - 0.5) * 46));
        py[j].push((j / rows) * H + (edge ? 0 : (rnd() - 0.5) * 40));
      }
    }
    const fills = ['#31482c', '#3c5631', '#465a2e', '#2a3f2a', '#5d5335', '#6a5c3a', '#39502f', '#4f5a33'];
    const out: { d: string; fill: string; tex: number }[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        out.push({
          d: `M${px[j][i]} ${py[j][i]}L${px[j][i + 1]} ${py[j][i + 1]}L${px[j + 1][i + 1]} ${py[j + 1][i + 1]}L${px[j + 1][i]} ${py[j + 1][i]}Z`,
          fill: fills[Math.floor(rnd() * fills.length)],
          tex: Math.floor(rnd() * 4),
        });
    return out;
  }, []);
  return (
    <svg aria-hidden viewBox="0 0 1320 660" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
      <defs>
        {[14, 76, 104, -22].map((deg, i) => (
          <pattern key={deg} id={`sg-rows-${i}`} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform={`rotate(${deg})`}>
            <line x1="0" y1="0.5" x2="7" y2="0.5" stroke="#000" strokeOpacity="0.16" strokeWidth="1" />
          </pattern>
        ))}
        <radialGradient id="sg-vignette" cx="50%" cy="46%" r="75%">
          <stop offset="55%" stopColor="#03050b" stopOpacity="0" />
          <stop offset="100%" stopColor="#03050b" stopOpacity="0.5" />
        </radialGradient>
      </defs>
      {cells.map((c) => (
        <g key={c.d}>
          <path d={c.d} fill={c.fill} />
          <path d={c.d} fill={`url(#sg-rows-${c.tex})`} stroke="#1c2a1c" strokeWidth="2.5" />
        </g>
      ))}
      <rect width="1320" height="660" fill="url(#sg-vignette)" />
    </svg>
  );
}

function statusFor(branch: BranchId, cursor: ISODate, insights: SpecimenInsight[]): Status | null {
  const hit = insights.find((i) => i.branch === branch && Math.abs(diffDays(i.t, cursor)) <= 10);
  if (hit && hit.severity !== 'info') return hit.severity;
  return null;
}

interface StageProps {
  cursor: ISODate;
  focus: BranchId | null;
  onFocus: (b: BranchId | null) => void;
  insights: SpecimenInsight[];
}

function useCalloutContent({ cursor, focus, onFocus, insights }: StageProps) {
  const t = useT();
  const lang = useLang();
  const density = useHudDensity();
  const h = HUD_METRICS[density].sparkline;

  return (branch: BranchId, side: 'left' | 'right', anchorRef?: (el: HTMLSpanElement | null) => void): ReactNode => {
    const src = SOURCE[branch];
    const active = focus === branch;
    const tone = active ? branch : 'ink';
    const series = seriesOf(branch);
    const reading = readingAt(branch, cursor);
    const common = {
      side,
      branch,
      active,
      anchorRef,
      title: pick(BRANCH_TITLES[branch], lang),
      onSelect: () => onFocus(active ? null : branch),
      badge: <ConfidenceBadge badge={specimenConfidence(branch)} variant="glyph" />,
    };
    const age = reading.ageDays != null ? `${reading.ageDays} d` : null;
    const meta = <ProvenanceTag compact provenance={src.provenance} source={src.name} detail={[fmtRes(src.resolutionM), age].filter(Boolean).join(' · ')} />;
    const dev = reading.deltaPct;
    const delta = reading.stale
      ? t('sg.delta.stale', { n: reading.ageDays ?? 0 })
      : dev == null
        ? undefined
        : Math.abs(dev) < 4
          ? t('sg.delta.normal')
          : t(dev < 0 ? 'sg.delta.below' : 'sg.delta.above', { n: Math.abs(dev) });
    const status: Status | null = reading.stale ? 'stale' : statusFor(branch, cursor, insights);
    const marks = insights.filter((i) => i.branch === branch);

    switch (branch) {
      case 'terrain':
        return (
          <Callout key={branch} {...common} value={factOf('terrain', 'elevation_m')?.value} unit="m" meta={<ProvenanceTag compact provenance={src.provenance} source={src.name} detail={fmtRes(src.resolutionM)} />}>
            <CalloutFacts
              items={[
                { label: pick(factOf('terrain', 'slope_deg')?.label, lang), value: factOf('terrain', 'slope_deg')?.value, unit: '°' },
                { label: pick(factOf('terrain', 'aspect_label')?.label, lang), value: factOf('terrain', 'aspect_label')?.value },
              ]}
            />
          </Callout>
        );
      case 'soil':
        // The farmer's own soil test overrides SoilGrids: the one inverse-video reading on screen.
        return (
          <Callout key={branch} {...common} status="ground-truth" value="5.8" unit="pH" estimate={factOf('soil', 'ph')?.value} badge={<ConfidenceBadge level="high" score={1} variant="glyph" />} meta={<ProvenanceTag compact provenance="ground-truth" source="pH" detail="02-11-2026" />}>
            <CalloutFacts
              items={[
                { label: pick(factOf('soil', 'clay_pct')?.label, lang), value: factOf('soil', 'clay_pct')?.value, unit: '%' },
                { label: pick(factOf('soil', 'soc_gkg')?.label, lang), value: factOf('soil', 'soc_gkg')?.value, unit: 'g/kg' },
              ]}
            />
          </Callout>
        );
      case 'risk': {
        const fc = series?.samples ?? [];
        const peak = fc.reduce((m, s) => (s.v != null && s.v > m ? s.v : m), -Infinity);
        const event = DEMO_TELEMETRY.branches.risk.events?.[0];
        const tmax = DEMO_TELEMETRY.branches.agromet.series.find((s) => s.key === 't2m_max');
        const from = addDays(TODAY, -45);
        return (
          <Callout key={branch} {...common} status={event ? 'watch' : null} value={Number.isFinite(peak) ? peak.toFixed(1) : null} unit="°C max" delta={event ? pick(event.detail, lang) : t('sg.delta.forecast')} meta={<ProvenanceTag compact provenance="forecast" source={src.name} detail="+15 d" />}>
            <Sparkline samples={(tmax?.samples ?? []).filter((s) => s.t >= from)} forecast={fc} range={[20, 40]} domain={[from, FORECAST_END]} today={TODAY} cursor={cursor >= from ? cursor : null} tone={tone} anomalies={event ? [{ t: event.start, severity: 'watch', label: pick(event.title, lang) }] : undefined} height={h} points={false} />
          </Callout>
        );
      }
      case 'rainfall':
        return (
          <Callout key={branch} {...common} status={status} value={rain30(cursor)} unit="mm / 30 d" delta={reading.text != null ? `${reading.text} ${reading.unit}` : undefined} meta={meta}>
            {series && <Sparkline samples={series.samples} range={series.range} domain={DOMAIN} variant="bars" cursor={cursor} tone={tone} anomalies={marks} height={h} label={pick(series.label, lang)} unit={series.unit} />}
          </Callout>
        );
      default:
        return (
          <Callout key={branch} {...common} status={status} value={reading.text} unit={branch === 'vegetation' ? 'NDVI' : reading.unit} delta={delta} meta={meta}>
            {series && (
              <Sparkline samples={series.samples} range={branch === 'vegetation' ? [0.2, 0.9] : series.range} domain={DOMAIN} cadence={series.cadence} baseline={baselineOf(branch)} cursor={cursor} tone={tone} anomalies={marks} height={h} points={branch === 'vegetation' ? 'auto' : false} label={pick(series.label, lang)} unit={series.unit} />
            )}
          </Callout>
        );
    }
  };
}

function HudStage(props: StageProps) {
  const { cursor, focus } = props;
  const lang = useLang();
  const t = useT();
  const density = useHudDensity();
  const metrics = HUD_METRICS[density];
  const stageRef = useRef<HTMLDivElement | null>(null);
  const anchors = useRef(new Map<BranchId, HTMLSpanElement>());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [lines, setLines] = useState<{ branch: BranchId; side: 'left' | 'right'; from: Point; to: Point }[]>([]);
  const render = useCalloutContent(props);
  const stacked = density === 'stacked';

  // The HUD area of the real screen: viewport height minus the top bar and the timeline dock.
  const stageH = stacked ? 300 : density === 'compact' ? 560 : 720;
  const parcel = stacked ? { w: 210, h: 142 } : density === 'compact' ? { w: 340, h: 232 } : { w: 430, h: 292 };
  const cx = size.w / 2;
  const cy = stageH / 2 - (stacked ? 0 : 6);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const w = stage.clientWidth;
      setSize((s) => (s.w === w && s.h === stage.clientHeight ? s : { w, h: stage.clientHeight }));
      if (stacked) {
        setLines([]);
        return;
      }
      const centre = { x: w / 2, y: stageH / 2 - 6, w: parcel.w, h: parcel.h };
      const next: typeof lines = [];
      for (const [side, ids] of [['left', LEFT], ['right', RIGHT]] as const) {
        const targets = footprintTargets(centre, side, ids.length, { spreadDeg: 40 });
        ids.forEach((b, i) => {
          const el = anchors.current.get(b);
          if (el) next.push({ branch: b, side, from: anchorPoint(el, stage), to: targets[i] });
        });
      }
      // Only publish when something moved, so a cursor tick does not render the stage twice.
      setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    for (const el of stage.querySelectorAll('[data-hud-column]')) ro.observe(el);
    return () => ro.disconnect();
    // Callout heights change with language and with what each reading flags.
  }, [stacked, stageH, parcel.w, parcel.h, lang, cursor]);

  // Parcel paint: the ramp of the branch in focus, at the value under the cursor.
  const metric = focus ? BRANCH_RAMP[focus] : null;
  const focusSeries = focus ? seriesOf(focus) : undefined;
  const focusValue = focus ? readingAt(focus, cursor).value : null;
  const paint = metric && focusSeries?.range && focusValue != null ? rampColor(metric, focus === 'rainfall' ? rain30(cursor) : focusValue, focus === 'rainfall' ? [0, 400] : focus === 'vegetation' ? [0.2, 0.9] : focusSeries.range) : null;
  const a = (-12 * Math.PI) / 180;
  const corners = [
    [-parcel.w / 2, -parcel.h / 2],
    [parcel.w / 2, -parcel.h / 2],
    [parcel.w / 2, parcel.h / 2],
    [-parcel.w / 2, parcel.h / 2],
  ].map(([x, y]) => `${(cx + x * Math.cos(a) - y * Math.sin(a)).toFixed(1)},${(cy + x * Math.sin(a) + y * Math.cos(a)).toFixed(1)}`);
  const score = specimenScore(cursor);
  const setAnchor = (b: BranchId) => (el: HTMLSpanElement | null) => {
    if (el) anchors.current.set(b, el);
    else anchors.current.delete(b);
  };

  return (
    <>
      <div ref={stageRef} className="relative overflow-hidden bg-surface-0" style={{ height: stageH }}>
        <FieldMosaic />
        {size.w > 0 && (
          <svg aria-hidden className="absolute inset-0 size-full">
            <polygon points={corners.join(' ')} fill={paint ?? 'none'} fillOpacity={0.8} style={{ transition: 'fill var(--dur-base) var(--ease-out)' }} />
            <polygon points={corners.join(' ')} fill="none" stroke="var(--color-void)" strokeOpacity={0.65} strokeWidth={5} strokeLinejoin="round" />
            <polygon points={corners.join(' ')} fill="none" stroke="var(--color-signal)" strokeWidth={2} strokeLinejoin="round" />
          </svg>
        )}
        {!stacked && (
          <LeaderLayer>
            {lines.map((l, i) => (
              <LeaderLine key={l.branch} from={l.from} to={l.to} side={l.side} shelf={metrics.shelf} branch={l.branch} active={focus === l.branch} drawOn delay={i * MOTION.stagger} />
            ))}
          </LeaderLayer>
        )}
        {size.w > 0 && (
          <div className="absolute z-(--z-hud) -translate-1/2" style={{ left: cx, top: cy }}>
            <HubGauge value={score.productivity} secondary={score.compatibility} label={t('sg.ins.hub.label')} secondaryLabel={t('sg.ins.hub.secondary')} limiting={pick(score.limiting, lang)} size={metrics.hub} instant />
          </div>
        )}
        {!stacked &&
          (
            [
              ['left', LEFT],
              ['right', RIGHT],
            ] as const
          ).map(([side, ids]) => (
            <div
              key={side}
              data-hud-column
              className="absolute inset-y-2 z-(--z-hud) flex flex-col justify-center gap-(--hud-callout-gap)"
              style={side === 'left' ? { left: 'var(--hud-gutter)' } : { right: 'var(--hud-gutter)' }}
            >
              {ids.map((b) => render(b, side, setAnchor(b)))}
            </div>
          ))}
        <span className="t-meta absolute bottom-2 left-1/2 -translate-x-1/2 rounded-xs bg-void/70 px-1.5 whitespace-nowrap">{t('sg.cmp.imagery')}</span>
      </div>
      {stacked && <div className="grid gap-2 border-t border-line-1 bg-surface-0 p-3 sm:grid-cols-2">{BRANCHES.map((b) => render(b, BRANCH_SIDE[b]))}</div>}
    </>
  );
}

function TimelineDock({ day, onDay, playing, onPlaying, speed, onSpeed, insights }: { day: number; onDay: (d: number) => void; playing: boolean; onPlaying: (p: boolean) => void; speed: number; onSpeed: (s: number) => void; insights: SpecimenInsight[] }) {
  const t = useT();
  const lang = useLang();
  const density = useHudDensity();
  const cursor = addDays(WINDOW.start, day);
  const near = insightNear(insights, cursor);
  const rel = diffDays(cursor, TODAY);

  const ticks = useMemo<SliderTick[]>(() => {
    const out: SliderTick[] = [];
    for (let d = 0; d <= DAYS_TOTAL; d++) {
      const date = addDays(WINDOW.start, d);
      if (date.endsWith('-01')) {
        const m = Number(date.slice(5, 7));
        // Phones have room for a label per quarter; the ticks stay monthly.
        const labelled = density !== 'stacked' || (m - 1) % 3 === 0;
        out.push({ value: d, major: true, label: !labelled ? undefined : m === 1 ? `${MONTHS[lang][0]} ${date.slice(0, 4)}` : MONTHS[lang][m - 1] });
      }
    }
    return out;
  }, [lang, density]);

  const markers = useMemo(() => {
    const event = DEMO_TELEMETRY.branches.risk.events?.[0];
    return [
      ...insights.map((i) => ({ value: diffDays(i.t, WINDOW.start), severity: i.severity, label: i.label })),
      ...(event ? [{ value: diffDays(event.start, WINDOW.start), severity: 'watch' as const, label: pick(event.title, lang) }] : []),
    ];
  }, [insights, lang]);

  return (
    <div className="grid min-h-(--timeline-h) items-center gap-x-5 gap-y-2 border-t border-line-1 bg-surface-1 px-(--panel-pad) py-2 lg:grid-cols-[auto_minmax(0,1fr)]">
      <div className="flex items-center gap-3">
        <IconButton label={playing ? t('sg.ctl.pause') : t('sg.ctl.play')} icon={playing ? <Pause /> : <Play />} variant="primary" size={density === 'stacked' ? 'lg' : 'md'} onClick={() => onPlaying(!playing)} />
        <div className="flex min-w-36 flex-col">
          <span className="t-value text-xl leading-6">{fmtDate(cursor, lang)}</span>
          <span className="t-meta">{rel === 0 ? t('sg.cmp.today') : rel < 0 ? `${t('sg.cmp.today')} − ${-rel} d` : `${t('sg.cmp.forecast')} + ${rel} d`}</span>
        </div>
        <Segmented
          ariaLabel={t('sg.cmp.speed')}
          size="sm"
          value={String(speed)}
          onValueChange={(v) => onSpeed(Number(v))}
          options={[
            { value: '1', label: '1×' },
            { value: '2', label: '2×' },
            { value: '4', label: '4×' },
          ]}
        />
      </div>
      <div className="flex min-w-0 flex-col">
        {/* Automatic commentary: one line, tied to the nearest Anomaly Marker. */}
        <p className="flex h-5 min-w-0 items-center gap-2 text-sm text-ink-2 stacked:h-auto stacked:items-start" aria-live="polite">
          {near ? (
            <>
              <AnomalyMarker severity={near.severity} className="shrink-0" />
              <span className="truncate stacked:line-clamp-3 stacked:whitespace-normal">{pick(near.text, lang)}</span>
            </>
          ) : (
            <span className="truncate text-ink-3">{t('sg.cmp.commentary.none')}</span>
          )}
        </p>
        <Slider
          ariaLabel={t('sg.cmp.timeline')}
          size="lg"
          value={day}
          onValueChange={onDay}
          min={0}
          max={DAYS_TOTAL}
          step={1}
          formatValue={(v) => fmtDate(addDays(WINDOW.start, v), lang)}
          ticks={ticks}
          markers={markers}
          ranges={[
            { from: DAYS_OBSERVED - 3, to: DAYS_OBSERVED, kind: 'pending' },
            { from: DAYS_OBSERVED, to: DAYS_TOTAL, kind: 'forecast' },
          ]}
        />
      </div>
    </div>
  );
}

export function CompositionSection() {
  const t = useT();
  const insights = useMemo(() => specimenInsights(), []);
  const [day, setDay] = useState(DAYS_OBSERVED - 118);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [focus, setFocus] = useState<BranchId | null>('vegetation');
  const cursor = addDays(WINDOW.start, day);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setDay((d) => {
        const next = d + 3 * speed;
        if (next >= DAYS_OBSERVED) {
          setPlaying(false);
          return DAYS_OBSERVED;
        }
        return next;
      });
    }, 110);
    return () => clearInterval(id);
  }, [playing, speed]);

  const play = (p: boolean) => {
    if (p && day >= DAYS_OBSERVED) setDay(0);
    setPlaying(p);
  };

  return (
    <Section id="composition" title={t('sg.nav.composition')} note={t('sg.cmp.note')}>
      <Group title={t('sg.cmp.field')} note={t('sg.cmp.stacked')}>
        <div className="overflow-hidden rounded-sm border border-line-2 shadow-lg">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-1 bg-surface-1 px-(--panel-pad) py-2">
            <StatusTag status="simulated" />
            <span className="t-caption">{t('sg.cmp.specimen')}</span>
          </div>
          <HudStage cursor={cursor} focus={focus} onFocus={setFocus} insights={insights} />
          <TimelineDock day={day} onDay={(d) => (setPlaying(false), setDay(d))} playing={playing} onPlaying={play} speed={speed} onSpeed={setSpeed} insights={insights} />
        </div>
      </Group>
    </Section>
  );
}
