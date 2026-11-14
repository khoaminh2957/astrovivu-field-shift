/**
 * The locked field, left panel (or the top of the sheet on narrow screens): who the field is, the
 * crop, the score at the cursor, ground truth, and what changed around the cursor date.
 */
import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { pick } from '@/contracts';
import { listCrops } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { insightsNear, scoreAt } from '@/lib/series';
import { useMission } from '@/state/mission';
import { AnomalyMarker, Button, Select, StatusTag, Tag, cn } from '@/ui/design';
import { useMissionUi } from '@/ui/chrome/uiState';
import { cropName, fmtDate, fmtNum } from '@/ui/hud/format';
import { GroundTruthForm, countOverrides } from '@/ui/override';
import { ShapeThumb } from './FieldCanvas';
import './strings';

export function FieldHeader() {
  const t = useT();
  const parcel = useMission((s) => s.parcel);
  const unlock = useMission((s) => s.unlockParcel);
  const mode = useMission((s) => s.telemetry?.mode);
  if (!parcel) return null;
  return (
    <header className="flex items-center gap-3">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-sm border border-line-1 bg-inset">
        <ShapeThumb parcel={parcel} size={40} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="t-title truncate" title={parcel.name}>
          {parcel.name}
        </h2>
        <span className="t-caption truncate">{[parcel.place?.label, `${fmtNum(parcel.areaHa, parcel.areaHa < 10 ? 1 : 0)} ha`].filter(Boolean).join(' · ')}</span>
        {mode === 'mock' && <StatusTag status="simulated" className="mt-1 self-start" />}
      </div>
      <Button variant="ghost" size="sm" onClick={unlock} className="shrink-0">
        {t('field.change')}
      </Button>
    </header>
  );
}

export function CropSelect() {
  const t = useT();
  const lang = useLang();
  const cropId = useMission((s) => s.cropId);
  const setCrop = useMission((s) => s.setCrop);
  const options = useMemo(() => [{ value: '', label: t('field.crop.none') }, ...listCrops().map((c) => ({ value: c.id, label: cropName(c.names, lang), hint: c.scientificName }))], [lang, t]);
  return (
    <div className="flex flex-col gap-1">
      <span className="t-label" id="crop-label">
        {t('field.crop')}
      </span>
      <Select ariaLabel={t('field.crop')} size="lg" options={options} value={cropId ?? ''} onValueChange={(v) => setCrop(v || null)} />
    </div>
  );
}

export function ScoreBlock() {
  const t = useT();
  const lang = useLang();
  const score = useMission((s) => s.score);
  const cursor = useMission((s) => s.timeline.cursor);
  const cropId = useMission((s) => s.cropId);
  const mode = useMission((s) => s.telemetry?.mode);
  const snap = scoreAt(score, cursor);
  const limiting = snap?.limiting ? snap.factors.find((f) => f.key === snap.limiting) : null;
  const rel = score?.summary.reliability;
  const off = !!snap?.offSeason;

  if (!snap) {
    return (
      <section aria-busy className="flex flex-col gap-2 rounded-sm border border-line-1 bg-surface-1 p-4">
        <span className="t-label">{t('field.score.loading')}</span>
        <span className="skeleton h-10 w-28" />
        <span className="skeleton h-3 w-44" />
      </section>
    );
  }

  const v = Math.round(snap.productivity);
  const tone = v >= 60 ? 'text-ink-1' : v >= 40 ? 'text-watch' : 'text-alert';
  return (
    <section aria-label={t('field.score.aria')} className="flex flex-col gap-3 rounded-sm border border-line-1 bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="t-label">{off ? t('field.score.outlook') : t('field.score.productivity')}</span>
          <span className="flex items-baseline gap-1">
            <span className={cn('t-value text-4xl leading-none', tone)}>{v}</span>
            <span className="t-unit">/100</span>
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 pt-1">
          {snap.stage && <Tag variant="soft">{pick(snap.stage.label, lang)}</Tag>}
          {mode === 'mock' && <StatusTag status="simulated" compact />}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line-1 pt-3">
        <div className="flex flex-col">
          <dt className="t-caption">{cropId ? t('field.score.fit') : t('field.score.condition')}</dt>
          <dd className="t-value text-lg text-ink-1">{fmtNum(cropId ? snap.compatibility : snap.condition, 0)}<span className="t-unit">/100</span></dd>
        </div>
        <div className="flex flex-col">
          <dt className="t-caption">{t('field.score.reliability')}</dt>
          <dd className="text-base text-ink-1">{rel ? t('field.score.years', { ok: rel.yearsOk, n: rel.yearsTotal }) : '--'}</dd>
        </div>
        <div className="col-span-2 flex flex-col">
          <dt className="t-caption">{t('field.score.limiting')}</dt>
          <dd className="text-base text-ink-1">{limiting ? pick(limiting.label, lang) : t('field.score.noLimit')}</dd>
        </div>
      </dl>
      <p className="t-meta">{t('field.score.at', { d: fmtDate(cursor, lang) })}</p>
    </section>
  );
}

export function WhatChanged() {
  const t = useT();
  const lang = useLang();
  const insights = useMission((s) => s.insights);
  const cursor = useMission((s) => s.timeline.cursor);
  const near = insightsNear(insights, cursor, 21).slice(0, 4);
  return (
    <section aria-labelledby="changed-title" className="flex flex-col gap-2">
      <h3 id="changed-title" className="t-heading">
        {t('field.changed')}
      </h3>
      {near.length === 0 ? (
        <p className="t-caption">{t('field.changed.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {near.map((i, n) => (
            <li key={`${i.t}-${i.branch}-${n}`} className="flex gap-2">
              <AnomalyMarker severity={i.severity} className="mt-0.5 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm text-ink-1">{pick(i.text, lang)}</span>
                <span className="t-meta">{fmtDate(i.t, lang)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function GroundTruthSection() {
  const t = useT();
  const open = useMissionUi((s) => s.overrideOpen);
  const setOpen = useMissionUi((s) => s.setOverrideOpen);
  const n = useMission((s) => countOverrides(s.groundTruth));
  return (
    <section className="flex flex-col border-t border-line-1 pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="gt-body"
        onClick={() => setOpen(!open)}
        className="flex min-h-11 items-center gap-2 rounded-xs text-left hover:text-ink-1"
      >
        <span className="t-heading flex-1">{t('field.gt')}</span>
        {n > 0 && <Tag size="sm" tone="ground-truth">{n}</Tag>}
        <ChevronDown size={16} aria-hidden className={cn('text-ink-3 transition-transform duration-(--dur-fast)', open && 'rotate-180')} />
      </button>
      {!open && <p className="t-caption">{t('field.gt.lede')}</p>}
      {open && (
        <div id="gt-body" className="pt-2">
          <GroundTruthForm />
        </div>
      )}
    </section>
  );
}

/** The whole locked-field column. */
export function FieldSummary() {
  return (
    <div className="flex flex-col gap-5">
      <FieldHeader />
      <CropSelect />
      <ScoreBlock />
      <WhatChanged />
      <GroundTruthSection />
    </div>
  );
}
