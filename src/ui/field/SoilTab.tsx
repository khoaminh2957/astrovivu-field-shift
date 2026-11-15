/**
 * "What are the real conditions of this field": everything the grower enters, in four groups (soil,
 * water, crops of the year, money), then what the soil needs according to the advisory, and the
 * ledger of what the entries changed.
 */
import { pick } from '@/contracts';
import { useLang, useT } from '@/i18n';
import { useMission } from '@/state/mission';
import '@/ui/advisory/strings';
import { fmtNum } from '@/ui/hud/format';
import { Ledger, MoneyGroup, ResetButton, SoilGroup, WaterGroup } from '@/ui/override';
import { SeasonPlanner } from './SeasonPlanner';
import './strings';

/**
 * The advisory's pH plan, said in two lines under the soil values. The slot where the soil-improvement
 * diagnoses (`src/core/soil`) will be listed once they exist; until then only what the engine already computes.
 */
function SoilNeeds() {
  const t = useT();
  const lang = useLang();
  const plan = useMission((s) => s.advisory?.ph);
  if (!plan || plan.amendment === 'none') return null;
  const rate = plan.rateTHa ? `${fmtNum(plan.rateTHa[0], 1)}-${fmtNum(plan.rateTHa[1], 1)} t/ha` : null;
  return (
    <section className="flex flex-col gap-1 rounded-sm bg-surface-2 px-4 py-3">
      <h4 className="workspace-card-title">{t('field.soil.needs')}</h4>
      <p className="workspace-copy text-ink-1">
        {t('field.soil.ph', { from: fmtNum(plan.current, 1), to: fmtNum(plan.target, 1), what: t(`advisory.ph.${plan.amendment}`).toLowerCase() })}
        {rate ? ` ${t('field.soil.rate', { r: rate })}` : ` ${t('advisory.ph.noRate')}.`}
      </p>
      <p className="t-caption">{pick(plan.basis, lang)}</p>
    </section>
  );
}

export function SoilTab() {
  const t = useT();
  const demo = useMission((s) => !!(s.parcel && 'defaultGroundTruth' in s.parcel && s.parcel.defaultGroundTruth));
  return (
    <div className="flex flex-col gap-4">
      {demo && <p className="t-caption text-ink-2">{t('gt.demoProfile')}</p>}
      <SoilGroup />
      <SoilNeeds />
      <WaterGroup />
      <div className="border-t border-line-1 pt-4">
        <SeasonPlanner />
      </div>
      <MoneyGroup />
      <Ledger />
      <div>
        <ResetButton />
      </div>
    </div>
  );
}
