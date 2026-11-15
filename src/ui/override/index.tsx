/**
 * Soil and practice: what the grower knows better than any map. Three groups live here (soil, water,
 * money); the crops of the year are the season planner's. Each value is written through
 * `setGroundTruth`, the store recomputes, and the ledger shows what the estimate was, what replaced
 * it and what that changed.
 */
import { type ReactNode, useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { DrainageClass, GroundTruth, IrrigationMode, TextureClass, WaterSource } from '@/contracts';
import { pick } from '@/contracts';
import { getCrop } from '@/core/crops';
import { fromUsd } from '@/core/economics';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import { Button, Dialog, Field, Segmented, StatusTag } from '@/ui/design';
import { cropName, fmtNum } from '@/ui/hud/format';
import { factOf } from '@/ui/hud/readings';
import '@/ui/hud/strings';
import { ChoiceOverride, NumberOverride, useEstimateHint, useFactSource } from './fields';
import './strings';

export { QuickFacts } from './QuickFacts';
export { ScoreChangeLine } from './ScoreChangeLine';

const TEXTURES: TextureClass[] = ['heavy', 'medium', 'light', 'organic'];
const DRAINAGE: DrainageClass[] = ['poor', 'well', 'excessive'];
const SOURCES: WaterSource[] = ['rain', 'river-canal', 'well', 'reservoir', 'other'];
const RELIABILITY = ['year-round', 'dry-season-short', 'often-short', 'unknown'] as const;
export const IRRIGATION: IrrigationMode[] = ['rainfed', 'supplemental', 'full'];

/** Keys of `GroundTruth` the form edits; the count on the tab and the reset use them. */
export const EDITED_KEYS: (keyof GroundTruth)[] = [
  'ph',
  'ecDsM',
  'organicMatterPct',
  'texture',
  'drainage',
  'soilDepthCm',
  'irrigation',
  'waterSource',
  'waterReliability',
  'sowingDate',
  'lastYieldTHa',
  'pricePerT',
  'costPerHa',
];

export function countOverrides(gt: GroundTruth): number {
  return EDITED_KEYS.filter((k) => gt[k] != null).length;
}

/** One group of the form: its name, one line on why it matters, the fields in two columns. */
function Group({ title, note, children, aside, footer }: { title: string; note?: ReactNode; children: ReactNode; aside?: ReactNode; footer?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-line-1 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={id} className="t-heading">
            {title}
          </h3>
          {note != null && <p className="t-caption">{note}</p>}
        </div>
        {aside}
      </div>
      <div className="grid grid-cols-2 items-start gap-x-4 gap-y-3 narrow:grid-cols-1">{children}</div>
      {footer}
    </section>
  );
}

export function SoilGroup() {
  const t = useT();
  const soil = useMission((s) => s.telemetry?.branches.soil);
  const gt = useMission((s) => s.groundTruth);
  const setGroundTruth = useMission((s) => s.setGroundTruth);
  const hint = useEstimateHint();
  // Soil facts of one field share one source in practice; pH names it, the rest follow their own when they differ.
  const fact = (key: string) => factOf(soil, key);
  const num = (key: string) => {
    const v = fact(key)?.value;
    return typeof v === 'number' ? v : null;
  };
  const phSrc = useFactSource(fact('ph'));
  const ecSrc = useFactSource(fact('ec_dsm'));
  const omSrc = useFactSource(fact('om_pct') ?? fact('soc_gkg'));
  const texSrc = useFactSource(fact('texture_class'));
  const drSrc = useFactSource(fact('drainage_class'));
  const depthSrc = useFactSource(fact('depth_cm'));
  // Organic matter is published as organic carbon by most soil maps; the conventional factor 1.724 converts it.
  const om = num('om_pct') ?? (num('soc_gkg') != null ? Math.round(((num('soc_gkg') as number) * 1.724) / 10 * 10) / 10 : null);
  const texture = fact('texture_class')?.value;
  const drainage = fact('drainage_class')?.value;
  const textureEst = typeof texture === 'string' && TEXTURES.includes(texture as TextureClass) ? t(`hud.texture.${texture}`) : null;
  const drainageEst = typeof drainage === 'string' && DRAINAGE.includes(drainage as DrainageClass) ? t(`hud.drainage.${drainage}`) : null;
  const est = (v: number | null, digits: number, unit: string, src: string | null) => hint(v == null ? null : `${fmtNum(v, digits)}${unit ? ` ${unit}` : ''}`, src);

  return (
    <Group title={t('gt.soil')} note={t('gt.soilNote')}>
      <NumberOverride label={t('gt.ph')} field="ph" min={3} max={10} step={0.1} estimate={num('ph')} hint={est(num('ph'), 1, '', phSrc)} />
      <NumberOverride label={t('gt.om')} field="organicMatterPct" unit="%" min={0} max={60} step={0.1} estimate={om} hint={est(om, 1, '%', omSrc)} />
      <ChoiceOverride
        label={t('gt.texture')}
        value={gt.texture}
        onChange={(v) => setGroundTruth({ texture: v })}
        options={TEXTURES.map((v) => ({ value: v, label: t(`hud.texture.${v}`) }))}
        placeholder={textureEst}
        hint={hint(textureEst, texSrc)}
      />
      <ChoiceOverride
        label={t('gt.drainage')}
        value={gt.drainage}
        onChange={(v) => setGroundTruth({ drainage: v })}
        options={DRAINAGE.map((v) => ({ value: v, label: t(`hud.drainage.${v}`) }))}
        placeholder={drainageEst}
        hint={hint(drainageEst, drSrc)}
      />
      <NumberOverride label={t('gt.ec')} field="ecDsM" unit="dS/m" min={0} max={40} step={0.1} estimate={num('ec_dsm')} hint={est(num('ec_dsm'), 1, 'dS/m', ecSrc)} />
      <NumberOverride label={t('gt.depth')} field="soilDepthCm" unit="cm" min={5} max={400} step={5} estimate={num('depth_cm')} digits={0} hint={est(num('depth_cm'), 0, 'cm', depthSrc)} />
    </Group>
  );
}

export function WaterGroup() {
  const t = useT();
  const gt = useMission((s) => s.groundTruth);
  const setGroundTruth = useMission((s) => s.setGroundTruth);
  const id = useId();
  return (
    <Group title={t('gt.water')} note={t('gt.waterNote')}>
      <Field label={t('gt.irrigation')} htmlFor={id} hint={gt.irrigation ? undefined : t('gt.irrigationDefault')} aside={gt.irrigation ? <StatusTag status="ground-truth" compact /> : undefined} className="col-span-2 narrow:col-span-1">
        <Segmented<IrrigationMode>
          ariaLabel={t('gt.irrigation')}
          block
          value={gt.irrigation ?? ('' as IrrigationMode)}
          onValueChange={(v) => setGroundTruth({ irrigation: v })}
          options={IRRIGATION.map((v) => ({ value: v, label: t(`gt.irr.${v}`) }))}
        />
      </Field>
      <ChoiceOverride label={t('gt.source')} value={gt.waterSource} onChange={(v) => setGroundTruth({ waterSource: v })} options={SOURCES.map((v) => ({ value: v, label: t(`gt.src.${v}`) }))} />
      <ChoiceOverride label={t('gt.reliability')} value={gt.waterReliability} onChange={(v) => setGroundTruth({ waterReliability: v })} options={RELIABILITY.map((v) => ({ value: v, label: t(`gt.rel.${v}`) }))} />
    </Group>
  );
}

type Currency = NonNullable<GroundTruth['currency']>;

/** The grower's own yield, price and cost. They describe the crop grown now, so they need one. */
export function MoneyGroup() {
  const t = useT();
  const lang = useLang();
  const gt = useMission((s) => s.groundTruth);
  const cropId = useMission((s) => s.cropId);
  const setGroundTruth = useMission((s) => s.setGroundTruth);
  // What the comparison uses for this crop until the grower enters their own: the current rotation's season of it.
  const ref = useMission((s) => s.advisory?.rotations.find((r) => r.kind === 'current')?.economics.seasons.find((x) => x.cropId === s.cropId));
  const crop = getCrop(cropId);
  const cur: Currency = gt.currency ?? (lang === 'vi' ? 'VND' : 'USD');
  const money = (usd: number) => `${Math.round(fromUsd(usd, cur)).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')} ${cur}`;
  const refHint = (text: string) => t('gt.ref', { v: text });
  const big = cur === 'VND';

  return (
    <Group
      title={t('gt.money')}
      note={crop ? t('gt.moneyNote', { c: cropName(crop.names, lang) }) : t('gt.moneyNoCrop')}
      aside={
        <Segmented<Currency>
          ariaLabel={t('gt.currency')}
          size="sm"
          value={cur}
          onValueChange={(v) => setGroundTruth({ currency: v })}
          options={[
            { value: 'USD', label: 'USD' },
            { value: 'VND', label: 'VND' },
          ]}
        />
      }
      footer={
        // The reference values are long citations: named once for the group, opened on demand.
        ref && ref.sources.length > 0 ? (
          <details className="t-caption">
            <summary className="cursor-pointer rounded-xs text-ink-2 hover:text-ink-1">{t('gt.refSources')}</summary>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
              {ref.sources.map((s) => (
                <li key={s} className="break-words">
                  {s}
                </li>
              ))}
            </ul>
          </details>
        ) : undefined
      }
    >
      <NumberOverride
        label={t('gt.yield')}
        field="lastYieldTHa"
        unit="t/ha"
        min={0}
        max={200}
        step={0.1}
        disabled={!crop}
        estimate={gt.lastYieldTHa == null ? (ref?.yield.expectedTHa ?? null) : null}
        hint={gt.lastYieldTHa == null && ref ? t('gt.yieldModel', { v: fmtNum(ref.yield.expectedTHa, 1) }) : undefined}
      />
      <NumberOverride
        label={t('gt.price')}
        field="pricePerT"
        unit={`${cur}/t`}
        min={0}
        max={big ? 3e9 : 1e6}
        step={big ? 1000 : 1}
        digits={0}
        disabled={!crop}
        hint={gt.pricePerT == null && ref ? refHint(`${money(ref.priceUsdPerT)}/t`) : undefined}
      />
      <NumberOverride
        label={t('gt.cost')}
        field="costPerHa"
        unit={`${cur}/ha`}
        min={0}
        max={big ? 3e10 : 1e6}
        step={big ? 1000 : 1}
        digits={0}
        disabled={!crop}
        hint={gt.costPerHa == null && ref && ref.areaHa > 0 ? refHint(`${money(ref.costUsd / ref.areaHa)}/ha`) : undefined}
        className="col-span-2 narrow:col-span-1"
      />
    </Group>
  );
}

export function Ledger() {
  const t = useT();
  const lang = useLang();
  const calibration = useMission((s) => s.score?.summary.calibration ?? []);
  const gt = useMission((s) => s.groundTruth);
  const n = countOverrides(gt);
  return (
    <section className="flex flex-col gap-2 border-t border-line-1 pt-4">
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

export function ResetButton() {
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

/** Soil, water and money in one column, with the ledger; the field panel places the season planner between them. */
export function GroundTruthForm() {
  return (
    <div className="flex flex-col gap-4">
      <SoilGroup />
      <WaterGroup />
      <MoneyGroup />
      <Ledger />
      <div>
        <ResetButton />
      </div>
    </div>
  );
}
