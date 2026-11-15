/**
 * The detail sheet behind a character's "!" (docs/FARM.md §4). The note on the stage is one verdict
 * in a grower's words; this is where the measurements it stands on are laid out, with their sources:
 * the year in months, the reading against its usual range, the factors of the score, the plan.
 */
import type { ReactNode } from 'react';
import { type AdvisoryReport, type FieldTelemetry, type ModelInput, type ScoreTimeline, pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { type FarmOption, type FarmPeriodSummary, type FarmScene, type FarmVoice, forecastDays } from '@/core/farm';
import { OptionFigure } from './StageParts';
import { useLang, useT } from '@/i18n';
import { scoreAt } from '@/lib/series';
import { LocalReviewTag } from '@/ui/advisory/shared';
import { Dialog, cn } from '@/ui/design';
import { fmtDate, fmtNum } from '@/ui/hud/format';
import { FactorBars, type MonthDatum, RangeBar, Tile, YearClimate, YearScore } from './charts';

export interface DeepSheetProps {
  who: FarmVoice | null;
  onClose: () => void;
  input: ModelInput;
  score: ScoreTimeline;
  scene: FarmScene;
  summary: FarmPeriodSummary | null;
  /** "March 2026", "Today, 14 Nov 2026": what the stage is showing. */
  when: string;
  report: AdvisoryReport | null;
  options: FarmOption[] | null;
  months: MonthDatum[];
  activeMonthId: string | null;
  simulated: boolean;
}

function Block({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col">
        <h3 className="text-base font-semibold text-ink-1">{title}</h3>
        {sub && <p className="t-caption">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

const sourceNames = (t: FieldTelemetry, ids: string[]): string => [...new Set(ids.map((id) => t.sources[id]?.name ?? id))].join(', ');

export function DeepSheet({ who, onClose, input, score, scene, summary, when, report, options, months, activeMonthId, simulated }: DeepSheetProps) {
  const t = useT();
  const lang = useLang();
  const tel = input.telemetry;
  const crop = getCrop(input.cropId);
  const w = scene.weather;
  const dash = '--';

  const body = (): ReactNode => {
    if (who === 'space') {
      const days = forecastDays(tel);
      const risks = (tel.branches.risk.events ?? []).filter((e) => e.severity > 0 && e.end >= tel.window.today).sort((a, b) => a.start.localeCompare(b.start));
      return (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label={summary ? t('farm.deep.tempMean') : t('farm.deep.temp')} value={w.tMaxC != null && w.tMinC != null ? `${fmtNum(w.tMaxC, 0)}° / ${fmtNum(w.tMinC, 0)}°` : dash} note={t('farm.deep.tempNote')} />
            <Tile label={summary ? t('farm.deep.rainTotal') : t('farm.deep.rainDay')} value={w.rainMm != null ? `${fmtNum(w.rainMm, summary ? 0 : 1)} mm` : dash} note={summary ? t('farm.deep.wetDays', { n: summary.wetDays, of: summary.daysRead }) : w.rain7Mm != null ? t('farm.deep.rain7', { n: fmtNum(w.rain7Mm, 0) }) : undefined} />
            {summary ? (
              <>
                <Tile label={t('farm.deep.hotDays')} value={summary.hotDays} tone={summary.hotDays >= 5 ? 'warn' : undefined} note={t('farm.deep.hotNote')} />
                <Tile label={t('farm.deep.heavyDays')} value={summary.heavyRainDays} tone={summary.heavyRainDays > 0 ? 'warn' : undefined} note={t('farm.deep.heavyNote')} />
              </>
            ) : (
              <>
                <Tile label={t('farm.deep.humidity')} value={w.rhPct != null ? `${fmtNum(w.rhPct, 0)} %` : dash} />
                <Tile label={t('farm.deep.wind')} value={w.windMs != null ? `${fmtNum(w.windMs, 1)} m/s` : dash} />
              </>
            )}
          </div>
          <Block title={t('farm.deep.year')} sub={t('farm.deep.yearSub')}>
            <YearClimate months={months} activeId={activeMonthId} lang={lang} label={t('farm.deep.year')} />
          </Block>
          <Block title={t('farm.deep.forecast')} sub={days.length > 1 ? t('farm.deep.forecastSub') : undefined}>
            {days.length <= 1 ? (
              <p className="t-caption">{t('farm.deep.noForecast')}</p>
            ) : (
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {days.map((d) => (
                  <div key={d.t} className="flex w-[4.5rem] shrink-0 flex-col items-center gap-0.5 rounded-sm border border-line-1 px-1.5 py-2 text-xs">
                    <span className="text-ink-3">{d.t === tel.window.today ? t('farm.today') : fmtDate(d.t, lang, false)}</span>
                    <span className="text-center text-[11px] leading-4 text-ink-2">{t(`farm.sky.${d.kind}`)}</span>
                    <span className="t-value text-sm text-ink-1">{d.tMaxC == null ? dash : `${Math.round(d.tMaxC)}°`}</span>
                    <span className="t-value text-ink-3">{d.tMinC == null ? dash : `${Math.round(d.tMinC)}°`}</span>
                    <span className="t-value text-[var(--color-branch-rainfall)]">{d.rainMm == null ? dash : `${fmtNum(d.rainMm, d.rainMm < 10 ? 1 : 0)} mm`}</span>
                  </div>
                ))}
              </div>
            )}
          </Block>
          <Block title={t('farm.deep.warnings')}>
            {risks.length === 0 ? (
              <p className="t-caption">{t('farm.deep.noWarnings')}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm text-ink-1">
                {risks.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="t-value shrink-0 text-watch">
                      {fmtDate(e.start, lang, false)}
                      {e.end !== e.start ? ` – ${fmtDate(e.end, lang, false)}` : ''}
                    </span>
                    {pick(e.title, lang)}
                  </li>
                ))}
              </ul>
            )}
          </Block>
          {w.sourceIds.length > 0 && <p className="t-caption">{t('farm.source', { s: sourceNames(tel, w.sourceIds) })}</p>}
        </>
      );
    }

    if (who === 'rice') {
      const c = scene.crop;
      const snap = scoreAt(score, scene.t);
      const rel = score.summary.reliability;
      const mine = (options ?? []).filter((o) => o.by === 'rice');
      const resting = c.stage == null || c.stage === 'fallow' || c.stage === 'pre-sowing' || c.stage === 'dormant';
      if (!crop) return <p className="text-sm text-ink-2">{t('farm.deep.noCrop')}</p>;
      return (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label={t('farm.deep.stage')} value={c.stageLabel ? pick(c.stageLabel, lang) : dash} />
            <Tile label={t('farm.deep.progress')} value={resting ? dash : `${Math.round(c.progress * 100)} %`} note={c.daysToHarvest != null ? t('farm.deep.toHarvest', { n: c.daysToHarvest }) : undefined} />
            <Tile
              label={t('farm.deep.greenness')}
              value={c.ndvi != null ? fmtNum(c.ndvi, 2) : dash}
              tone={c.ndviVsUsual === 'below' ? 'warn' : undefined}
              note={c.ndvi == null ? t('farm.deep.noImage') : `${c.ndviVsUsual ? `${t(`farm.deep.vs.${c.ndviVsUsual}`)} · ` : ''}${c.ndviDate ? fmtDate(c.ndviDate, lang, false) : ''}`}
            />
            <Tile label={t('farm.deep.scoreNow')} value={scene.score != null ? `${scene.score}/100` : dash} note={scene.limiting ? t('farm.deep.limiting', { f: pick(scene.limiting, lang) }) : undefined} />
          </div>
          {!resting && (
            <div className="flex flex-col gap-1">
              <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-3">
                <div className="absolute inset-y-0 left-0 rounded-full bg-signal" style={{ width: `${Math.round(c.progress * 100)}%` }} />
              </div>
              <div className="flex justify-between text-xs text-ink-3">
                <span>{t('farm.deep.sown')}</span>
                <span>{t('farm.deep.harvest')}</span>
              </div>
            </div>
          )}
          <Block title={t('farm.deep.scoreYear')} sub={t('farm.deep.scoreYearSub')}>
            <YearScore months={months} activeId={activeMonthId} lang={lang} label={t('farm.deep.scoreYear')} />
          </Block>
          {snap && snap.factors.length > 0 && (
            <Block title={t('farm.deep.factors')} sub={t('farm.deep.factorsSub')}>
              <FactorBars
                rows={snap.factors
                  .filter((f) => f.weight > 0 || f.limiting)
                  .slice(0, 9)
                  .map((f) => ({ key: f.key, label: pick(f.label, lang), score: f.score, limiting: f.key === snap.limiting, note: `${f.actual ?? dash}${f.unit ? ` ${f.unit}` : ''} · ${t('farm.deep.ideal')} ${f.ideal}` }))}
              />
            </Block>
          )}
          {rel && <p className="text-sm text-ink-2">{t('farm.deep.reliability', { ok: rel.yearsOk, of: rel.yearsTotal })}</p>}
          {mine.length > 0 && !simulated && (
            <Block title={t('farm.deep.tryCrop')} sub={t('farm.deep.trySub')}>
              <OptionList options={mine} />
            </Block>
          )}
        </>
      );
    }

    if (who === 'soil') {
      const s = scene.soil;
      const plan = simulated ? undefined : report?.soilPlan;
      const ph = simulated ? undefined : report?.ph;
      const irrigation = simulated ? undefined : report?.irrigation;
      const mine = (options ?? []).filter((o) => o.by === 'soil');
      const span = s.usual ? s.usual[1] - s.usual[0] : 0.1;
      return (
        <>
          <Block title={t('farm.deep.moisture')} sub={t('farm.deep.moistureSub')}>
            {s.moisture == null ? (
              <p className="t-caption">{t('farm.deep.noMoisture')}</p>
            ) : (
              <RangeBar
                min={(s.usual?.[0] ?? s.moisture) - span}
                max={(s.usual?.[1] ?? s.moisture) + span}
                band={s.usual}
                value={s.moisture}
                tone={s.state === 'dry' || s.state === 'wet' ? 'warn' : 'ok'}
                bandLabel={s.usual ? t('farm.deep.usualBand', { lo: fmtNum(s.usual[0], 2), hi: fmtNum(s.usual[1], 2) }) : undefined}
                valueLabel={`${fmtNum(s.moisture, 2)} m³/m³${s.state ? ` · ${t(`farm.deep.soil.${s.state}`)}` : ''}`}
              />
            )}
          </Block>
          <Block title={t('farm.deep.ph')} sub={s.phFrom ? t(`farm.deep.phFrom.${s.phFrom}`) : undefined}>
            {s.ph == null ? (
              <p className="t-caption">{t('farm.deep.noPh')}</p>
            ) : (
              <RangeBar
                min={3.5}
                max={9.5}
                band={s.phNeed}
                value={s.ph}
                tone={s.phState === 'low' || s.phState === 'high' ? 'warn' : 'ok'}
                bandLabel={s.phNeed && crop ? t('farm.deep.phBand', { crop: lang === 'vi' && crop.names.vi ? crop.names.vi : crop.names.en, lo: s.phNeed[0], hi: s.phNeed[1] }) : undefined}
                valueLabel={`pH ${fmtNum(s.ph, 1)}${s.phUncertainty ? ` (${fmtNum(s.phUncertainty[0], 1)}–${fmtNum(s.phUncertainty[1], 1)})` : ''}`}
              />
            )}
          </Block>
          <Block title={t('farm.deep.plan')} sub={plan ? pick(plan.summary, lang) : undefined}>
            {!plan || plan.items.length === 0 ? (
              <p className="t-caption">{simulated ? t('farm.deep.planSim') : t('farm.deep.noPlan')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {plan.items.slice(0, 5).map((it) => (
                  <li key={it.metric} className={cn('flex flex-col gap-1 rounded-sm border px-3 py-2.5', it.status === 'outside' ? 'border-watch/60' : 'border-line-1')}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink-1">{pick(it.title, lang)}</span>
                      {it.needsLocalReview && <LocalReviewTag />}
                    </span>
                    <span className="text-sm text-ink-2">{pick(it.action, lang)}</span>
                    <span className="t-caption">
                      {it.rateRange ? `${fmtNum(it.rateRange.min, 1)}–${fmtNum(it.rateRange.max, 1)} ${it.rateRange.unit} · ` : ''}
                      {pick(it.timing, lang)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {ph && ph.amendment !== 'none' && (
              <p className="text-sm text-ink-2">
                {t(`farm.deep.amend.${ph.amendment}`, { from: fmtNum(ph.current, 1), to: fmtNum(ph.target, 1) })}
                {ph.rateTHa ? ` ${t('farm.deep.rate', { lo: fmtNum(ph.rateTHa[0], 1), hi: fmtNum(ph.rateTHa[1], 1) })}` : ''}
              </p>
            )}
            {irrigation && <p className="text-sm text-ink-2">{t('farm.deep.irrigation', { mm: fmtNum(irrigation.totalMm, 0), n: irrigation.events.length })}</p>}
          </Block>
          {mine.length > 0 && !simulated && (
            <Block title={t('farm.deep.trySoil')} sub={t('farm.deep.trySub')}>
              <OptionList options={mine} />
            </Block>
          )}
          {s.sourceIds.length > 0 && <p className="t-caption">{t('farm.source', { s: sourceNames(tel, s.sourceIds) })}</p>}
        </>
      );
    }
    return null;
  };

  return (
    <Dialog open={who != null} onOpenChange={(o) => !o && onClose()} size="lg" title={who ? t(`farm.deep.title.${who}`) : ''} description={who ? `${when}${simulated ? ` · ${t('farm.simulated')}` : ''}` : undefined}>
      <div className="flex flex-col gap-5" data-farm-deep={who ?? undefined}>
        {body()}
      </div>
    </Dialog>
  );
}

function OptionList({ options }: { options: FarmOption[] }) {
  const t = useT();
  const lang = useLang();
  return (
    <ul className="flex flex-col gap-1.5">
      {options.slice(0, 4).map((o) => (
        <li key={o.id} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 text-ink-1">{pick(o.label, lang)}</span>
          <span className="shrink-0"><OptionFigure o={o} full /></span>
        </li>
      ))}
    </ul>
  );
}
