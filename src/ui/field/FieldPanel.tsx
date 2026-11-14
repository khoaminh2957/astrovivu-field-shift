/**
 * Field panel: header with the field and its actions, then three tabs.
 *   Status        two field pictures side by side, stacked charts on one month axis, the score.
 *   Data          the eight metric cards; opening one shows its gallery of real frames.
 *   Ground truth  the override form and the calibration ledger.
 */
import { useMemo } from 'react';
import { ClipboardPen, Replace } from 'lucide-react';
import { type BranchId, type Series, pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { findSeries, primarySeries } from '@/lib/series';
import { useMission } from '@/state/mission';
import { BranchIcon, Button, Sparkline, StatusTag, TabPanel, Tabs, cn } from '@/ui/design';
import { useMissionUi } from '@/ui/chrome/uiState';
import { cropName, digitsFor, fmtDate, fmtNum, unitFor } from '@/ui/hud/format';
import { rainSum } from '@/ui/hud/readings';
import { GroundTruthForm } from '@/ui/override';
import { CardDetail } from './CardDetail';
import { FieldReport } from './FieldReport';
import { LiveFieldCanvas, ShapeThumb } from './FieldCanvas';
import { CropSelect, ScoreBlock, WhatChanged } from './FieldSummary';
import { MetricGrid, usePictureCaption, usePictureState, useSelectBranch } from './MetricCards';
import { rampGradient, rasterFor } from './picture';
import './strings';

export type FieldTab = 'status' | 'report' | 'data' | 'truth';

/** Today at the field: max temperature, rain and wind from the agromet and rainfall series. */
function WeatherChip() {
  const t = useT();
  const tel = useMission((s) => s.telemetry);
  if (!tel) return null;
  const today = tel.window.today;
  const last = (key: string, b: 'agromet' | 'rainfall') => {
    const ser = findSeries(tel.branches[b], key);
    const x = ser?.samples.filter((v) => v.t <= today && v.v != null).at(-1);
    return x?.v ?? null;
  };
  const tmax = last('t2m_max', 'agromet');
  const rain = last('rain', 'rainfall');
  const wind = last('wind', 'agromet');
  if (tmax == null && rain == null) return null;
  return (
    <span className="t-meta inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line-1 bg-surface-2 px-2.5 py-1 text-ink-2" title={t('field.weather')}>
      {tmax != null && <span>{fmtNum(tmax, 0)} °C</span>}
      {rain != null && <span>{fmtNum(rain, 1)} mm</span>}
      {wind != null && <span>{fmtNum(wind, 1)} m/s</span>}
    </span>
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
  const sowing = useMission((s) => s.groundTruth.sowingDate);
  if (!parcel) return null;
  const crop = getCrop(cropId);
  return (
    <header className="flex items-start gap-3">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-ink-1">
        <ShapeThumb parcel={parcel} size={40} light />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="t-title truncate text-lg" title={parcel.name}>
          {parcel.name}
        </h2>
        <span className="t-caption truncate">{[`${fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0)} ha`, crop ? cropName(crop.names, lang) : t('field.crop.none'), parcel.place?.label].filter(Boolean).join(' · ')}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <WeatherChip />
          {!crop && (
            <Button size="sm" variant="ghost" className="text-signal" onClick={() => setTab('status')}>
              {t('field.addCrop')}
            </Button>
          )}
          {!sowing && (
            <Button size="sm" variant="ghost" className="text-signal" onClick={() => setTab('truth')}>
              {t('field.addSowing')}
            </Button>
          )}
          {mode === 'mock' && <StatusTag status="simulated" />}
        </span>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" variant="secondary" icon={<ClipboardPen />} onClick={() => setTab('truth')}>
          <span className="narrow:sr-only">{t('field.gt')}</span>
        </Button>
        <Button size="sm" variant="secondary" icon={<Replace />} onClick={unlock}>
          <span className="narrow:sr-only">{t('field.change')}</span>
        </Button>
      </div>
    </header>
  );
}

/** A field picture tile with its title and legend, like a map card. Clicking selects the metric. */
function PictureTile({ branch }: { branch: BranchId }) {
  const lang = useLang();
  const raster = useMission((s) => rasterFor(s.rasters, branch));
  const title = useMission((s) => s.telemetry?.branches[branch]?.title);
  const active = useMission((s) => s.focusBranch === branch);
  const pic = usePictureState(branch);
  const caption = usePictureCaption(branch);
  const select = useSelectBranch();
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => select(branch)}
      className={cn('flex min-w-0 flex-col gap-1.5 rounded-md border bg-surface-0 p-2 text-left shadow-sm', active ? 'border-signal' : 'border-line-1 hover:border-line-2')}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-ink-1">
        <BranchIcon branch={branch} size={14} colored />
        <span className="truncate">{raster ? pick(raster.label, lang) : title ? pick(title, lang) : branch}</span>
      </span>
      <span className="relative block aspect-square overflow-hidden rounded-sm bg-ink-1">
        {pic === 'loading' ? <span className="skeleton absolute inset-3 opacity-30" aria-hidden /> : <LiveFieldCanvas branch={branch} pad={12} />}
      </span>
      {raster && <span aria-hidden className="h-1.5 rounded-full" style={{ background: rampGradient(raster.ramp) }} />}
      <span className="t-caption truncate">{caption}</span>
    </button>
  );
}

function Chart({ series, accumulate, branch, note }: { series: Series; accumulate?: boolean; branch: BranchId; note?: string }) {
  const lang = useLang();
  const t = useT();
  const telemetry = useMission((s) => s.telemetry)!;
  const cursor = useMission((s) => s.timeline.cursor);
  // Accumulated rainfall from the window start, so the chart reads like a season total.
  const samples = useMemo(() => {
    if (!accumulate) return series.samples;
    let sum = 0;
    return series.samples.map((s) => ({ ...s, v: s.v == null ? null : (sum += s.v) }));
  }, [series, accumulate]);
  const range = useMemo<[number, number] | undefined>(() => (accumulate ? [0, Math.max(1, ...samples.map((s) => s.v ?? 0))] : series.range), [accumulate, samples, series.range]);
  const at = [...samples].reverse().find((s) => s.t <= cursor && s.v != null)?.v;
  const value = accumulate ? rainSum(series.samples, cursor, 9999) : at;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink-1">{accumulate ? t('field.chart.rainAcc') : pick(series.label, lang)}</span>
        <span className="flex items-baseline gap-1">
          <span className="t-value text-base text-ink-1">{fmtNum(value, accumulate ? 0 : digitsFor(series.unit, series.key))}</span>
          <span className="t-unit">{accumulate ? 'mm' : unitFor(series.unit, series.key)}</span>
        </span>
      </div>
      {note && <p className="t-caption -mt-0.5">{note}</p>}
      <Sparkline
        samples={samples}
        domain={[telemetry.window.start, telemetry.window.end]}
        range={range}
        cadence={series.cadence}
        baseline={accumulate ? undefined : series.baseline}
        cursor={cursor}
        today={telemetry.window.today}
        tone={branch}
        variant="line"
        provenance={telemetry.mode === 'mock' ? 'simulated' : undefined}
        height={56}
        points={false}
        label={accumulate ? t('field.chart.rainAcc') : pick(series.label, lang)}
        unit={accumulate ? 'mm' : series.unit}
      />
    </div>
  );
}

/** One plain sentence per chart, from our own data over the window. */
function chartNotes(veg: Series | undefined, rain: Series | undefined, temp: Series | undefined, t: (k: string, v?: Record<string, string | number>) => string) {
  const vals = (s?: Series) => (s?.samples ?? []).filter((x) => x.v != null) as { t: string; v: number }[];
  const out: { veg?: string; rain?: string; temp?: string } = {};
  const v = vals(veg);
  if (v.length) {
    const mean = v.reduce((a, x) => a + x.v, 0) / v.length;
    const peak = v.reduce((a, x) => (x.v > a.v ? x : a));
    out.veg = t('field.chart.vegNote', { m: fmtNum(mean, 2), p: fmtNum(peak.v, 2), n: v.length });
  }
  const r = vals(rain);
  if (r.length) {
    const days = r.length;
    const wet = r.filter((x) => x.v >= 1).length;
    out.rain = t('field.chart.rainNote', { n: days, w: wet });
  }
  const m = vals(temp);
  if (m.length) {
    const ok = m.filter((x) => x.v >= 10 && x.v <= 30).length;
    out.temp = t('field.chart.tempNote', { k: ok, n: m.length });
  }
  return out;
}

function StatusTab() {
  const t = useT();
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry);
  const cursor = useMission((s) => s.timeline.cursor);
  const focus = useMission((s) => s.focusBranch);
  const left: BranchId = focus ?? 'vegetation';
  const right: BranchId = left === 'soilMoisture' ? 'vegetation' : 'soilMoisture';
  const veg = telemetry ? primarySeries(telemetry.branches.vegetation) : undefined;
  const rain = telemetry ? (findSeries(telemetry.branches.rainfall, 'rain') ?? primarySeries(telemetry.branches.rainfall)) : undefined;
  const temp = telemetry ? (findSeries(telemetry.branches.agromet, 't2m_max') ?? findSeries(telemetry.branches.agromet, 't2m')) : undefined;
  const notes = useMemo(() => chartNotes(veg, rain, temp, t), [veg, rain, temp, t]);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h3 className="t-title text-lg">{t('field.status.pictures')}</h3>
          <span className="t-meta">{fmtDate(cursor, lang)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PictureTile branch={left} />
          <PictureTile branch={right} />
        </div>
      </section>
      <ScoreBlock />
      <CropSelect />
      {telemetry && (
        <section className="flex flex-col gap-4">
          <h3 className="t-title text-lg">{t('field.status.charts')}</h3>
          {veg && <Chart series={veg} branch="vegetation" note={notes.veg} />}
          {rain && <Chart series={rain} branch="rainfall" accumulate note={notes.rain} />}
          {temp && <Chart series={temp} branch="thermal" note={notes.temp} />}
        </section>
      )}
      <WhatChanged />
    </div>
  );
}

function DataTab() {
  const t = useT();
  const focus = useMission((s) => s.focusBranch);
  const select = useSelectBranch();
  if (focus) return <CardDetail branch={focus} onBack={() => select(null)} />;
  return (
    <div className="flex flex-col gap-3">
      <p className="t-caption">{t('field.metrics.lede')}</p>
      <MetricGrid />
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
          <FieldReport />
        </TabPanel>
        <TabPanel value="data" className="pt-5">
          <DataTab />
        </TabPanel>
        <TabPanel value="truth" className="pt-5">
          <GroundTruthForm />
        </TabPanel>
      </Tabs>
    </div>
  );
}
