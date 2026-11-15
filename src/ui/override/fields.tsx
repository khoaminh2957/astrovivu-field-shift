/**
 * The two controls every grower-entered value is made of: a measured number and a choice. Both show
 * the estimate the model uses until the grower enters their own, and where that estimate comes from.
 */
import { type ReactNode, useId, useState } from 'react';
import { X } from 'lucide-react';
import type { GroundTruth, StaticFact } from '@/contracts';
import { useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Field, IconButton, Input, Select, StatusTag } from '@/ui/design';
import { fmtNum, fmtRes } from '@/ui/hud/format';
import './strings';

export type NumberKey = 'ph' | 'ecDsM' | 'soilDepthCm' | 'organicMatterPct' | 'lastYieldTHa' | 'pricePerT' | 'costPerHa';

/** Dataset name and resolution of a soil or terrain fact, e.g. `SoilGrids 2.0 · 250 m`. */
export function useFactSource(fact: StaticFact | undefined): string | null {
  const src = useMission((s) => (fact ? s.telemetry?.sources[fact.sourceId] : undefined));
  if (!src) return null;
  // Source names carry their layer or method in brackets ("SoilGrids 2.0 (0-30 cm)"); under a field there is room for the name only.
  return [src.name.replace(/\s*\([^)]*\)\s*$/, ''), fmtRes(src.resolutionM)].filter(Boolean).join(' · ');
}

/** `Estimate: 5.6 · SoilGrids 2.0 · 250 m`, or that there is none. */
export function useEstimateHint(): (value: string | null, source?: string | null) => string {
  const t = useT();
  return (value, source) => (value == null ? t('gt.noEstimate') : source ? t('gt.estimateFrom', { v: value, src: source }) : t('gt.estimate', { v: value }));
}

/** Readable while typing and after: `12.500.000` for a price in dong would be read as a decimal by the parser, so grouping is display only. */
const parse = (text: string): number | null => (text.trim() === '' ? null : Number(text.replace(/\s/g, '').replace(',', '.')));

interface NumberOverrideProps {
  label: ReactNode;
  field: NumberKey;
  unit?: string;
  min: number;
  max: number;
  step: number;
  /** Shown as the placeholder: what the model uses while the field is empty. */
  estimate?: number | null;
  digits?: number;
  /** Line under the control; defaults to nothing. */
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** A number the grower measured or knows. Committed on Enter or blur, validated, clearable. */
export function NumberOverride({ label, field, unit, min, max, step, estimate, digits = 1, hint, disabled, className }: NumberOverrideProps) {
  const t = useT();
  const value = useMission((s) => s.groundTruth[field]);
  const setGroundTruth = useMission((s) => s.setGroundTruth);
  const [text, setText] = useState<string | null>(null);
  const id = useId();
  const shown = text ?? (value != null ? String(value) : '');
  const parsed = parse(shown);
  const invalid = parsed != null && (!Number.isFinite(parsed) || parsed < min || parsed > max);
  const patch = (v: number | undefined) => setGroundTruth({ [field]: v } as Partial<GroundTruth>);

  const commit = () => {
    if (text == null) return;
    if (text.trim() === '') patch(undefined);
    else if (!invalid && parsed != null) patch(parsed);
    if (!invalid) setText(null);
  };

  return (
    <Field label={label} htmlFor={id} error={invalid ? t('gt.invalid', { min, max }) : undefined} hint={hint} aside={value != null ? <StatusTag status="ground-truth" compact /> : undefined} className={className}>
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
          disabled={disabled}
          placeholder={estimate != null ? fmtNum(estimate, digits) : '--'}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setText(null);
          }}
          className="min-w-0 flex-1"
        />
        {value != null && <IconButton label={t('gt.clear')} icon={<X />} size="sm" onClick={() => (setText(null), patch(undefined))} />}
      </div>
    </Field>
  );
}

interface ChoiceOverrideProps<V extends string> {
  label: ReactNode;
  value: V | undefined;
  options: { value: V; label: string }[];
  onChange: (v: V | undefined) => void;
  /** What the model uses while nothing is chosen, shown in the closed control. */
  placeholder?: string | null;
  hint?: ReactNode;
  className?: string;
}

export function ChoiceOverride<V extends string>({ label, value, options, onChange, placeholder, hint, className }: ChoiceOverrideProps<V>) {
  const t = useT();
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint} aside={value != null ? <StatusTag status="ground-truth" compact /> : undefined} className={className}>
      <div className="flex items-center gap-1">
        <Select id={id} className="min-w-0 flex-1" options={options} value={value} onValueChange={(v) => onChange(v)} placeholder={placeholder ?? '--'} />
        {value != null && <IconButton label={t('gt.clear')} icon={<X />} size="sm" onClick={() => onChange(undefined)} />}
      </div>
    </Field>
  );
}
