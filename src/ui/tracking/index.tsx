/**
 * State 6: long-term tracking. Season history, vegetation year over year, the field journal (the
 * farmer's own entries persist per parcel in this browser), soil tests, alerts and plan against
 * actual money. Demo history is simulated and labelled wherever it appears.
 */
import { type FormEvent, useMemo, useState } from 'react';
import { BookOpen, FlaskConical, History, MapPinned, Trash2 } from 'lucide-react';
import type { JournalEntry, Lang, Sample, TrackingData } from '@/contracts';
import { pick, tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { dayOfYear, todayISO } from '@/lib/time';
import { useMission } from '@/state/mission';
import { Button, EmptyState, Field, IconButton, Input, Panel, Select, StatusGlyph, StatusTag, Tag, Textarea, cn } from '@/ui/design';
import { useFixture } from '@/ui/advisory/fixture';
import { type CurrencyCode, fmtDate, fmtNum, monthShort, money } from '@/ui/advisory/format';
import { BranchName, CurrencySwitch, FixtureTag } from '@/ui/advisory/shared';
import { useOwnJournal } from './journal';
import './strings';

const EMPTY: TrackingData = { parcelId: '', simulated: false, seasons: [], journal: [], soilTests: [], alerts: [], planVsActual: [], ndviByYear: [] };

function cropLabel(id: string, lang: Lang): string {
  const c = getCrop(id);
  return c ? (lang === 'vi' && c.names.vi ? c.names.vi : c.names.en) : id;
}

export function TrackingView() {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const live = useMission((s) => s.tracking);
  const telemetry = useMission((s) => s.telemetry);
  const gtCurrency = useMission((s) => s.groundTruth.currency);
  const setPhase = useMission((s) => s.setPhase);
  const [currency, setCurrency] = useState<CurrencyCode>(gtCurrency ?? (lang === 'vi' ? 'VND' : 'USD'));
  const fixture = useFixture(import.meta.env.DEV ? () => import('./__fixtures__/tracking').then((m) => m.TRACKING_FIXTURE) : null);
  const data = fixture ?? live ?? EMPTY;
  const own = useOwnJournal(parcel?.id ?? null);

  const observedNdvi = useMemo(() => {
    const s = telemetry?.branches.vegetation.series.find((x) => x.key === 'ndvi');
    if (!s) return null;
    const year = (telemetry?.window.today ?? todayISO()).slice(0, 4);
    return { samples: s.samples.filter((p) => p.t.startsWith(year)), sourceId: s.sourceId, year: Number(year) };
  }, [telemetry]);

  return (
    <main aria-labelledby="trk-title" className="fixed inset-x-0 top-(--topbar-h) bottom-0 z-(--z-panel) overflow-y-auto bg-surface-0">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-6 pt-5 pb-28 compact:px-4 compact:pt-4">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 id="trk-title" className="t-title text-2xl leading-8">
            {t('tracking.title')}
          </h1>
          {parcel && <span className="text-base text-ink-2">{parcel.name}</span>}
          {data.simulated && <StatusTag status="simulated" label={t('tracking.simHistory')} />}
          {fixture && <FixtureTag />}
          <span className="ml-auto">
            <CurrencySwitch value={currency} onChange={setCurrency} />
          </span>
        </header>
        {data.simulated && <p className="max-w-[96ch] text-sm text-ink-2">{t('tracking.simNote')}</p>}

        {!parcel ? (
          <EmptyState icon={<MapPinned />} title={t('tracking.noField')} body={t('tracking.noFieldBody')} action={<Button variant="primary" onClick={() => setPhase('explore')}>{t('tracking.pickField')}</Button>} />
        ) : (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <Panel title={t('tracking.seasons')} meta={data.seasons.length ? String(data.seasons.length) : undefined}>
                <SeasonsTable data={data} currency={currency} />
              </Panel>
              <Panel title={t('tracking.ndvi')} meta="NDVI">
                <NdviYears data={data} observed={observedNdvi} />
              </Panel>
              <Panel title={t('tracking.planActual')}>
                <PlanActual data={data} currency={currency} />
              </Panel>
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <Panel title={t('tracking.alerts')} meta={data.alerts.length ? String(data.alerts.length) : undefined}>
                <Alerts data={data} />
              </Panel>
              <Panel title={t('tracking.journal')}>
                <Journal generated={data.journal} own={own} />
              </Panel>
              <Panel title={t('tracking.soilTests')}>
                <SoilTests data={data} />
              </Panel>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const SimMark = ({ on }: { on: boolean }) => (on ? <StatusTag status="simulated" compact /> : null);

function SeasonsTable({ data, currency }: { data: TrackingData; currency: CurrencyCode }) {
  const t = useT();
  const lang = useLang();
  if (!data.seasons.length) return <EmptyState layout="inline" icon={<History />} title={t('tracking.noSeasons')} body={t('tracking.noSeasonsBody')} />;
  const rows = [...data.seasons].sort((a, b) => (a.start < b.start ? 1 : -1));
  const m = (v?: number) => money(v ?? null, currency, lang, { compact: true });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-2 text-left">
            {['season', 'crop', 'yield', 'revenue', 'cost', 'margin', 'ndviPeak', 'rain'].map((k, i) => (
              <th key={k} scope="col" className={cn('t-label py-1.5 pr-3 font-medium', i > 1 && 'text-right')}>
                {t(`tracking.col.${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const margin = s.revenueUsd != null && s.costUsd != null ? s.revenueUsd - s.costUsd : undefined;
            return (
              <tr key={s.id} className="border-b border-line-1">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink-1">
                  <span className="inline-flex items-center gap-1.5">
                    <SimMark on={s.simulated} />
                    {pick(s.label, lang)}
                  </span>
                </th>
                <td className="py-1.5 pr-3 text-ink-2">{cropLabel(s.cropId, lang)}</td>
                <td className="t-value py-1.5 pr-3 text-right text-ink-1">
                  {fmtNum(s.yieldTHa, lang, 1)} <span className="t-unit">t/ha</span>
                </td>
                <td className="t-value py-1.5 pr-3 text-right text-ink-1">{m(s.revenueUsd).value}</td>
                <td className="t-value py-1.5 pr-3 text-right text-ink-2">{m(s.costUsd).value}</td>
                <td className="t-value py-1.5 pr-3 text-right text-ink-1">{m(margin).value}</td>
                <td className="t-value py-1.5 pr-3 text-right text-ink-2">{fmtNum(s.ndviPeak, lang, 2)}</td>
                <td className="t-value py-1.5 text-right text-ink-2">
                  {fmtNum(s.rainMm, lang)} <span className="t-unit">mm</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="t-caption mt-1.5">{t('tracking.moneyUnit', { unit: m(0).unit })}</p>
    </div>
  );
}

function NdviYears({ data, observed }: { data: TrackingData; observed: { samples: Sample[]; sourceId: string; year: number } | null }) {
  const t = useT();
  const lang = useLang();
  const years = [...data.ndviByYear].sort((a, b) => a.year - b.year);
  const hasObserved = observed != null && observed.samples.some((s) => s.v != null);
  if (!years.length && !hasObserved) return <EmptyState layout="inline" title={t('tracking.noNdvi')} body={t('tracking.noNdviBody')} />;
  const W = 600;
  const H = 180;
  const pad = { l: 28, r: 8, t: 8, b: 18 };
  const all = [...years.flatMap((y) => y.samples), ...(hasObserved ? observed!.samples : [])].map((s) => s.v).filter((v): v is number => v != null);
  const lo = Math.max(0, Math.floor((Math.min(...all) - 0.05) * 10) / 10);
  const hi = Math.min(1, Math.ceil((Math.max(...all) + 0.05) * 10) / 10);
  const x = (doy: number) => pad.l + ((doy - 1) / 365) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const path = (ss: Sample[]) => {
    let d = '';
    let pen = false;
    for (const s of ss) {
      if (s.v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(dayOfYear(s.t)).toFixed(1)},${y(s.v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const latest = years.at(-1)?.year;
  const ink = (yr: number) => (yr === latest && !hasObserved ? 'var(--color-ink-1)' : yr === latest ? 'var(--color-ink-2)' : 'var(--color-ink-4)');
  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <figure className="m-0 flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('tracking.ndviSummary', { years: years.map((y) => y.year).join(', ') })}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-line-1)" />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {Array.from({ length: 12 }, (_, i) => (
          <text key={i} x={x(dayOfYear(`2025-${String(i + 1).padStart(2, '0')}-01`)) + 2} y={H - 4} fontSize={10} fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
            {monthShort(i + 1, lang)}
          </text>
        ))}
        {years.map((yr) => (
          <path
            key={yr.year}
            d={path(yr.samples)}
            fill="none"
            stroke={ink(yr.year)}
            strokeWidth={yr.year === latest ? 1.75 : 1.25}
            strokeLinecap="round"
            strokeDasharray={yr.simulated ? '0.1 3.2' : undefined}
          />
        ))}
        {hasObserved && <path d={path(observed!.samples)} fill="none" stroke="var(--color-signal)" strokeWidth={1.75} />}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {years.map((yr) => (
          <span key={yr.year} className="t-caption inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="1" x2="17" y1="3" y2="3" stroke={ink(yr.year)} strokeWidth="2" strokeLinecap="round" strokeDasharray={yr.simulated ? '0.1 3.2' : undefined} />
            </svg>
            <span className="t-value">{yr.year}</span>
            {yr.simulated && <span className="text-simulated">{t('tracking.sim')}</span>}
          </span>
        ))}
        {hasObserved && (
          <span className="t-caption inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 bg-signal" />
            {t('tracking.observed', { year: observed!.year })}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function PlanActual({ data, currency }: { data: TrackingData; currency: CurrencyCode }) {
  const t = useT();
  const lang = useLang();
  if (!data.planVsActual.length) return <EmptyState layout="inline" title={t('tracking.noPlan')} body={t('tracking.noPlanBody')} />;
  const m = (v: number | null) => money(v, currency, lang, { compact: true }).value;
  const rows = [...data.planVsActual].sort((a, b) => a.month - b.month);
  const done = rows.filter((r) => r.actualCostUsd != null);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const planCost = sum(done.map((r) => r.plannedCostUsd));
  const actCost = sum(done.map((r) => r.actualCostUsd));
  const planRev = sum(done.map((r) => r.plannedRevenueUsd));
  const actRev = sum(done.map((r) => r.actualRevenueUsd));
  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {[
          ['costPlan', planCost],
          ['costActual', actCost],
          ['revPlan', planRev],
          ['revActual', actRev],
        ].map(([k, v]) => (
          <div key={k as string} className="flex flex-col">
            <dt className="t-label">{t(`tracking.${k}`)}</dt>
            <dd className="t-value m-0 text-xl text-ink-1">
              {m(v as number)} <span className="t-unit">{money(0, currency, lang, { compact: true }).unit}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="t-caption">{t('tracking.toDate', { n: done.length })}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-2">
              {['month', 'costPlan', 'costActual', 'revPlan', 'revActual'].map((k, i) => (
                <th key={k} scope="col" className={cn('t-label py-1.5 pr-3 font-medium', i === 0 ? 'text-left' : 'text-right')}>
                  {t(`tracking.${k === 'month' ? 'col.month' : k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const over = r.actualCostUsd != null && r.plannedCostUsd > 0 && r.actualCostUsd > r.plannedCostUsd * 1.15;
              return (
                <tr key={r.month} className="border-b border-line-1">
                  <th scope="row" className="py-1 pr-3 text-left font-medium text-ink-1">
                    {monthShort(r.month, lang)}
                  </th>
                  <td className="t-value py-1 pr-3 text-right text-ink-3">{m(r.plannedCostUsd)}</td>
                  <td className={cn('t-value py-1 pr-3 text-right', over ? 'text-watch' : 'text-ink-1')}>
                    {over && <StatusGlyph status="watch" size={9} className="mr-1 inline" />}
                    {m(r.actualCostUsd)}
                  </td>
                  <td className="t-value py-1 pr-3 text-right text-ink-3">{m(r.plannedRevenueUsd)}</td>
                  <td className="t-value py-1 text-right text-ink-1">{m(r.actualRevenueUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="t-caption">{t('tracking.overNote')}</p>
    </div>
  );
}

function Alerts({ data }: { data: TrackingData }) {
  const t = useT();
  const lang = useLang();
  if (!data.alerts.length) return <EmptyState layout="inline" title={t('tracking.noAlerts')} body={t('tracking.noAlertsBody')} />;
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {[...data.alerts]
        .sort((a, b) => (a.t < b.t ? 1 : -1))
        .map((a) => (
          <li key={a.id} className="grid grid-cols-[14px_1fr] gap-x-2 border-b border-line-1 py-2 last:border-b-0">
            <StatusGlyph status={a.severity === 'info' ? 'info' : a.severity} className="mt-1" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-ink-1">{pick(a.title, lang)}</span>
                <span className="t-meta">{fmtDate(a.t, lang)}</span>
              </div>
              <p className="text-sm text-ink-2">{pick(a.body, lang)}</p>
              {a.branch && <BranchName branch={a.branch} />}
            </div>
          </li>
        ))}
    </ol>
  );
}

const KINDS: JournalEntry['kind'][] = ['operation', 'scouting', 'note', 'harvest', 'soil-test'];

function Journal({ generated, own }: { generated: JournalEntry[]; own: ReturnType<typeof useOwnJournal> }) {
  const t = useT();
  const lang = useLang();
  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState<JournalEntry['kind']>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const entries = [...own.entries, ...generated].sort((a, b) => (a.t < b.t ? 1 : -1));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    // The farmer's words are stored once and shown in either language as written.
    own.add({ t: date, kind, title: tx(title.trim()), body: body.trim() ? tx(body.trim()) : undefined });
    setTitle('');
    setBody('');
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 border-b border-line-1 pb-3">
        <Field label={t('tracking.j.date')} htmlFor="j-date">
          <Input id="j-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('tracking.j.kind')} htmlFor="j-kind">
          <Select id="j-kind" value={kind} onValueChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`tracking.kind.${k}`) }))} />
        </Field>
        <Field label={t('tracking.j.title')} htmlFor="j-title" className="col-span-2">
          <Input id="j-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tracking.j.titlePh')} />
        </Field>
        <Field label={t('tracking.j.body')} htmlFor="j-body" className="col-span-2">
          <Textarea id="j-body" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="col-span-2 flex items-center justify-between gap-2">
          <span className="t-caption">{t('tracking.j.stored')}</span>
          <Button type="submit" variant="primary" size="sm" disabled={!title.trim()}>
            {t('tracking.j.add')}
          </Button>
        </div>
      </form>
      {entries.length === 0 ? (
        <EmptyState layout="inline" icon={<BookOpen />} title={t('tracking.j.empty')} body={t('tracking.j.emptyBody')} />
      ) : (
        <ol className="m-0 flex max-h-96 list-none flex-col overflow-y-auto p-0">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2 border-b border-line-1 py-2 last:border-b-0">
              <span className="t-meta w-20 shrink-0 pt-0.5">{fmtDate(e.t, lang)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-ink-1">{pick(e.title, lang)}</span>
                  <Tag>{t(`tracking.kind.${e.kind}`)}</Tag>
                  {e.simulated ? <StatusTag status="simulated" /> : <Tag tone="ground-truth">{t('tracking.j.yours')}</Tag>}
                </div>
                {e.body && <p className="text-sm text-ink-2">{pick(e.body, lang)}</p>}
              </div>
              {!e.simulated && e.id.startsWith('own-') && <IconButton size="sm" label={t('tracking.j.delete')} icon={<Trash2 />} onClick={() => own.remove(e.id)} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SoilTests({ data }: { data: TrackingData }) {
  const t = useT();
  const lang = useLang();
  if (!data.soilTests.length) return <EmptyState layout="inline" icon={<FlaskConical />} title={t('tracking.noSoil')} body={t('tracking.noSoilBody')} />;
  const tests = [...data.soilTests].sort((a, b) => (a.t < b.t ? -1 : 1));
  const keys = [...new Map(tests.flatMap((x) => x.values.map((v) => [v.key, v] as const))).values()];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-2">
            <th scope="col" className="t-label py-1.5 pr-3 text-left font-medium">
              {t('tracking.soilValue')}
            </th>
            {tests.map((x) => (
              <th key={x.t} scope="col" className="py-1.5 pr-3 text-right font-medium">
                <span className="t-value block text-xs text-ink-1">{fmtDate(x.t, lang)}</span>
                <span className="t-meta inline-flex items-center gap-1">
                  {x.simulated && <StatusTag status="simulated" compact />}
                  {x.lab}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.key} className="border-b border-line-1 last:border-b-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-2">
                {pick(k.label, lang)} {k.unit && <span className="t-unit">{k.unit}</span>}
              </th>
              {tests.map((x) => {
                const v = x.values.find((y) => y.key === k.key);
                return (
                  <td key={x.t} className="py-1.5 pr-3 text-right">
                    <span className="t-value text-ink-1">{v ? fmtNum(v.value, lang, v.value < 10 ? (v.value < 1 ? 2 : 1) : 0) : '--'}</span>
                    {v && <span className={cn('ml-1.5 text-2xs', v.rating === 'optimal' ? 'text-ink-3' : 'text-watch')}>{t(`tracking.rating.${v.rating}`)}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
