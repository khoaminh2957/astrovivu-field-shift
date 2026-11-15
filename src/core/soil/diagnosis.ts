import type { FactorKind, I18nText, ModelInput, ScoreTimeline } from '@/contracts';
import { tx } from '@/contracts';
import { getCrop } from '@/core/crops';
import { MAAS_HOFFMAN_PARAMS } from '@/core/scoring/literature';
import { soilFacts } from './facts';
import type { SoilDiagnosis, SoilFact, SoilGap, SoilGapAmount, SoilGapKey, SoilGapStatus } from './types';

const KEYS: SoilGapKey[] = ['ph', 'texture', 'drainage', 'depth', 'salinity', 'fertility'];
const LABELS: Record<SoilGapKey, I18nText> = {
  ph: tx('Soil reaction (pH)', 'Độ phản ứng của đất (pH)'),
  texture: tx('Soil texture', 'Thành phần cơ giới đất'),
  drainage: tx('Soil drainage', 'Khả năng thoát nước'),
  depth: tx('Soil depth', 'Độ sâu tầng đất'),
  salinity: tx('Electrical conductivity / salinity', 'Độ dẫn điện / độ mặn'),
  fertility: tx('Soil fertility (organic carbon, CEC)', 'Độ phì (carbon hữu cơ, CEC)'),
};
const KINDS: Record<SoilGapKey, FactorKind> = { ph: 'manageable', texture: 'fixed', drainage: 'manageable', depth: 'fixed', salinity: 'manageable', fertility: 'manageable' };
const r1 = (value: number) => Math.round(value * 10) / 10;

function factFor(facts: SoilFact[], key: string): SoilFact[] {
  return facts.filter((fact) => fact.key === key);
}

function amount(actual: number, lower: number, upper: number, unit: string): SoilGapAmount | null {
  if (actual < lower) return { amount: r1(lower - actual), unit, direction: 'raise' };
  if (actual > upper) return { amount: r1(actual - upper), unit, direction: 'lower' };
  return null;
}

function classOf(value: string | number | null | undefined): string | null {
  if (typeof value !== 'number') return value == null ? null : value.toLowerCase().includes('poor') ? 'poor' : value.toLowerCase().includes('excess') ? 'excessive' : value.toLowerCase().includes('well') || value.toLowerCase().includes('moderate') ? 'well' : null;
  return value < 20 ? 'very-shallow' : value < 50 ? 'shallow' : value <= 150 ? 'medium' : 'deep';
}

function factor(score: ScoreTimeline, key: SoilGapKey) {
  return score.snapshots.at(-1)?.factors.find((item) => item.key === key);
}

function statusForClass(actual: string | null, opt: string[], abs: string[]): SoilGapStatus {
  if (actual == null) return 'unknown';
  return opt.includes(actual) ? 'optimal' : abs.includes(actual) ? 'tolerated' : 'outside';
}

/** Returns the six-factor diagnosis using the scoring model's actual values and limiting factor. */
export function diagnoseSoil(input: ModelInput, score: ScoreTimeline): SoilDiagnosis | null {
  const crop = getCrop(input.cropId);
  if (!crop || !input.cropId) return null;

  const facts = soilFacts(input);
  const gaps: SoilGap[] = [];
  const phFact = facts.find((item) => item.key === 'ph');
  const ph = typeof phFact?.value === 'number' ? phFact.value : null;
  const phReq = crop.req.ph;
  const phGap = ph == null || crop.flags?.includes('ph-missing') ? null : amount(ph, phReq[1], phReq[2], 'pH');
  const phStatus: SoilGapStatus = ph == null || crop.flags?.includes('ph-missing') ? 'unknown' : ph >= phReq[1] && ph <= phReq[2] ? 'optimal' : ph >= phReq[0] && ph <= phReq[3] ? 'tolerated' : 'outside';
  const phEnds = phFact?.uncertainty ? [amount(phFact.uncertainty[0], phReq[1], phReq[2], 'pH'), amount(phFact.uncertainty[1], phReq[1], phReq[2], 'pH')] as [SoilGapAmount | null, SoilGapAmount | null] : undefined;
  gaps.push({ key: 'ph', label: LABELS.ph, facts: factFor(facts, 'ph'), optimal: `${phReq[1]}-${phReq[2]}`, tolerated: `${phReq[0]}-${phReq[3]}`, status: phStatus, gap: phGap, gapAtEnds: phEnds, limiting: false, kind: KINDS.ph, note: tx('Compared with the selected crop pH requirement.', 'Đã so sánh với yêu cầu pH của cây đã chọn.') });

  const textureActual = factor(score, 'texture')?.actual;
  const textureReq = crop.req.texture;
  gaps.push({ key: 'texture', label: LABELS.texture, facts: factFor(facts, 'texture_class'), optimal: textureReq?.opt.join(', ') ?? '?', tolerated: textureReq?.abs.join(', ') ?? '?', status: textureReq ? statusForClass(classOf(textureActual), textureReq.opt, textureReq.abs) : 'unknown', gap: null, limiting: false, kind: KINDS.texture });

  const drainageActual = factor(score, 'drainage')?.actual;
  const drainageReq = crop.req.drainage;
  gaps.push({ key: 'drainage', label: LABELS.drainage, facts: factFor(facts, 'drainage_class'), optimal: drainageReq?.opt.join(', ') ?? '?', tolerated: drainageReq?.abs.join(', ') ?? '?', status: drainageReq ? statusForClass(classOf(drainageActual), drainageReq.opt, drainageReq.abs) : 'unknown', gap: null, limiting: false, kind: KINDS.drainage });

  const depthActual = factor(score, 'depth')?.actual;
  const depthReq = crop.req.depth;
  gaps.push({ key: 'depth', label: LABELS.depth, facts: factFor(facts, 'depth_cm'), optimal: depthReq?.opt ?? '?', tolerated: depthReq?.abs ?? '?', status: depthReq ? statusForClass(classOf(depthActual), [depthReq.opt], [depthReq.abs]) : 'unknown', gap: null, limiting: false, kind: KINDS.depth });

  const ecFact = facts.find((item) => item.key === 'ec_dsm');
  const ec = typeof ecFact?.value === 'number' ? ecFact.value : null;
  const salinityReq = crop.req.salinity;
  const salinityGap = ec == null || salinityReq == null ? null : { amount: r1(ec - MAAS_HOFFMAN_PARAMS[salinityReq.opt].thresholdDsM), unit: 'dS/m', direction: 'lower' as const };
  if (salinityGap && salinityGap.amount <= 0) salinityGap.amount = 0;
  const salinityStatus: SoilGapStatus = ec == null || salinityReq == null ? 'unknown' : ec <= MAAS_HOFFMAN_PARAMS[salinityReq.opt].thresholdDsM ? 'optimal' : ec <= MAAS_HOFFMAN_PARAMS[salinityReq.abs].thresholdDsM ? 'tolerated' : 'outside';
  gaps.push({ key: 'salinity', label: LABELS.salinity, facts: factFor(facts, 'ec_dsm'), optimal: salinityReq ? `<= ${MAAS_HOFFMAN_PARAMS[salinityReq.opt].thresholdDsM} dS/m` : '?', tolerated: salinityReq ? `<= ${MAAS_HOFFMAN_PARAMS[salinityReq.abs].thresholdDsM} dS/m` : '?', status: salinityStatus, gap: salinityGap?.amount ? salinityGap : null, limiting: false, kind: KINDS.salinity });

  const fertilityFactor = factor(score, 'fertility');
  const fertilityActual = typeof fertilityFactor?.actual === 'string' ? fertilityFactor.actual : null;
  const fertilityReq = crop.req.fertility;
  const fertilityScore = fertilityFactor?.score ?? null;
  const fertilityStatus: SoilGapStatus = fertilityScore == null ? 'unknown' : fertilityScore === 1 ? 'optimal' : fertilityScore >= 0.7 ? 'tolerated' : 'outside';
  gaps.push({ key: 'fertility', label: LABELS.fertility, facts: [...factFor(facts, 'soc_gkg'), ...factFor(facts, 'cec_cmolkg')], optimal: fertilityReq?.opt ?? '?', tolerated: fertilityReq?.abs ?? '?', status: fertilityStatus, gap: null, limiting: false, kind: KINDS.fertility, note: fertilityActual ? tx(`Model class: ${fertilityActual}.`, `Phân lớp theo mô hình: ${fertilityActual}.`) : undefined });

  const limitingKey = (score.summary.limiting?.key ?? null) as SoilGapKey | null;
  for (const gap of gaps) gap.limiting = gap.key === limitingKey;
  const conflicts: I18nText[] = [];
  const om = facts.find((item) => item.key === 'om_pct')?.value;
  const soc = facts.find((item) => item.key === 'soc_gkg')?.value;
  if (typeof om === 'number' && typeof soc === 'number') {
    const converted = soc * 0.1724;
    if ((om < 2) !== (converted < 2)) conflicts.push(tx(`Organic matter sources disagree: ${om}% versus ${r1(converted)}% converted from SOC (${soc} g/kg).`, `Các nguồn chất hữu cơ mâu thuẫn: ${om}% so với ${r1(converted)}% quy đổi từ SOC (${soc} g/kg).`));
  }
  return { cropId: input.cropId, gaps, limitingKey: limitingKey && KEYS.includes(limitingKey) ? limitingKey : null, conflicts };
}
