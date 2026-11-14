/**
 * Field panel, laid out the way OneSoil lays out a field: a header (name, area and crop, the next
 * steps as icon-over-label actions, close) and four tabs.
 *   Status        crop / planting date / weather cards, "Satellite data" (the field picture with a
 *                 metric selector beside the satellite image, a date control), three chart cards.
 *   Field report  the score as four small cards, then zones, stable area, frames, comparison maps.
 *   Data          the eight metric cards; details only after opening one.
 *   Ground truth  the override form and ledger.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, ChevronsUpDown, CloudSun, Droplets, Lightbulb, Maximize2, Wind, X } from 'lucide-react';
import { BRANCHES, type BranchId, pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES, findSeries, primarySeries, scoreAt } from '@/lib/series';
import { diffDays } from '@/lib/time';
import { type Phase, useMission } from '@/state/mission';
import { IconButton, StatusTag, TabPanel, Tabs } from '@/ui/design';
import { useWeatherNow } from '@/ui/chrome/Weather';
import { useMissionUi } from '@/ui/chrome/uiState';
import { cropName, fmtDate, fmtNum } from '@/ui/hud/format';
import { rainSum } from '@/ui/hud/readings';
import { GroundTruthForm } from '@/ui/override';
import { CardDetail } from './CardDetail';
import { LiveFieldCanvas } from './FieldCanvas';
import { FieldReport } from './FieldReport';
import { ScoreBlock } from './FieldSummary';
import { InfoCard } from './InfoCard';
import { MetricGrid, usePictureState, useSelectBranch } from './MetricCards';
import { rasterFor } from './picture';
import { SatelliteCanvas } from './SatelliteCanvas';
import { TileLegend } from './ScaleLegend';
import { SeasonPlanner, useSeasonRows } from './SeasonPlanner';
import { activeRow, seasonName } from './seasons';
import { AccumChart, NdviChart, gddBase, gddNote, gddSeries, s2Points } from './StatusCharts';
import './strings';

export type FieldTab = 'status' | 'report' | 'data' | 'truth';

/** The score in a few words beside the area and crop; it opens the Field report. */
function ScoreLink() {
  const t = useT();
  const score = useMission((s) => s.score);
  const cursor = useMission((s) => s.timeline.cursor);
  const setTab = useMissionUi((s) => s.setFieldTab);
  const hasCrop = useMission((s) => !!s.cropId);
  const snap = scoreAt(score, cursor);
  if (!snap) return <span className="skeleton inline-block h-3 w-20 align-middle" />;
  return (
    <button type="button" onClick={() => setTab('report')} className="rounded-xs text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink-1 hover:decoration-ink-3">
      {/* Without a crop the number is the generic growing-conditions index, so it is not called productivity. */}
      {!hasCrop ? t('field.line.conditions') : snap.offSeason ? t('field.line.outlook') : t('field.line.productivity')} <span className="t-value text-ink-1">{Math.round(snap.productivity)}</span>
      /100
    </button>
  );
}

/** A next step for this field, drawn as an icon over its name. */
function HeaderAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-[52px] min-w-16 flex-col items-center justify-center gap-1 rounded-sm px-2 text-xs font-medium text-ink-3 hover:bg-surface-2 [&_svg]:size-6 [&_svg]:stroke-[1.5] [&_svg]:text-ink-1">
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function Header() {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const cropId = useMission((s) => s.cropId);
  const mode = useMission((s) => s.telemetry?.mode);
  const unlock = useMission((s) => s.unlockParcel);
  const setPhase = useMission((s) => s.setPhase);
  if (!parcel) return null;
  const crop = getCrop(cropId);
  const go = (phase: Phase) => () => setPhase(phase);
  return (
    <header className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="truncate text-[20px] leading-[34px] font-[700] text-ink-1" title={parcel.name}>
          {parcel.name}
        </h2>
        <p className="flex flex-wrap items-center gap-x-1.5 text-base leading-[18px] text-ink-1">
          <span>
            <span className="font-medium text-ink-1">{fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0)} ha</span>
            {crop ? `, ${cropName(crop.names, lang)}` : ''}
          </span>
          <span aria-hidden className="text-ink-4">
            ·
          </span>
          <ScoreLink />
          {mode === 'mock' ? <StatusTag status="simulated" compact className="ml-1" /> : null}
        </p>
      </div>
      {/* On narrow screens the same destinations are in the tab bar. */}
      <div className="flex shrink-0 items-start narrow:hidden">
        <HeaderAction icon={<Lightbulb />} label={t('field.go.rotation')} onClick={go('advisory')} />
        <HeaderAction icon={<CalendarCheck />} label={t('field.go.notes')} onClick={go('tracking')} />
      </div>
      <IconButton label={t('field.close')} icon={<X />} size="lg" onClick={unlock} className="mt-1.5 -mr-2 shrink-0 [&_svg]:size-6 [&_svg]:stroke-[1.5]" />
    </header>
  );
}

function TopCards() {
  const t = useT();
  const lang = useLang();
  const setTab = useMissionUi((s) => s.setFieldTab);
  const w = useWeatherNow();
  const { rows, month, tropical } = useSeasonRows();
  const ai = activeRow(rows, month);
  const now = ai >= 0 ? rows[ai] : null;
  const add = (label: string) => <span className="text-signal-strong">{label}</span>;
  const names = now?.crops.map((id) => getCrop(id)).filter((c) => c != null).map((c) => cropName(c.names, lang)) ?? [];
  return (
    <div className="grid grid-cols-3 gap-4 compact:gap-2 narrow:grid-cols-2">
      <InfoCard label={now ? `${t('season.card.now')} · ${t(`season.name.${seasonName(now, tropical)}`, { n: ai + 1 })}` : t('season.card.now')} onClick={() => setTab('truth')} action={t('season.card.add')}>
        {names.length ? (
          <span className="inline-flex max-w-full items-center gap-1.5">
            <span aria-hidden className="size-3 shrink-0 rounded-full border border-signal bg-signal/30" />
            <span className="truncate">{names.join(' + ')}</span>
          </span>
        ) : (
          add(t('season.card.add'))
        )}
      </InfoCard>
      <InfoCard label={t('field.sowing')} onClick={() => setTab('truth')} action={t('field.addSowing')}>
        {now?.sowingDate ? fmtDate(now.sowingDate, lang) : now ? t('season.card.from', { m: t('season.month', { m: now.start }) }) : add(t('field.addSowing'))}
      </InfoCard>
      <div title={t('field.weather')} className="flex min-h-[62px] min-w-0 items-center justify-center gap-3 overflow-hidden rounded-sm border border-line-1 px-3 py-2 compact:gap-2 compact:px-2 narrow:col-span-2 narrow:gap-3">
        <CloudSun size={30} strokeWidth={1.5} aria-hidden className="shrink-0 text-branch-rainfall" />
        <span className="t-value text-[24px] leading-none text-ink-1">{w?.tmax != null ? `${fmtNum(w.tmax, 0)}°` : '--'}</span>
        <span className="t-value flex min-w-0 flex-col gap-1 text-[11px] leading-4 text-ink-1 narrow:text-xs">
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Droplets size={12} strokeWidth={1.5} aria-hidden className="text-ink-3" />
            {w?.rain != null ? `${fmtNum(w.rain, w.rain < 10 ? 1 : 0)} mm` : '--'}
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Wind size={12} strokeWidth={1.5} aria-hidden className="text-ink-3" />
            {w?.wind != null ? `${fmtNum(w.wind, 1)} m/s` : '--'}
          </span>
        </span>
        <span className="sr-only">{t('field.weather')}</span>
      </div>
    </div>
  );
}

/** Dark pill with the date shown and steps to the previous and next real frame. */
function DatePill() {
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
    <div className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-ink-1 px-1 text-white">
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
function ChartCard({ title, value, unit, note, children }: { title: string; value: string; unit: string; note: string; children: ReactNode }) {
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
  const cropId = useMission((s) => s.cropId);
  const crop = getCrop(cropId);
  const base = gddBase(crop);
  const modis = telemetry ? primarySeries(telemetry.branches.vegetation) : undefined;
  const rain = telemetry ? (findSeries(telemetry.branches.rainfall, 'rain') ?? primarySeries(telemetry.branches.rainfall)) : undefined;
  const gdd = useMemo(() => (telemetry ? gddSeries(telemetry.branches.agromet, base) : null), [telemetry, base]);
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
  const gddNow = gdd?.samples.filter((s) => s.t <= cursor && s.v != null).at(-1)?.v ?? null;
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
      {gdd && (
        <ChartCard title={t('field.gdd.title')} value={gddNow == null ? '--' : fmtNum(gddNow, 0)} unit="°C·d" note={gddNote(t, lang, crop, base)}>
          <AccumChart samples={gdd.samples} color="var(--color-branch-thermal)" label={t('field.gdd.title')} />
        </ChartCard>
      )}
    </div>
  );
}

function StatusTab() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <TopCards />
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-medium text-ink-1">{t('field.status.satellite')}</h3>
          <DatePill />
        </div>
        <div className="grid grid-cols-2 gap-2 narrow:grid-cols-1">
          <PictureTile />
          <SatelliteTile />
        </div>
        <PeriodNote />
        <StatusCharts />
      </section>
    </div>
  );
}

function DataTab() {
  const focus = useMission((s) => s.focusBranch);
  const select = useSelectBranch();
  if (focus) return <CardDetail branch={focus} onBack={() => select(null)} />;
  return <MetricGrid />;
}

function ReportTab() {
  return (
    <div className="flex flex-col gap-6">
      <ScoreBlock />
      <FieldReport />
    </div>
  );
}

function TruthTab() {
  return (
    <div className="flex flex-col gap-5">
      <SeasonPlanner />
      <GroundTruthForm />
    </div>
  );
}

export function FieldPanel() {
  const t = useT();
  const tab = useMissionUi((s) => s.fieldTab);
  const setTab = useMissionUi((s) => s.setFieldTab);
  const root = useRef<HTMLDivElement | null>(null);
  const parcelId = useMission((s) => s.parcel?.id);
  // A tab or a field opens at its top, wherever the previous one had been scrolled to.
  useEffect(() => {
    root.current?.closest('[data-panel-scroll]')?.scrollTo({ top: 0 });
  }, [tab, parcelId]);
  const count = <span className="flex h-6 min-w-6 items-center justify-center rounded-xs border border-signal px-1 font-normal text-signal-strong">{BRANCHES.length}</span>;
  return (
    <div ref={root} className="flex flex-col gap-5 narrow:gap-3">
      <Header />
      <Tabs<FieldTab>
        ariaLabel={t('field.tabs')}
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'status', label: t('field.tab.status') },
          { value: 'report', label: t('field.tab.report') },
          { value: 'data', label: t('field.tab.data'), badge: count },
          { value: 'truth', label: t('field.tab.truth') },
        ]}
      >
        <TabPanel value="status" className="pt-6">
          <StatusTab />
        </TabPanel>
        <TabPanel value="report" className="pt-6">
          <ReportTab />
        </TabPanel>
        <TabPanel value="data" className="pt-6">
          <DataTab />
        </TabPanel>
        <TabPanel value="truth" className="pt-6">
          <TruthTab />
        </TabPanel>
      </Tabs>
    </div>
  );
}
