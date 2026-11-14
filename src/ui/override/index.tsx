/**
 * Ground-Truth Override: what the farmer knows better than any satellite. Each value is written
 * through `setGroundTruth` / `setCrop`, the store recomputes, and the calibration ledger shows
 * what the estimate was, what replaced it and what that changed.
 */
import { type ReactNode, useId, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { DrainageClass, GroundTruth, IrrigationMode, TextureClass } from '@/contracts';
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, Dialog, Field, IconButton, Input, Segmented, Select, StatusTag } from '@/ui/design';
import { fmtNum } from '@/ui/hud/format';
import { factOf } from '@/ui/hud/readings';
import '@/ui/hud/strings';
import './strings';

const TEXTURES: TextureClass[] = ['heavy', 'medium', 'light', 'organic'];
const DRAINAGE: DrainageClass[] = ['poor', 'well', 'excessive'];
const RELIABILITY = ['year-round', 'dry-season-short', 'often-short', 'unknown'] as const;

/** Keys of `GroundTruth` this panel edits; the count on the trigger and the reset use them. */
export const EDITED_KEYS: (keyof GroundTruth)[] = ['sowingDate', 'irrigation', 'waterReliability', 'ph', 'ecDsM', 'texture', 'drainage', 'soilDepthCm'];

export function countOverrides(gt: GroundTruth): number {
  return EDITED_KEYS.filter((k) => gt[k] != null).length;
}

/** A number the farmer measured. Committed on Enter or blur, validated, clearable. */
function NumberOverride({ label, field, unit, min, max, step, estimate, digits = 1 }: { label: ReactNode; field: 'ph' | 'ecDsM' | 'soilDepthCm'; unit?: string; min: number; max: number; step: number; estimate: number | null; digits?: number }) {
  const t = useT();
  const value = useMission((s) => s.groundTruth[field]);
  const setGroundTruth = useMission((s) => s.setGroundTruth);
  const [text, setText] = useState<string | null>(null);
  const id = useId();
  const shown = text ?? (value != null ? String(value) : '');
  const parsed = shown.trim() === '' ? null : Number(shown.replace(',', '.'));
  const invalid = parsed != null && (!Number.isFinite(parsed) || parsed < min || parsed > max);

  const commit = () => {
    if (text == null) return;
    if (text.trim() === '') setGroundTruth({ [field]: undefined });
    else if (!invalid && parsed != null) setGroundTruth({ [field]: parsed });
    if (!invalid) setText(null);
  };

  return (
    <Field
      label={label}
      htmlFor={id}
      error={invalid ? t('gt.invalid', { min, max }) : undefined}
      hint={estimate != null ? t('gt.estimate', { v: `${fmtNum(estimate, digits)}${unit ? ` ${unit}` : ''}` }) : t('gt.noEstimate')}
      aside={value != null ? <StatusTag status="ground-truth" compact /> : undefined}
    >
      <div className="flex items-center gap-1">
        <Input
          id={id}
          numeric
          inputMode="decimal"
          unit={unit}
          value={shown}
          min={min}
          max={max}
          step={step}
          invalid={invalid}
          placeholder={estimate != null ? fmtNum(estimate, digits) : '--'}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setText(null);
          }}
          className="flex-1"
        />
        {value != null && <IconButton label={t('gt.clear')} icon={<X />} size="sm" onClick={() => (setText(null), setGroundTruth({ [field]: undefined }))} />}
      </div>
    </Field>
  );
}

function ChoiceOverride<V extends string>({ label, value, options, onChange, estimate }: { label: ReactNode; value: V | undefined; options: { value: V; label: string }[]; onChange: (v: V | undefined) => void; estimate?: string | null }) {
  const t = useT();
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={estimate ? t('gt.estimate', { v: estimate }) : undefined} aside={value != null ? <StatusTag status="ground-truth" compact /> : undefined}>
      <div className="flex items-center gap-1">
        <Select id={id} className="flex-1" options={options} value={value} onValueChange={(v) => onChange(v)} placeholder={estimate ?? '--'} />
        {value != null && <IconButton label={t('gt.clear')} icon={<X />} size="sm" onClick={() => onChange(undefined)} />}
      </div>
    </Field>
  );
}

function Ledger() {
  const t = useT();
  const lang = useLang();
  const calibration = useMission((s) => s.score?.summary.calibration ?? []);
  const gt = useMission((s) => s.groundTruth);
  const n = countOverrides(gt);
  return (
    <section className="flex flex-col gap-2 border-t border-line-1 pt-3">
      <div>
        <h3 className="t-heading">{t('gt.ledger')}</h3>
        <p className="t-caption">{t('gt.ledgerNote')}</p>
      </div>
      {calibration.length === 0 ? (
        <p className="t-caption text-ink-2">{n === 0 ? t('gt.ledgerEmpty') : t('gt.ledgerPending')}</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="t-label text-left">
              <th className="w-[34%] pb-1 font-medium" />
              <th className="pb-1 font-medium">{t('gt.colSat')}</th>
              <th className="pb-1 font-medium">{t('gt.colGround')}</th>
            </tr>
          </thead>
          <tbody>
            {calibration.map((c) => (
              <tr key={c.key} className="border-t border-line-1 align-top">
                <td className="py-1.5 pr-2 text-ink-2">{pick(c.label, lang)}</td>
                <td className="t-value py-1.5 text-ink-3">
                  <s>{c.satellite == null ? '--' : String(c.satellite)}</s>
                </td>
                <td className="py-1.5">
                  <span className="t-value rounded-xs bg-signal px-1 text-on-signal">{String(c.ground)}</span>
                  <p className="t-caption mt-1">{pick(c.effect, lang)}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ResetButton() {
  const t = useT();
  const gt = useMission((s) => s.groundTruth);
  const reset = useMission((s) => s.resetGroundTruth);
  const demo = useMission((s) => !!(s.parcel && 'defaultGroundTruth' in s.parcel && s.parcel.defaultGroundTruth));
  const [open, setOpen] = useState(false);
  const n = countOverrides(gt);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title={t('gt.reset')}
      description={t(demo ? 'gt.resetConfirmDemo' : 'gt.resetConfirm', { n })}
      trigger={
        <Button variant="ghost" icon={<RotateCcw />} disabled={n === 0 && !demo}>
          {t('gt.reset')}
        </Button>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('gt.cancel')}
          </Button>
          <Button variant="danger" onClick={() => (reset(), setOpen(false))}>
            {t('gt.resetDo')}
          </Button>
        </>
      }
    />
  );
}

/** Ground-truth form, inline in the field panel: every value replaces the satellite estimate. */
export function GroundTruthForm() {
  const t = useT();
  const soil = useMission((s) => s.telemetry?.branches.soil);
  const gt = useMission((s) => s.groundTruth);
  const setGroundTruth = useMission((s) => s.setGroundTruth);
  const demo = useMission((s) => !!(s.parcel && 'defaultGroundTruth' in s.parcel && s.parcel.defaultGroundTruth));
  const sowId = useId();

  const num = (key: string) => {
    const v = factOf(soil, key)?.value;
    return typeof v === 'number' ? v : null;
  };
  const textureEst = factOf(soil, 'texture_class')?.value;
  const drainageEst = factOf(soil, 'drainage_class')?.value;

  return (
    <div className="flex flex-col gap-4">
        <p className="t-caption text-ink-2">{t('gt.description')}</p>
        {demo && <p className="t-caption text-ink-2">{t('gt.demoProfile')}</p>}

        <Field label={t('gt.irrigation')} htmlFor={`${sowId}-irr`} aside={gt.irrigation ? <StatusTag status="ground-truth" compact /> : undefined}>
          <Segmented<IrrigationMode>
            ariaLabel={t('gt.irrigation')}
            block
            value={gt.irrigation ?? ('' as IrrigationMode)}
            onValueChange={(v) => setGroundTruth({ irrigation: v })}
            options={(['rainfed', 'supplemental', 'full'] as const).map((v) => ({ value: v, label: t(`gt.irr.${v}`) }))}
          />
        </Field>

        <ChoiceOverride
          label={t('gt.reliability')}
          value={gt.waterReliability}
          onChange={(v) => setGroundTruth({ waterReliability: v })}
          options={RELIABILITY.map((v) => ({ value: v, label: t(`gt.rel.${v}`) }))}
        />

        <section className="flex flex-col gap-3 border-t border-line-1 pt-3">
          <h3 className="t-heading">{t('gt.soil')}</h3>
          <NumberOverride label={t('gt.ph')} field="ph" min={3} max={10} step={0.1} estimate={num('ph')} />
          <NumberOverride label={t('gt.ec')} field="ecDsM" unit="dS/m" min={0} max={40} step={0.1} estimate={num('ec_dsm')} />
          <ChoiceOverride
            label={t('gt.texture')}
            value={gt.texture}
            onChange={(v) => setGroundTruth({ texture: v })}
            options={TEXTURES.map((v) => ({ value: v, label: t(`hud.texture.${v}`) }))}
            estimate={typeof textureEst === 'string' && TEXTURES.includes(textureEst as TextureClass) ? t(`hud.texture.${textureEst}`) : null}
          />
          <ChoiceOverride
            label={t('gt.drainage')}
            value={gt.drainage}
            onChange={(v) => setGroundTruth({ drainage: v })}
            options={DRAINAGE.map((v) => ({ value: v, label: t(`hud.drainage.${v}`) }))}
            estimate={typeof drainageEst === 'string' && DRAINAGE.includes(drainageEst as DrainageClass) ? t(`hud.drainage.${drainageEst}`) : null}
          />
          <NumberOverride label={t('gt.depth')} field="soilDepthCm" unit="cm" min={5} max={400} step={5} estimate={num('depth_cm')} digits={0} />
        </section>

        <Ledger />
        <div>
          <ResetButton />
        </div>
    </div>
  );
}
