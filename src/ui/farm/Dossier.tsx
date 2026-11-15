/**
 * The dossier: the last section of the rotation page (docs/FARM.md §6). It lays out, on one sheet
 * that can be printed, how the answer for this field was reached: what was read, how it was scored,
 * which crops and rotations were compared, and what follows. It computes nothing new: every figure
 * is one the page already shows somewhere, drawn here in the order the work is done.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { type AdvisoryReport, BRANCHES, type RotationStrategy, pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { cropLook, farmSceneAt } from '@/core/farm';
import { rankCrops } from '@/core/scoring';
import { useLang, useT } from '@/i18n';
import { scoreAt } from '@/lib/series';
import { toModelInput, useMission } from '@/state/mission';
import { type CurrencyCode, cropNameOnly, monthSpan } from '@/ui/advisory/format';
import { METRICS, goodness, metricAxis, metricUnit, metricValue } from '@/ui/advisory/metrics';
import { LocalReviewTag } from '@/ui/advisory/shared';
import '@/ui/advisory/strings';
import { Button, ProvenanceTag, StatusGlyph, cn } from '@/ui/design';
import { fmtDate, fmtNum } from '@/ui/hud/format';
import { FactorBars, RangeBar, Tile, YearClimate, YearScore } from './charts';
import { PlantIcon } from './plants';
import { useFarmYear } from './year';
import './strings';

/** The criteria of the comparison table, in reading order. */
const COMPARE = ['margin', 'waterUse', 'soilHealth', 'risk'] as const;

function Step({ n, title, sub, children, last }: { n: number; title: string; sub: string; children: ReactNode; last?: boolean }) {
  return (
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 break-inside-avoid">
      <div className="flex flex-col items-center">
        <span className="t-value flex size-9 shrink-0 items-center justify-center rounded-full bg-signal text-base font-bold text-on-signal">{n}</span>
        {!last && <span aria-hidden className="w-px flex-1 bg-line-2" />}
      </div>
      <div className={cn('flex min-w-0 flex-col gap-3', !last && 'pb-8')}>
        <div className="flex flex-col pt-1">
          <h3 className="text-lg leading-6 font-semibold text-ink-1">{title}</h3>
          <p className="t-caption">{sub}</p>
        </div>
        {children}
      </div>
    </li>
  );
}

export interface DossierProps {
  report: AdvisoryReport | null;
  rotations: RotationStrategy[];
  current: RotationStrategy | null;
  selected: RotationStrategy | null;
  bestId: string | null;
  currency: CurrencyCode;
}

export function Dossier({ report, rotations, current, selected, bestId, currency }: DossierProps) {
  const t = useT();
  const lang = useLang();
  const parcel = useMission((s) => s.parcel);
  const telemetry = useMission((s) => s.telemetry);
  const cropId = useMission((s) => s.cropId);
  const groundTruth = useMission((s) => s.groundTruth);
  const priorities = useMission((s) => s.priorities);
  const countryTable = useMission((s) => s.countryTable);
  const score = useMission((s) => s.score);
  const [printing, setPrinting] = useState(false);

  const input = useMemo(() => toModelInput({ parcel, telemetry, cropId, groundTruth, priorities, countryTable }), [parcel, telemetry, cropId, groundTruth, priorities, countryTable]);
  const year = useFarmYear(input, score);
  // The ranking scores the whole catalogue: worked out once the sheet is on the page.
  const [ranking, setRanking] = useState<ReturnType<typeof rankCrops> | null>(null);
  useEffect(() => {
    setRanking(null);
    if (!input) return;
    const id = setTimeout(() => setRanking(rankCrops(input, { limit: 6 })), 400);
    return () => clearTimeout(id);
  }, [input]);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    // The attribute must be on the page before the print dialog reads the styles.
    const id = setTimeout(() => window.print(), 60);
    return () => {
      clearTimeout(id);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  if (!parcel || !telemetry || !input || !score) return null;

  const today = telemetry.window.today;
  const scene = farmSceneAt(input, score, today);
  const snap = scoreAt(score, today);
  const crop = getCrop(input.cropId);
  const nameOf = (id: string): string => {
    const c = getCrop(id);
    return c ? (lang === 'vi' && c.names.vi ? c.names.vi : c.names.en) : id;
  };
  const sources = Object.values(telemetry.sources);
  const used = new Set(BRANCHES.flatMap((b) => telemetry.branches[b].sources));
  const usedSources = sources.filter((s) => used.has(s.id));
  const seriesCount = BRANCHES.reduce((n, b) => n + telemetry.branches[b].series.length, 0);
  const baselineCount = BRANCHES.reduce((n, b) => n + telemetry.branches[b].series.filter((s) => s.baseline?.length).length, 0);
  const metrics = COMPARE.map((k) => METRICS.find((m) => m.key === k)!);
  const advisories = [...(report?.advisories ?? [])].sort((a, b) => a.priority - b.priority).slice(0, 5);
  const s = scene.soil;
  const span = s.usual ? s.usual[1] - s.usual[0] : 0.1;
  const rel = score.summary.reliability;
  const place = [parcel.place?.admin1, parcel.place?.country].filter(Boolean).join(', ') || parcel.place?.label || `${fmtNum(parcel.centroid[1], 3)}°, ${fmtNum(parcel.centroid[0], 3)}°`;

  return (
    <section aria-labelledby="farm-dossier" className="flex flex-col gap-6 rounded-md border border-line-2 bg-surface-1 p-6 compact:p-4 narrow:p-3 print:border-0 print:bg-white print:p-0" data-farm-dossier data-printing={printing}>
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-line-1 pb-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="t-label">{t('farm.dossier.kicker')}</span>
          <h2 id="farm-dossier" className="text-2xl leading-8 font-bold text-ink-1">
            {parcel.name}
          </h2>
          <p className="text-sm text-ink-2">
            {place} · {fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0)} ha · {crop ? nameOf(crop.id) : t('farm.bare')} · {fmtDate(today, lang)}
          </p>
          <p className="t-caption max-w-[60ch]">{t('farm.dossier.lead')}</p>
        </div>
        <Button variant="secondary" icon={<Printer />} onClick={() => setPrinting(true)} className="print:hidden">
          {t('farm.dossier.print')}
        </Button>
      </header>

      <ol className="flex flex-col">
        <Step n={1} title={t('farm.dossier.s1')} sub={t('farm.dossier.s1sub', { n: usedSources.length, series: seriesCount })}>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
            {BRANCHES.map((b) => {
              const br = telemetry.branches[b];
              const first = telemetry.sources[br.sources[0]];
              return (
                <li key={b} className="flex items-start gap-2 rounded-sm border border-line-1 bg-surface-0 px-3 py-2">
                  <StatusGlyph status={br.status === 'ok' ? 'nominal' : br.status === 'partial' ? 'watch' : 'alert'} className="mt-1" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-ink-1">{pick(br.title, lang)}</span>
                    <span className="truncate text-xs text-ink-2" title={br.sources.map((id) => telemetry.sources[id]?.name ?? id).join(', ')}>
                      {first ? first.name : t('farm.dossier.noSource')}
                      {br.sources.length > 1 ? ` +${br.sources.length - 1}` : ''}
                    </span>
                    {first && <ProvenanceTag provenance={first.provenance} className="mt-1 self-start" />}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="t-caption">{t('farm.dossier.s1note', { start: fmtDate(telemetry.window.start, lang), end: fmtDate(today, lang), n: baselineCount })}</p>
        </Step>

        <Step n={2} title={t('farm.dossier.s2')} sub={t('farm.dossier.s2sub')}>
          <div className="grid gap-4 lg:grid-cols-2">
            <figure className="flex flex-col gap-1 rounded-sm border border-line-1 bg-surface-0 p-3">
              <figcaption className="text-sm font-medium text-ink-1">{t('farm.dossier.climate')}</figcaption>
              <YearClimate months={year} lang={lang} label={t('farm.dossier.climate')} />
              <span className="t-caption">{t('farm.deep.yearSub')}</span>
            </figure>
            <figure className="flex flex-col gap-1 rounded-sm border border-line-1 bg-surface-0 p-3">
              <figcaption className="text-sm font-medium text-ink-1">{t('farm.dossier.scoreYear')}</figcaption>
              <YearScore months={year} lang={lang} label={t('farm.dossier.scoreYear')} />
              <span className="t-caption">{t('farm.deep.scoreYearSub')}</span>
            </figure>
          </div>
        </Step>

        <Step n={3} title={t('farm.dossier.s3')} sub={t('farm.dossier.s3sub')}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="grid grid-cols-2 content-start gap-2">
              <Tile label={t('farm.dossier.scoreNow')} value={snap ? `${Math.round(snap.productivity)}/100` : '--'} />
              <Tile label={t('farm.dossier.scoreMean')} value={`${Math.round(score.summary.productivityMean)}/100`} />
              <Tile label={t('farm.dossier.fit')} value={score.summary.compatibility != null ? `${Math.round(score.summary.compatibility)}/100` : '--'} note={crop ? nameOf(crop.id) : undefined} />
              <Tile label={t('farm.dossier.reliability')} value={rel ? `${rel.yearsOk}/${rel.yearsTotal}` : '--'} note={rel ? t('farm.dossier.reliabilityNote') : undefined} />
            </div>
            <div className="flex flex-col gap-2 rounded-sm border border-line-1 bg-surface-0 p-3">
              <span className="text-sm font-medium text-ink-1">{t('farm.deep.factors')}</span>
              {snap && snap.factors.length > 0 ? (
                <FactorBars
                  rows={snap.factors
                    .filter((f) => f.weight > 0 || f.limiting)
                    .slice(0, 9)
                    .map((f) => ({ key: f.key, label: pick(f.label, lang), score: f.score, limiting: f.key === snap.limiting, note: `${f.actual ?? '--'}${f.unit ? ` ${f.unit}` : ''} · ${t('farm.deep.ideal')} ${f.ideal}` }))}
                />
              ) : (
                <p className="t-caption">{t('farm.dossier.noFactors')}</p>
              )}
              {scene.limiting && <p className="t-caption">{t('farm.deep.limiting', { f: pick(scene.limiting, lang) })}</p>}
            </div>
          </div>
        </Step>

        <Step n={4} title={t('farm.dossier.s4')} sub={t('farm.dossier.s4sub')}>
          {ranking == null ? (
            <p className="t-caption">{t('farm.dossier.ranking')}</p>
          ) : ranking.length === 0 ? (
            <p className="t-caption">{t('farm.dossier.noRanking')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {ranking.map((r, i) => {
                const mine = r.cropId === input.cropId;
                return (
                  <li key={r.cropId} className={cn('grid grid-cols-[1.5rem_2.25rem_minmax(0,11rem)_minmax(0,1fr)_3rem] items-center gap-2 rounded-sm px-2 py-1', mine && 'bg-signal/10')}>
                    <span className="t-value text-sm text-ink-3">{i + 1}</span>
                    <PlantIcon look={cropLook(getCrop(r.cropId))} size={32} />
                    <span className="flex min-w-0 flex-col">
                      <span className={cn('truncate text-sm', mine ? 'font-semibold text-ink-1' : 'text-ink-1')}>{nameOf(r.cropId)}</span>
                      {mine && <span className="text-[11px] text-signal-strong">{t('farm.dossier.yours')}</span>}
                    </span>
                    <span className="relative h-2.5 rounded-full bg-surface-3">
                      <span className={cn('absolute inset-y-0 left-0 rounded-full', mine ? 'bg-signal' : 'bg-signal/50')} style={{ width: `${Math.round(r.rankScore * 100)}%` }} />
                    </span>
                    <span className="t-value text-right text-sm text-ink-1">{Math.round(r.rankScore * 100)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Step>

        <Step n={5} title={t('farm.dossier.s5')} sub={t('farm.dossier.s5sub', { n: rotations.length })}>
          {rotations.length === 0 ? (
            <p className="t-caption">{t('farm.dossier.noRotations')}</p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[40rem] border-separate border-spacing-y-1 text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="px-2 py-1 font-medium">{t('farm.dossier.strategy')}</th>
                    <th className="px-2 py-1 font-medium">{t('farm.score')}</th>
                    {metrics.map((m) => (
                      <th key={m.key} className="px-2 py-1 font-medium">
                        {t(`advisory.metric.${m.key}`)}
                        <span className="block font-normal">{metricUnit(m, lang, currency)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rotations.map((r) => {
                    const on = r.id === selected?.id;
                    return (
                      <tr key={r.id} className={cn(on ? 'bg-signal/10' : 'bg-surface-0')} data-selected={on}>
                        <td className="rounded-l-sm px-2 py-2">
                          <span className="flex items-center gap-2">
                            <span className="flex shrink-0" aria-hidden>
                              {[...new Set(r.seasons.map((x) => x.cropId))].slice(0, 3).map((id) => (
                                <PlantIcon key={id} look={id === 'fallow' ? 'none' : cropLook(getCrop(id))} size={26} />
                              ))}
                            </span>
                            <span className="flex min-w-0 flex-col">
                              <span className="flex flex-wrap items-center gap-1.5 font-medium text-ink-1">
                                {pick(r.name, lang)}
                                {r.id === current?.id && <span className="rounded-xs bg-surface-3 px-1 text-[10px] font-medium text-ink-2">{t('farm.dossier.today')}</span>}
                                {r.id === bestId && <span className="rounded-xs bg-signal/15 px-1 text-[10px] font-semibold text-signal-strong">{t('farm.rotation.best')}</span>}
                                {on && <span className="rounded-xs bg-ink-1 px-1 text-[10px] font-semibold text-surface-0">{t('farm.dossier.chosen')}</span>}
                              </span>
                              <span className="truncate text-xs text-ink-3">{r.seasons.filter((x) => (x.year ?? 0) === 0).map((x) => `${cropNameOnly(pick(x.label, lang))} ${monthSpan(x.startMonth, x.endMonth, lang)}`).join(' · ')}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <span className="flex items-center gap-2">
                            <span className="relative h-2 w-16 rounded-full bg-surface-3">
                              <span className="absolute inset-y-0 left-0 rounded-full bg-signal" style={{ width: `${Math.round(r.score)}%` }} />
                            </span>
                            <span className="t-value text-ink-1">{Math.round(r.score)}</span>
                          </span>
                        </td>
                        {metrics.map((m, k) => {
                          const v = m.get(r);
                          const g = v == null ? null : goodness(m, v, metricAxis(m, rotations));
                          return (
                            <td key={m.key} className={cn('px-2 py-2', k === metrics.length - 1 && 'rounded-r-sm')}>
                              <span className="flex flex-col gap-1">
                                <span className="t-value text-ink-1">{metricValue(m, v, lang, currency)}</span>
                                <span className="relative h-1 w-full max-w-20 rounded-full bg-surface-3">{g != null && <span className={cn('absolute inset-y-0 left-0 rounded-full', g >= 0.5 ? 'bg-signal' : 'bg-crop-cereal')} style={{ width: `${Math.max(6, Math.round(g * 100))}%` }} />}</span>
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selected && selected.why.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink-1">{t('farm.dossier.why', { name: pick(selected.name, lang) })}</span>
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-ink-2">
                {selected.why.slice(0, 3).map((x, i) => (
                  <li key={i}>{pick(x, lang)}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="t-caption">{t('farm.dossier.s5note')}</p>
        </Step>

        <Step n={6} title={t('farm.dossier.s6')} sub={t('farm.dossier.s6sub')} last>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-sm border border-line-1 bg-surface-0 p-3">
              <span className="text-sm font-medium text-ink-1">{t('farm.dossier.soil')}</span>
              {s.moisture != null && (
                <RangeBar
                  min={(s.usual?.[0] ?? s.moisture) - span}
                  max={(s.usual?.[1] ?? s.moisture) + span}
                  band={s.usual}
                  value={s.moisture}
                  tone={s.state === 'dry' || s.state === 'wet' ? 'warn' : 'ok'}
                  bandLabel={t('farm.deep.moisture')}
                  valueLabel={s.state ? t(`farm.deep.soil.${s.state}`) : undefined}
                />
              )}
              {s.ph != null && <RangeBar min={3.5} max={9.5} band={s.phNeed} value={s.ph} tone={s.phState === 'low' || s.phState === 'high' ? 'warn' : 'ok'} bandLabel={t('farm.deep.ph')} valueLabel={`pH ${fmtNum(s.ph, 1)}`} />}
              {s.moisture == null && s.ph == null && <p className="t-caption">{t('farm.deep.noMoisture')}</p>}
              {report?.soilPlan?.items.slice(0, 3).map((it) => (
                <p key={it.metric} className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
                  <span className="font-medium text-ink-1">{pick(it.title, lang)}</span>
                  {it.needsLocalReview && <LocalReviewTag />}
                </p>
              ))}
            </div>
            <div className="flex flex-col gap-2 rounded-sm border border-line-1 bg-surface-0 p-3">
              <span className="text-sm font-medium text-ink-1">{t('farm.dossier.todo')}</span>
              {advisories.length === 0 ? (
                <p className="t-caption">{t('farm.dossier.noTodo')}</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {advisories.map((a, i) => (
                    <li key={a.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 text-sm">
                      <span className="t-value text-ink-3">{i + 1}</span>
                      <span className="flex flex-col">
                        <span className="flex flex-wrap items-center gap-x-2 font-medium text-ink-1">
                          {pick(a.title, lang)}
                          {a.needsLocalReview && <LocalReviewTag />}
                        </span>
                        <span className="text-ink-2">{pick(a.summary, lang)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </Step>
      </ol>

      <footer className="flex flex-col gap-2 border-t border-line-1 pt-4">
        <span className="text-sm font-medium text-ink-1">{t('farm.dossier.sources')}</span>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {usedSources.map((src) => (
            <li key={src.id}>
              {src.name} <span className="text-ink-3">· {src.agency}</span>
            </li>
          ))}
        </ul>
        <p className="t-caption max-w-[80ch]">{t('farm.dossier.limits')}</p>
      </footer>
    </section>
  );
}
