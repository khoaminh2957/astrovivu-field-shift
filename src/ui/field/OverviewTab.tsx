/**
 * Overview of the open field: "how is it doing". One sentence from the model, three numbers (the
 * score, what holds it back, the canopy against its usual), what changed lately, the field picture
 * by date beside the satellite image, and the two charts a grower reads first: greenness and rain.
 */
import { useMemo, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsUpDown, Maximize2, TriangleAlert } from 'lucide-react';
import { BRANCHES, type BranchId, pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES, findSeries, insightsNear, primarySeries, scoreAt } from '@/lib/series';
import { diffDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { useMissionUi } from '@/ui/chrome/uiState';
import { AnomalyMarker, StatusTag, cn } from '@/ui/design';
import { fmtDate, fmtNum } from '@/ui/hud/format';
import { rainSum, readBranch } from '@/ui/hud/readings';
import { QuickFacts } from '@/ui/override';
import { LiveFieldCanvas } from './FieldCanvas';
import { usePictureState, useSelectBranch } from './MetricCards';
import { rasterFor } from './picture';
import { SatelliteCanvas } from './SatelliteCanvas';
import { TileLegend } from './ScaleLegend';
import { AccumChart, NdviChart, s2Points } from './StatusCharts';
import './strings';

/** A number that answers part of "how is the field": its name, the value, one line that qualifies it. */
function KeyCard({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-sm border border-line-1 px-4 py-3 compact:px-3">
      <span className="truncate text-xs text-ink-3">{label}</span>
      <span className={cn('min-w-0 truncate text-lg leading-6 font-medium text-ink-1', tone)}>{value}</span>
      {note != null && <span className="t-caption line-clamp-2">{note}</span>}
    </div>
  );
}

function KeyNumbers() {
  const t = useT();
  const lang = useLang();
  const score = useMission((s) => s.score);
  const cursor = useMission((s) => s.timeline.cursor);
  const cropId = useMission((s) => s.cropId);
  const telemetry = useMission((s) => s.telemetry);
  const parcel = useMission((s) => s.parcel);
  const insights = useMission((s) => s.insights);
  const groundTruth = useMission((s) => s.groundTruth);
  const snap = scoreAt(score, cursor);
  const veg = telemetry?.branches.vegetation;
  const reading = telemetry && veg && parcel ? readBranch({ telemetry, branch: veg, cursor, parcel, insights, groundTruth, lang, t }) : null;

  if (!snap) {
    return (
      <div aria-busy aria-label={t('field.score.loading')} className="grid grid-cols-3 gap-2 narrow:grid-cols-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="skeleton h-[86px] rounded-sm" />
        ))}
      </div>
    );
  }
  const v = Math.round(snap.productivity);
  // Colour only when the land needs attention; a healthy score is plain ink.
  const tone = v >= 60 ? undefined : v >= 40 ? 'text-watch' : 'text-alert';
  const limiting = snap.limiting ? snap.factors.find((f) => f.key === snap.limiting) : null;
  const actual = limiting?.actual == null ? null : typeof limiting.actual === 'number' ? fmtNum(limiting.actual, Math.abs(limiting.actual) < 10 ? 1 : 0) : limiting.actual;
  return (
    <div className="grid grid-cols-3 gap-2 narrow:grid-cols-1">
      {/* Without a crop the number is the generic growing-conditions index, so it is not called productivity. */}
      <KeyCard
        label={!cropId ? t('field.line.conditions') : snap.offSeason ? t('field.line.outlook') : t('field.score.productivity')}
        value={
          <>
            <span className="t-value">{v}</span>
            <span className="t-unit ml-0.5">/100</span>
          </>
        }
        tone={tone}
        note={[t('field.score.at', { d: fmtDate(cursor, lang) }), snap.stage ? pick(snap.stage.label, lang) : null].filter(Boolean).join(' · ')}
      />
      <KeyCard
        label={t('field.score.limiting')}
        value={limiting ? pick(limiting.label, lang) : t('field.score.none')}
        note={limiting && actual != null ? t('field.key.limitNote', { a: `${actual}${limiting.unit ? ` ${limiting.unit}` : ''}`, i: limiting.ideal }) : undefined}
      />
      <KeyCard
        label={t('field.key.veg')}
        value={
          reading?.value != null ? (
            <>
              <span className="t-value">{reading.value}</span>
              <span className="t-unit ml-1">{reading.unit}</span>
            </>
          ) : (
            '--'
          )
        }
        note={reading?.delta}
      />
    </div>
  );
}

/** The model's own sentence about the field, and up to two things that changed around the date shown. */
function Summary({ workspace }: { workspace: boolean }) {
  const t = useT();
  const lang = useLang();
  const headline = useMission((s) => s.score?.summary.headline);
  const mode = useMission((s) => s.telemetry?.mode);
  const insights = useMission((s) => s.insights);
  const cursor = useMission((s) => s.timeline.cursor);
  const events = useMission((s) => s.telemetry?.branches.risk.events);
  const event = workspace ? events?.filter((item) => item.severity && item.end >= cursor && diffDays(item.start, cursor) <= 16)
    .sort((a, b) => b.severity - a.severity || a.start.localeCompare(b.start))[0] : undefined;
  const near = insightsNear(insights, cursor, 21).filter((item) => !(event?.start === item.t && item.branch === 'risk')).slice(0, 2);
  return (
    <section aria-label={t('field.over.summary')} className="flex flex-col gap-3">
      {workspace && <h2 className="workspace-section-title">{t('field.over.outlook')}</h2>}
      {headline ? (
        <p className="text-md leading-6 text-ink-1">
          {pick(headline, lang)}
          {mode === 'mock' && <StatusTag status="simulated" compact className="ml-2 align-middle" />}
        </p>
      ) : (
        <span className="skeleton h-6 w-4/5" aria-hidden />
      )}
      <KeyNumbers />
      {workspace && event && (
        <p className="workspace-field-risk">
          <TriangleAlert size={15} aria-hidden className="text-signal-strong" />
          <span>
            <span className="t-label mr-1.5">{t(event.start > cursor ? 'field.risk.upcoming' : 'field.risk.active')}:</span>
            <strong>{pick(event.title, lang)}</strong> · {pick(event.detail, lang)} {fmtDate(event.start, lang)}
          </span>
        </p>
      )}
      {near.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {workspace && event && <span className="t-label">{t('field.changed')}</span>}
          <ul className="flex flex-col gap-1.5" aria-label={t('field.changed')}>
            {near.map((i, n) => (
              <li key={`${i.t}-${i.branch}-${n}`} className="flex gap-2">
                <AnomalyMarker severity={i.severity} className="mt-0.5 shrink-0" />
                <span className="min-w-0 text-sm text-ink-1">
                  {pick(i.text, lang)} <span className="t-meta whitespace-nowrap">{fmtDate(i.t, lang)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Dark pill with the date shown and steps to the previous and next real frame. */
function DatePill({ workspace }: { workspace: boolean }) {
  const lang = useLang();
  const t = useT();
  const cursor = useMission((s) => s.timeline.cursor);
  const focus = useMission((s) => s.focusBranch);
  const raster = useMission((s) => rasterFor(s.rasters, focus ?? 'vegetation'));
  const setCursor = useMission((s) => s.setCursor);
  const setPlaying = useMissionUi((s) => s.setPlaying);
  const dates = raster?.frames.map((f) => f.t) ?? [];
  const prev = [...dates].reverse().find((d) => d < cursor);
  const next = dates.find((d) => d > cursor);
  const go = (d?: string) => d && (setPlaying(false), setCursor(d));
  const step = 'flex size-8 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-35 disabled:hover:bg-transparent';
  return (
    <div className={cn('flex h-10 shrink-0 items-center gap-1 rounded-full bg-ink-1 px-1 text-white', workspace && 'workspace-date')}>
      <button type="button" aria-label={t('field.frame.prev')} disabled={!prev} onClick={() => go(prev)} className={step}>
        <ChevronLeft size={16} aria-hidden />
      </button>
      <span className="t-value min-w-28 px-1 text-center text-lg">{fmtDate(cursor, lang)}</span>
      <button type="button" aria-label={t('field.frame.next')} disabled={!next} onClick={() => go(next)} className={step}>
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}

const TILE = 'relative block aspect-[8/7] overflow-hidden rounded-sm bg-tile';
const TILE_CHIP = 'bg-ink-1 text-white';

/** Left tile: the field picture, a metric selector and an expand button on top, its legend in the corner. */
function PictureTile() {
  const t = useT();
  const lang = useLang();
  const focus = useMission((s) => s.focusBranch);
  const branch: BranchId = focus ?? 'vegetation';
  const raster = useMission((s) => rasterFor(s.rasters, branch));
  const titles = useMission((s) => s.telemetry?.branches);
  const pic = usePictureState(branch);
  const select = useSelectBranch();
  const setTab = useMissionUi((s) => s.setFieldTab);
  const title = (b: BranchId) => pick(titles?.[b]?.title ?? BRANCH_TITLES[b], lang);
  return (
    <figure className={TILE}>
      {pic === 'loading' ? <span className="skeleton absolute inset-10 opacity-20" aria-hidden /> : <LiveFieldCanvas branch={branch} pad={44} />}
      <label className={`absolute top-3 left-3 flex h-8 max-w-[calc(100%-4.5rem)] items-center gap-1 rounded-[18px] pr-2 text-xs font-medium shadow-map ${TILE_CHIP}`}>
        <span className="sr-only">{t('field.metric')}</span>
        <select value={branch} onChange={(e) => select(e.target.value as BranchId)} className="h-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-transparent pl-3 outline-offset-2">
          {BRANCHES.map((b) => (
            <option key={b} value={b} className="text-ink-1">
              {title(b)}
            </option>
          ))}
        </select>
        {raster && <span className="shrink-0 rounded-xs bg-[#3a3a3c] px-1.5 py-0.5 leading-4">{(raster.unit || raster.key).toUpperCase().slice(0, 6)}</span>}
        <ChevronsUpDown size={14} aria-hidden className="shrink-0" />
      </label>
      <button
        type="button"
        aria-label={t('field.pic.open', { name: title(branch) })}
        title={t('field.pic.open', { name: title(branch) })}
        onClick={() => (select(branch), setTab('data'))}
        className={`absolute top-3 right-3 flex size-8 items-center justify-center rounded-sm hover:bg-black ${TILE_CHIP}`}
      >
        <Maximize2 size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {raster ? (
        <TileLegend raster={raster} className="absolute bottom-3 left-3" />
      ) : (
        <figcaption className="absolute right-3 bottom-2 left-3 text-[11px] leading-[14px] text-white/80 narrow:text-xs">{t('field.pic.singleNoRes')}</figcaption>
      )}
      {raster && raster.frames.length > 1 && (
        <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 text-[11px] leading-[14px] text-[#b9b9bd] compact:hidden narrow:inline-flex narrow:text-xs">
          <span aria-hidden className="inline-block size-2.5 rounded-full border border-[#b9b9bd] bg-[#b9b9bd]/30" />
          {t('field.scale.noData')}
        </span>
      )}
    </figure>
  );
}

function SatelliteTile() {
  const t = useT();
  const parcel = useMission((s) => s.parcel);
  if (!parcel) return null;
  const shadow = '[text-shadow:0_1px_2px_rgb(0_0_0/0.7)]';
  return (
    <figure className={TILE}>
      <SatelliteCanvas parcel={parcel} pad={44} />
      <figcaption className={`absolute top-4 left-4 text-md leading-6 font-medium text-white ${shadow}`}>{t('field.sat.title')}</figcaption>
      <span className={`absolute right-3 bottom-2 left-3 text-[11px] leading-[14px] text-white/85 narrow:text-xs ${shadow}`}>{t('field.sat.credit')}</span>
    </figure>
  );
}

/** The window every chart below covers. Not a control: the telemetry window is fixed at one year. */
function PeriodNote() {
  const lang = useLang();
  const t = useT();
  const window = useMission((s) => s.telemetry?.window);
  if (!window) return null;
  return (
    <span className="inline-flex h-8 items-center gap-1.5 self-end rounded-sm border border-line-2 px-2.5 text-base text-ink-1" title={t('field.period')}>
      <CalendarDays size={16} strokeWidth={1.5} aria-hidden className="text-ink-1" />
      <span className="sr-only">{t('field.period')}: </span>
      {fmtDate(window.start, lang)} – {fmtDate(window.today, lang)}
    </span>
  );
}

/** A chart card: the plot on the left; its name, one value and one sentence on the right. */
export function ChartCard({ title, value, unit, note, children }: { title: string; value: string; unit: string; note: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-5 rounded-sm border border-line-1 p-4 narrow:grid-cols-1 narrow:gap-3">
      <div className="min-w-0">{children}</div>
      <div className="flex flex-col gap-1 narrow:order-first">
        <h4 className="text-base leading-5 font-medium text-ink-1">{title}</h4>
        <span className="flex items-baseline gap-1">
          <span className="t-value text-xl leading-7 text-ink-1">{value}</span>
          <span className="t-unit">{unit}</span>
        </span>
        <p className="t-caption">{note}</p>
      </div>
    </section>
  );
}

function StatusCharts() {
  const t = useT();
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry);
  const cursor = useMission((s) => s.timeline.cursor);
  const parcel = useMission((s) => s.parcel);
  const ndvi = useMission((s) => rasterFor(s.rasters, 'vegetation'));
  const modis = telemetry ? primarySeries(telemetry.branches.vegetation) : undefined;
  const rain = telemetry ? (findSeries(telemetry.branches.rainfall, 'rain') ?? primarySeries(telemetry.branches.rainfall)) : undefined;
  const pts = useMemo(() => s2Points(ndvi, parcel), [ndvi, parcel]);
  const rainAcc = useMemo(() => {
    let sum = 0;
    return (rain?.samples ?? []).map((s) => ({ ...s, v: s.v == null ? null : (sum += s.v) }));
  }, [rain]);
  if (!telemetry) return null;

  const latest = [...pts].reverse().find((p) => p.t <= cursor);
  const ndviNote = latest ? t('field.ndvi.short', { d: fmtDate(latest.t, lang), n: diffDays(cursor, latest.t) }) : t('field.ndvi.none');
  const rainTotal = rain ? rainSum(rain.samples, cursor, 9999) : null;
  const rainDays = rain ? diffDays(cursor, telemetry.window.start) : 0;
  return (
    <div className="flex flex-col gap-3">
      <ChartCard title={t('field.ndvi.card')} value={latest ? fmtNum(latest.mean, 2) : '--'} unit="" note={ndviNote}>
        <NdviChart modis={modis} />
      </ChartCard>
      {rain && (
        <ChartCard title={t('field.chart.rainAcc')} value={fmtNum(rainTotal, 0)} unit="mm" note={t('field.rain.short', { n: rainDays })}>
          <AccumChart samples={rainAcc} color="var(--color-branch-rainfall)" label={t('field.chart.rainAcc')} />
        </ChartCard>
      )}
    </div>
  );
}

function WorkspaceImages() {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const branch = useMission((s) => s.focusBranch ?? 'vegetation');
  const paint = useMission((s) => rasterFor(s.rasters, branch));
  const cursor = useMission((s) => s.timeline.cursor);
  const select = useSelectBranch();
  const setTab = useMissionUi((s) => s.setFieldTab);
  const date = paint?.frames.findLast((frame) => frame.t <= cursor)?.t;
  const metric = pick(BRANCH_TITLES[branch], lang);
  const sourceId = paint?.sourceId;
  const source = useMission((s) => sourceId ? s.telemetry?.sources[sourceId] : undefined);
  if (!parcel) return null;
  return (
    <>
      {date && <p className="workspace-image-note">{paint?.unit || metric} · {fmtDate(date, lang)}</p>}
      <div className="workspace-image-grid">
        <button type="button" onClick={() => (select(branch), setTab('data'))} className="workspace-image-card" aria-label={t('field.pic.open', { name: metric })}>
          <span>{metric}{paint?.unit ? ` · ${paint.unit}` : ''}</span>
          <span className="workspace-image-frame">
            <span className="workspace-image-map">
              <SatelliteCanvas parcel={parcel} pad={8} thumbnail />
              <LiveFieldCanvas branch={branch} pad={8} className="absolute inset-0" />
            </span>
          </span>
        </button>
        <figure className="workspace-image-card">
          <figcaption>{t('field.sat.title')}</figcaption>
          <div className="workspace-image-frame"><div className="workspace-image-map"><SatelliteCanvas parcel={parcel} pad={8} thumbnail /></div></div>
        </figure>
      </div>
      <p className="workspace-image-note">
        {source && paint && <span>{source.name} · {paint.cellM} m</span>}
        <span>{t('field.sat.credit')}</span>
      </p>
    </>
  );
}

export function OverviewTab({ workspace = false }: { workspace?: boolean }) {
  const t = useT();
  const parcelId = useMission((s) => s.parcel?.id);
  const closed = useMissionUi((s) => (parcelId ? !!s.quickClosed[parcelId] : true));
  const closeQuick = useMissionUi((s) => s.closeQuick);
  const setTab = useMissionUi((s) => s.setFieldTab);
  return (
    <div className={cn('flex flex-col gap-6', workspace && 'workspace-overview')}>
      {!closed && parcelId && <QuickFacts onClose={() => closeQuick(parcelId)} onMore={() => setTab('soil')} />}
      <Summary workspace={workspace} />
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className={workspace ? 'workspace-section-title' : 'text-lg font-medium text-ink-1'}>{t('field.status.satellite')}</h2>
          <DatePill workspace={workspace} />
        </div>
        {workspace ? <WorkspaceImages /> : (
          <div className="grid grid-cols-2 gap-2 narrow:grid-cols-1">
            <PictureTile />
            <SatelliteTile />
          </div>
        )}
        <PeriodNote />
        <StatusCharts />
      </section>
    </div>
  );
}
