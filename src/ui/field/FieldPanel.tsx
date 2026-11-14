/**
 * Field panel, laid out the way OneSoil lays out a field: a header (thumbnail, name, area and
 * crop, one score line, actions, close) and four tabs.
 *   Status        crop / planting date / weather cards, "Satellite data" (the field picture with a
 *                 metric selector beside the satellite image, a date control), three chart cards.
 *   Field report  the score in detail, then zones, stable area, frames, comparison maps.
 *   Data          the eight metric cards; details only after opening one.
 *   Ground truth  the override form and ledger.
 */
import { useMemo, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ClipboardPen, CloudSun, Pencil, X } from 'lucide-react';
import { BRANCHES, type BranchId, type Series, pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { BRANCH_TITLES, findSeries, primarySeries, scoreAt } from '@/lib/series';
import { diffDays } from '@/lib/time';
import { useMission } from '@/state/mission';
import { IconButton, Sparkline, StatusTag, TabPanel, Tabs, cn } from '@/ui/design';
import { useMissionUi } from '@/ui/chrome/uiState';
import { cropName, fmtDate, fmtNum } from '@/ui/hud/format';
import { rainSum } from '@/ui/hud/readings';
import { GroundTruthForm } from '@/ui/override';
import { CardDetail } from './CardDetail';
import { LiveFieldCanvas, ShapeThumb } from './FieldCanvas';
import { FieldReport } from './FieldReport';
import { CropSelect, ScoreBlock } from './FieldSummary';
import { MetricGrid, usePictureState, useSelectBranch } from './MetricCards';
import { rasterFor } from './picture';
import { SatelliteCanvas } from './SatelliteCanvas';
import { ScaleLegend } from './ScaleLegend';
import { NdviChart, gddBase, gddNote, gddSeries, s2Points } from './StatusCharts';
import './strings';

export type FieldTab = 'status' | 'report' | 'data' | 'truth';

function ScoreLine() {
  const t = useT();
  const lang = useLang();
  const score = useMission((s) => s.score);
  const cursor = useMission((s) => s.timeline.cursor);
  const setTab = useMissionUi((s) => s.setFieldTab);
  const snap = scoreAt(score, cursor);
  if (!snap) return <span className="skeleton mt-1 h-4 w-48" />;
  const lim = snap.limiting ? snap.factors.find((f) => f.key === snap.limiting) : null;
  return (
    <button type="button" onClick={() => setTab('report')} className="mt-1 self-start text-left text-sm text-ink-2 hover:text-signal">
      {snap.offSeason ? t('field.line.outlook') : t('field.line.productivity')} <span className="t-value font-medium text-ink-1">{Math.round(snap.productivity)}</span>
      {lim ? ` · ${t('field.line.limited', { f: pick(lim.label, lang).toLowerCase() })}` : ''}
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
  const setTab = useMissionUi((s) => s.setFieldTab);
  if (!parcel) return null;
  const crop = getCrop(cropId);
  return (
    <header className="flex items-start gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-ink-1">
        <ShapeThumb parcel={parcel} size={36} light />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-lg leading-6 font-semibold text-ink-1" title={parcel.name}>
          {parcel.name}
        </h2>
        <span className="truncate text-sm text-ink-2">
          <span className="font-medium text-ink-1">{fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0)} ha</span>
          {crop ? `, ${cropName(crop.names, lang)}` : ''}
          {mode === 'mock' ? <StatusTag status="simulated" compact className="ml-2 align-middle" /> : null}
        </span>
        <ScoreLine />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label={t('field.gt')} icon={<ClipboardPen />} onClick={() => setTab('truth')} />
        <IconButton label={t('field.close')} icon={<X />} onClick={unlock} />
      </div>
    </header>
  );
}

/** One of the three small cards at the top of Status (crop, planting date, weather). */
function InfoCard({ label, children, onClick, action }: { label: string; children: ReactNode; onClick?: () => void; action?: string }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-xs text-ink-3">
        {label}
        {onClick && <Pencil size={13} aria-hidden className="text-ink-4" />}
      </span>
      <span className="min-w-0 truncate text-sm font-medium text-ink-1">{children}</span>
    </>
  );
  const cls = 'flex min-w-0 flex-col gap-1 rounded-md border border-line-1 bg-surface-0 px-3 py-2.5 text-left';
  return onClick ? (
    <button type="button" aria-label={action} onClick={onClick} className={cn(cls, 'hover:border-line-2')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function TopCards() {
  const t = useT();
  const lang = useLang();
  const cropId = useMission((s) => s.cropId);
  const sowing = useMission((s) => s.groundTruth.sowingDate);
  const tel = useMission((s) => s.telemetry);
  const setTab = useMissionUi((s) => s.setFieldTab);
  const crop = getCrop(cropId);
  const last = (key: string, b: 'agromet' | 'rainfall') => {
    if (!tel) return null;
    const x = findSeries(tel.branches[b], key)?.samples.filter((v) => v.t <= tel.window.today && v.v != null).at(-1);
    return x?.v ?? null;
  };
  const tmax = last('t2m_max', 'agromet');
  const rain = last('rain', 'rainfall');
  const wind = last('wind', 'agromet');
  return (
    <div className="grid grid-cols-3 gap-2 narrow:grid-cols-2">
      <InfoCard label={t('field.crop')} onClick={() => setTab('truth')} action={t('field.addCrop')}>
        {crop ? cropName(crop.names, lang) : <span className="text-signal">{t('field.addCrop')}</span>}
      </InfoCard>
      <InfoCard label={t('field.sowing')} onClick={() => setTab('truth')} action={t('field.addSowing')}>
        {sowing ? fmtDate(sowing, lang) : <span className="text-signal">{t('field.addSowing')}</span>}
      </InfoCard>
      <InfoCard label={t('field.weather')}>
        <span className="inline-flex items-center gap-2">
          <CloudSun size={16} aria-hidden className="text-ink-3" />
          {tmax != null ? `${fmtNum(tmax, 0)} °C` : '--'}
          <span className="t-meta">{[rain != null ? `${fmtNum(rain, 1)} mm` : null, wind != null ? `${fmtNum(wind, 1)} m/s` : null].filter(Boolean).join(' · ')}</span>
        </span>
      </InfoCard>
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
  return (
    <div className="flex items-center gap-1 rounded-full bg-ink-1 p-1 text-white">
      <button type="button" aria-label={t('field.frame.prev')} disabled={!prev} onClick={() => go(prev)} className="flex size-7 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40">
        <ChevronLeft size={16} aria-hidden />
      </button>
      <span className="t-value px-1 text-sm">{fmtDate(cursor, lang)}</span>
      <button type="button" aria-label={t('field.frame.next')} disabled={!next} onClick={() => go(next)} className="flex size-7 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40">
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Left tile: the field picture with a metric selector in its corner and the legend under it. */
function PictureTile() {
  const t = useT();
  const lang = useLang();
  const focus = useMission((s) => s.focusBranch);
  const branch: BranchId = focus ?? 'vegetation';
  const raster = useMission((s) => rasterFor(s.rasters, branch));
  const titles = useMission((s) => s.telemetry?.branches);
  const pic = usePictureState(branch);
  const select = useSelectBranch();
  const title = (b: BranchId) => pick(titles?.[b]?.title ?? BRANCH_TITLES[b], lang);
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <span className="relative block aspect-square overflow-hidden rounded-md bg-ink-1">
        {pic === 'loading' ? <span className="skeleton absolute inset-6 opacity-30" aria-hidden /> : <LiveFieldCanvas branch={branch} pad={20} />}
        <label className="absolute top-2 left-2 flex items-center rounded-full bg-black/60 pr-1 text-xs font-medium text-white">
          <span className="sr-only">{t('field.metric')}</span>
          <select value={branch} onChange={(e) => select(e.target.value as BranchId)} className="h-7 max-w-[11rem] cursor-pointer appearance-none truncate rounded-full bg-transparent pr-2 pl-3 outline-offset-2">
            {BRANCHES.map((b) => (
              <option key={b} value={b} className="text-ink-1">
                {title(b)}
              </option>
            ))}
          </select>
          <ChevronRight size={12} aria-hidden className="rotate-90" />
        </label>
      </span>
      {raster ? <ScaleLegend raster={raster} compact /> : <span className="t-caption">{t('field.pic.singleNoRes')}</span>}
    </figure>
  );
}

function SatelliteTile() {
  const t = useT();
  const parcel = useMission((s) => s.parcel);
  if (!parcel) return null;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <span className="relative block aspect-square overflow-hidden rounded-md bg-ink-1">
        <SatelliteCanvas parcel={parcel} pad={20} />
        <span className="absolute top-2 left-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">{t('field.sat.title')}</span>
      </span>
      <span className="t-caption">{t('field.sat.credit')}</span>
    </figure>
  );
}

/** A chart card: the plot on the left, title, one large value and one sentence on the right. */
function ChartCard({ title, value, unit, note, children }: { title: string; value: string; unit: string; note: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_11rem] gap-4 rounded-md border border-line-1 bg-surface-0 p-4 narrow:grid-cols-1">
      <div className="min-w-0 self-center">{children}</div>
      <div className="flex flex-col gap-1 narrow:order-first">
        <h4 className="text-sm font-medium text-ink-1">{title}</h4>
        <span className="flex items-baseline gap-1">
          <span className="t-value text-2xl text-ink-1">{value}</span>
          <span className="t-unit">{unit}</span>
        </span>
        <p className="t-caption">{note}</p>
      </div>
    </section>
  );
}

function SeriesPlot({ series, samples, range, branch }: { series: Series; samples: Series['samples']; range?: [number, number]; branch: BranchId }) {
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry)!;
  const cursor = useMission((s) => s.timeline.cursor);
  return (
    <Sparkline
      samples={samples}
      domain={[telemetry.window.start, telemetry.window.end]}
      range={range}
      cadence={series.cadence}
      cursor={cursor}
      today={telemetry.window.today}
      tone={branch}
      variant="line"
      height={72}
      points={false}
      label={pick(series.label, lang)}
      unit={series.unit}
    />
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
      <ChartCard title={t('field.ndvi.card')} value={latest ? fmtNum(latest.mean, 2) : '--'} unit="NDVI" note={ndviNote}>
        <NdviChart modis={modis} bare />
      </ChartCard>
      {rain && (
        <ChartCard title={t('field.chart.rainAcc')} value={fmtNum(rainTotal, 0)} unit="mm" note={t('field.rain.short', { n: rainDays })}>
          <SeriesPlot series={rain} samples={rainAcc} range={[0, Math.max(1, rainAcc.at(-1)?.v ?? 1)]} branch="rainfall" />
        </ChartCard>
      )}
      {gdd && (
        <ChartCard title={t('field.gdd.title')} value={gddNow == null ? '--' : `+${fmtNum(gddNow, 0)}`} unit="°C·d" note={gddNote(t, lang, crop, base)}>
          <SeriesPlot series={gdd} samples={gdd.samples} range={gdd.range} branch="thermal" />
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
        <div className="grid grid-cols-2 gap-3">
          <PictureTile />
          <SatelliteTile />
        </div>
      </section>
      <StatusCharts />
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
      <CropSelect />
      <GroundTruthForm />
    </div>
  );
}

export function FieldPanel() {
  const t = useT();
  const tab = useMissionUi((s) => s.fieldTab);
  const setTab = useMissionUi((s) => s.setFieldTab);
  return (
    <div className="flex flex-col gap-4">
      <Header />
      <Tabs<FieldTab>
        ariaLabel={t('field.tabs')}
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'status', label: t('field.tab.status') },
          { value: 'report', label: t('field.tab.report') },
          { value: 'data', label: `${t('field.tab.data')} 8` },
          { value: 'truth', label: t('field.tab.truth') },
        ]}
      >
        <TabPanel value="status" className="pt-5">
          <StatusTab />
        </TabPanel>
        <TabPanel value="report" className="pt-5">
          <ReportTab />
        </TabPanel>
        <TabPanel value="data" className="pt-5">
          <DataTab />
        </TabPanel>
        <TabPanel value="truth" className="pt-5">
          <TruthTab />
        </TabPanel>
      </Tabs>
    </div>
  );
}
