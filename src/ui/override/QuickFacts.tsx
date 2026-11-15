/**
 * The three questions asked right after a field is opened: soil pH, irrigation, the crop standing
 * now. They are the entries that move the result most and that a grower can answer without a lab.
 * Each shows what the model uses until it is answered; "I don't know" keeps that.
 */
import { useId, useMemo } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { IrrigationMode } from '@/contracts';
import { listCrops } from '@/core/crops';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Field, IconButton, Select, StatusTag } from '@/ui/design';
import { cropName, fmtNum } from '@/ui/hud/format';
import { factOf } from '@/ui/hud/readings';
import { NumberOverride, useEstimateHint, useFactSource } from './fields';
import { ScoreChangeLine } from './ScoreChangeLine';
import './strings';

/** Radix Select has no empty value; this one stands for "I don't know". */
const UNKNOWN = 'unknown';
const MODES: IrrigationMode[] = ['rainfed', 'supplemental', 'full'];

export function QuickFacts({ onClose, onMore }: { onClose: () => void; onMore: () => void }) {
  const t = useT();
  const lang = useLang();
  const ph = useMission((s) => factOf(s.telemetry?.branches.soil, 'ph'));
  const phSrc = useFactSource(ph);
  const irrigation = useMission((s) => s.groundTruth.irrigation);
  const cropId = useMission((s) => s.cropId);
  const setGroundTruth = useMission((s) => s.setGroundTruth);
  const setCrop = useMission((s) => s.setCrop);
  const hint = useEstimateHint();
  const titleId = useId();
  const irrId = useId();
  const cropFieldId = useId();
  const est = typeof ph?.value === 'number' ? ph.value : null;
  const crops = useMemo(() => [{ value: UNKNOWN, label: t('gt.q.unknown') }, ...listCrops().map((c) => ({ value: c.id, label: cropName(c.names, lang), hint: c.scientificName }))], [lang, t]);
  const modes = useMemo(() => [...MODES.map((v) => ({ value: v as string, label: t(`gt.irr.${v}`) })), { value: UNKNOWN, label: t('gt.q.unknown') }], [t]);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-sm border border-signal/50 bg-signal/5 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="t-heading">
            {t('gt.q.title')}
          </h3>
          <p className="t-caption">{t('gt.q.lede')}</p>
        </div>
        <IconButton label={t('gt.q.close')} icon={<X />} size="sm" onClick={onClose} className="-mt-1 -mr-1 shrink-0" />
      </div>

      <div className="grid grid-cols-3 items-start gap-3 narrow:grid-cols-1">
        <NumberOverride
          label={t('gt.q.ph')}
          field="ph"
          min={3}
          max={10}
          step={0.1}
          estimate={est}
          hint={hint(est != null ? fmtNum(est, 1) : null, phSrc)}
        />
        <Field label={t('gt.q.water')} htmlFor={irrId} hint={irrigation ? undefined : t('gt.irrigationDefault')} aside={irrigation ? <StatusTag status="ground-truth" compact /> : undefined}>
          <Select id={irrId} options={modes} value={irrigation} placeholder={t('gt.q.choose')} onValueChange={(v) => setGroundTruth({ irrigation: v === UNKNOWN ? undefined : (v as IrrigationMode) })} />
        </Field>
        <Field label={t('gt.q.crop')} htmlFor={cropFieldId} hint={cropId ? undefined : t('gt.q.cropHint')} aside={cropId ? <StatusTag status="ground-truth" compact /> : undefined}>
          <Select id={cropFieldId} options={crops} value={cropId ?? undefined} placeholder={t('gt.q.choose')} onValueChange={(v) => setCrop(v === UNKNOWN ? null : v)} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <ScoreChangeLine />
        <button type="button" onClick={onMore} className="ml-auto inline-flex items-center gap-1 rounded-xs text-sm font-medium text-signal-strong hover:underline">
          {t('gt.q.more')}
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </section>
  );
}
