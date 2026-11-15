/**
 * Field panel, step (1) of the path: a header (name, area and crop, the score, close) and three tabs,
 * one per question a grower asks of a field as it is. What to grow is step (2): the button at the
 * foot of the panel leads there.
 *   Overview           how is the field doing: one sentence, three numbers, the weather, the field by date, two charts.
 *   Soil and practice  what are its real conditions: what the grower enters, in four groups. The one
 *                      place where the crop grown today is declared.
 *   Data               where the numbers come from: the eight branches, the zones within the field.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { BRANCHES } from '@/contracts';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { scoreAt } from '@/lib/series';
import { useMission } from '@/state/mission';
import { type FieldTab, useMissionUi, useNarrow } from '@/ui/chrome/uiState';
import { IconButton, StatusTag, TabPanel, Tabs, cn } from '@/ui/design';
import { cropName, fmtNum } from '@/ui/hud/format';
import { countOverrides } from '@/ui/override';
import { CardDetail } from './CardDetail';
import { FieldReport } from './FieldReport';
import { MetricGrid, useSelectBranch } from './MetricCards';
import { ChartCard, OverviewTab } from './OverviewTab';
import { NextStep } from './NextStep';
import { SoilTab } from './SoilTab';
import { AccumChart, gddBase, gddNote, gddSeries } from './StatusCharts';
import './strings';

/** The score in a few words beside the area and crop. */
function ScoreLine() {
  const t = useT();
  const score = useMission((s) => s.score);
  const cursor = useMission((s) => s.timeline.cursor);
  const hasCrop = useMission((s) => !!s.cropId);
  const snap = scoreAt(score, cursor);
  if (!snap) return <span className="skeleton inline-block h-3 w-20 align-middle" />;
  return (
    <span className="text-ink-2">
      {/* Without a crop the number is the generic growing-conditions index, so it is not called productivity. */}
      {!hasCrop ? t('field.line.conditions') : snap.offSeason ? t('field.line.outlook') : t('field.line.productivity')} <span className="t-value text-ink-1">{Math.round(snap.productivity)}</span>
      /100
    </span>
  );
}

function Header({ workspace }: { workspace: boolean }) {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const cropId = useMission((s) => s.cropId);
  const mode = useMission((s) => s.telemetry?.mode);
  const unlock = useMission((s) => s.unlockParcel);
  if (!parcel) return null;
  const crop = getCrop(cropId);
  if (workspace) {
    const place = parcel.place && ([parcel.place.admin1, parcel.place.country].filter(Boolean).join(', ') || parcel.place.label);
    const detail = [`${fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0)} ha`, crop && cropName(crop.names, lang), place].filter(Boolean).join(' · ');
    return (
      <header className="workspace-field-header">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <h1>{parcel.name}</h1>
            {parcel.source === 'sample' && <span className="workspace-demo">{t('field.demo.tag')}</span>}
            {mode === 'mock' && <StatusTag status="simulated" compact />}
          </div>
          <IconButton label={t('field.close')} icon={<X />} size="lg" onClick={unlock} className="-mt-1 -mr-2 shrink-0 [&_svg]:size-5 [&_svg]:stroke-[1.5]" />
        </div>
        <p>{detail}</p>
      </header>
    );
  }
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
          <ScoreLine />
          {mode === 'mock' ? <StatusTag status="simulated" compact className="ml-1" /> : null}
        </p>
      </div>
      <IconButton label={t('field.close')} icon={<X />} size="lg" onClick={unlock} className="mt-1.5 -mr-2 shrink-0 [&_svg]:size-6 [&_svg]:stroke-[1.5]" />
    </header>
  );
}

/** Heat accumulated since the window opened, against the crop's base temperature. */
function HeatChart() {
  const t = useT();
  const lang = useLang();
  const telemetry = useMission((s) => s.telemetry);
  const cursor = useMission((s) => s.timeline.cursor);
  const crop = getCrop(useMission((s) => s.cropId));
  const base = gddBase(crop);
  const gdd = useMemo(() => (telemetry ? gddSeries(telemetry.branches.agromet, base) : null), [telemetry, base]);
  if (!gdd) return null;
  const now = gdd.samples.filter((s) => s.t <= cursor && s.v != null).at(-1)?.v ?? null;
  return (
    <ChartCard title={t('field.gdd.title')} value={now == null ? '--' : fmtNum(now, 0)} unit="°C·d" note={gddNote(t, lang, crop, base)}>
      <AccumChart samples={gdd.samples} color="var(--color-branch-thermal)" label={t('field.gdd.title')} />
    </ChartCard>
  );
}

/** A part of the data tab that is long and not needed by every visit: its name and one line, opened on demand. */
function Fold({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="flex flex-col gap-4 border-t border-line-1 pt-4">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex items-start gap-3 rounded-xs text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-medium text-ink-1">{title}</span>
          <span className="t-caption block">{note}</span>
        </span>
        <ChevronDown size={20} strokeWidth={1.5} aria-hidden className={cn('mt-1 shrink-0 text-ink-3 transition-transform duration-(--dur-fast)', open && 'rotate-180')} />
      </button>
      {/* Mounted only when open: the zones are computed from a year of frames. */}
      {open && <div id={id}>{children}</div>}
    </section>
  );
}

/** Which crop statistics of the country the ranking uses, or that it has none. Nothing while the table is on its way. */
function CountryCropsNote() {
  const t = useT();
  const lang = useLang();
  const table = useMission((s) => s.countryTable);
  if (table.status === 'idle' || table.status === 'loading') return null;
  // The source names countries in English: the reader's language has its own name for most of them.
  const name = table.status === 'ready' ? (new Intl.DisplayNames([lang], { type: 'region' }).of(table.iso2) ?? table.name) : '';
  return (
    <section aria-labelledby="field-country-crops" className="flex flex-col gap-1.5 border-t border-line-1 pt-4">
      <h3 id="field-country-crops" className="text-lg font-medium text-ink-1">
        {t('field.data.country')}
      </h3>
      <p className="t-caption" data-country-table={table.status}>
        {table.status === 'ready' ? t('field.data.country.ready', { name, grown: table.grown, source: table.source }) : t(table.status === 'missing' ? 'field.data.country.missing' : 'field.data.country.error')}
      </p>
    </section>
  );
}

function DataTab({ workspace }: { workspace: boolean }) {
  const t = useT();
  const focus = useMission((s) => s.focusBranch);
  const select = useSelectBranch();
  if (focus) return <CardDetail branch={focus} onBack={() => select(null)} />;
  return (
    <div className="flex flex-col gap-6">
      <MetricGrid className={workspace ? 'workspace-metric-grid' : undefined} />
      <HeatChart />
      <Fold title={t('field.data.within')} note={t('field.data.withinNote')}>
        <FieldReport />
      </Fold>
      <CountryCropsNote />
    </div>
  );
}

export function FieldPanel({ workspace = false }: { workspace?: boolean }) {
  const t = useT();
  const tab = useMissionUi((s) => s.fieldTab);
  const setTab = useMissionUi((s) => s.setFieldTab);
  const root = useRef<HTMLDivElement | null>(null);
  const parcelId = useMission((s) => s.parcel?.id);
  const entered = useMission((s) => countOverrides(s.groundTruth));
  const narrow = useNarrow();
  // A tab or a field opens at its top, wherever the previous one had been scrolled to.
  useEffect(() => {
    const scroll = workspace ? root.current?.querySelector('[data-workspace-scroll]') : root.current?.closest('[data-panel-scroll]');
    scroll?.scrollTo({ top: 0 });
  }, [tab, parcelId, workspace]);
  const badge = (n: number, label: string) => (
    <span title={label} className="flex h-6 min-w-6 items-center justify-center rounded-xs border border-signal px-1 font-normal text-signal-strong">
      {n}
      <span className="sr-only"> {label}</span>
    </span>
  );
  return (
    <div ref={root} className={cn('flex flex-col gap-5 narrow:gap-3', workspace && 'workspace-field-inner')}>
      <Header workspace={workspace} />
      <Tabs<FieldTab>
        className={workspace ? 'workspace-field-tabs' : undefined}
        activationMode={workspace ? 'manual' : 'automatic'}
        ariaLabel={t('field.tabs')}
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'overview', label: t('field.tab.overview') },
          // The tabs must fit a phone's width without scrolling the bar: the long name shortens, the fixed count goes.
          { value: 'soil', label: t(narrow ? 'field.tab.soilShort' : 'field.tab.soil'), badge: entered > 0 ? badge(entered, t('field.tab.soilCount')) : undefined },
          { value: 'data', label: t('field.tab.data'), badge: narrow ? undefined : badge(BRANCHES.length, t('field.tab.dataCount')) },
        ]}
      >
        <div data-workspace-scroll={workspace || undefined}>
          <TabPanel value="overview" className="pt-6">
            <OverviewTab workspace={workspace} />
          </TabPanel>
          <TabPanel value="soil" className="pt-6">
            <SoilTab />
          </TabPanel>
          <TabPanel value="data" className="pt-6">
            <DataTab workspace={workspace} />
          </TabPanel>
        </div>
      </Tabs>
      <NextStep className={workspace ? 'workspace-next-step-docked' : undefined} />
    </div>
  );
}
