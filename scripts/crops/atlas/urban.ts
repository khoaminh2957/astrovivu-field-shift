/**
 * Rule-based selection of urban / container candidate crops from FAO EcoCrop attributes (D1, #14).
 *
 * Principle: only EcoCrop columns (`life_form`, `habit`, `category`, `life_span`, `cycle_min_days`)
 * and documented numeric thresholds enter the rule. No crop names or ids appear here.
 *
 * The result is written to `data/crops/atlas/urban_candidates.csv`, not to `crops.csv`: the market
 * database mirrors `crops.csv` column for column (scripts/market/atlas.ts), so a column added there
 * would require changing a migration that is already applied.
 */
import type { AtlasSpecies } from './ecocrop';

export const URBAN_RULE = {
  /** Maximum shortest growing cycle (days) for the short-cycle clause. */
  maxCycleMinDays: 120,
  /** Maximum shortest growing cycle (days) for non-climbing staple-category vegetables (radish, turnip, bush bean). */
  maxStapleVegetableCycleMinDays: 60,
  /** Primary garden / balcony use categories in EcoCrop. */
  gardenCategories: ['vegetables', 'fruits & nuts', 'ornamentals/turf'] as const,
  /** Aromatic / culinary herb category in EcoCrop. */
  aromaticCategory: 'medicinals & aromatic',
  /** Broadacre field / industrial categories that disqualify a purely medicinal/aromatic row unless it is a climber. */
  fieldCategories: [
    'cereals & pseudocereals',
    'pulses (grain legumes)',
    'roots/tubers',
    'forage/pasture',
    'materials',
    'cover crop',
    'forest/wood',
  ] as const,
  /** Staple field-crop categories that require either climbing habit or a very fast cycle (<= 60 days). */
  stapleCategories: ['cereals & pseudocereals', 'pulses (grain legumes)', 'roots/tubers'] as const,
  /** Allowed non-tree life forms for container / balcony growing. */
  allowedLifeForms: ['herb', 'sub-shrub', 'shrub', 'vine'] as const,
  /** Life forms allowed for the perennial aromatic herb clause. */
  perennialHerbLifeForms: ['herb', 'sub-shrub'] as const,
  /** Disallowed woody life form. */
  excludedLifeForm: 'tree',
  /** Climbing growth habit in EcoCrop. */
  climberHabit: 'climber/scrambler/scadent',
  /** Perennial life span token in EcoCrop. */
  perennialLifeSpan: 'perennial',
} as const;

function tokens(cell: string): Set<string> {
  return new Set(
    cell
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Evaluates whether an EcoCrop species row qualifies as an urban / container candidate by rule,
 * returning `{ candidate, rule }` where `rule` names the matching clause(s) (`short-cycle`,
 * `perennial-aromatic-herb`, or `short-cycle;perennial-aromatic-herb`) or `""` when not selected.
 */
export function urbanCandidate(s: AtlasSpecies | null | undefined): { candidate: boolean; rule: string } {
  if (!s) return { candidate: false, rule: '' };

  const lifeForms = tokens(s.lifeForm);
  const categories = tokens(s.category);
  const habits = tokens(s.habit);
  const lifeSpans = tokens(s.lifeSpan);

  // 1. Life form: must include herb, sub-shrub, shrub or vine, and must not include tree.
  const hasAllowedLifeForm = URBAN_RULE.allowedLifeForms.some((lf) => lifeForms.has(lf));
  if (!hasAllowedLifeForm || lifeForms.has(URBAN_RULE.excludedLifeForm)) {
    return { candidate: false, rule: '' };
  }

  // 2. Category & broadacre field-crop filter:
  //    - Must belong to a garden category (vegetables, fruits & nuts, ornamentals/turf) or medicinals & aromatic.
  //    - A species whose only qualifying category is medicinals & aromatic is excluded if it also carries
  //      a broadacre field/industrial category, unless its habit is climbing.
  //    - A species in a staple category (cereals, pulses, roots/tubers) must either be a climber or have a
  //      fast garden cycle (<= 60 days).
  const hasGardenCategory = URBAN_RULE.gardenCategories.some((c) => categories.has(c));
  const hasAromatic = categories.has(URBAN_RULE.aromaticCategory);
  if (!hasGardenCategory && !hasAromatic) {
    return { candidate: false, rule: '' };
  }

  const isClimber = habits.has(URBAN_RULE.climberHabit);
  const hasFieldCategory = URBAN_RULE.fieldCategories.some((c) => categories.has(c));
  if (!hasGardenCategory && hasFieldCategory && !isClimber) {
    return { candidate: false, rule: '' };
  }

  const hasStapleCategory = URBAN_RULE.stapleCategories.some((c) => categories.has(c));
  const fastStaple = s.cycleMin != null && s.cycleMin > 0 && s.cycleMin <= URBAN_RULE.maxStapleVegetableCycleMinDays;
  if (hasStapleCategory && !isClimber && !fastStaple) {
    return { candidate: false, rule: '' };
  }

  // 3. Cycle / longevity clauses:
  const shortCycle = s.cycleMin != null && s.cycleMin > 0 && s.cycleMin <= URBAN_RULE.maxCycleMinDays;
  const perennialHerb =
    lifeSpans.has(URBAN_RULE.perennialLifeSpan) &&
    hasAromatic &&
    URBAN_RULE.perennialHerbLifeForms.some((lf) => lifeForms.has(lf));

  if (!shortCycle && !perennialHerb) {
    return { candidate: false, rule: '' };
  }

  const matchedRules: string[] = [];
  if (shortCycle) matchedRules.push('short-cycle');
  if (perennialHerb) matchedRules.push('perennial-aromatic-herb');
  return { candidate: true, rule: matchedRules.join(';') };
}

/** One row of `urban_candidates.csv`: `crop_id`, `urban_candidate` (`yes` or empty), `urban_candidate_rule`. */
export function urbanCandidateRow(cropId: string, s: AtlasSpecies | null | undefined): [string, string, string] {
  const { candidate, rule } = urbanCandidate(s);
  return [cropId, candidate ? 'yes' : '', rule];
}
