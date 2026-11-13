import type { CropCategory, CropProfile, CropRequirements, CropRotationTraits, CropUrbanTraits, CropWaterModel } from '../../src/contracts';

/**
 * One hand-curated crop. Thresholds come from the EcoCrop row named in `eco`; anything in `req`
 * overrides that row and must be explained in `reqNotes` (they are published in the cleaning log
 * and in docs/SCORING.md).
 */
export interface CuratedSpec {
  /** Exact EcoCrop `name`; the crop id is its slug. Null when EcoCrop does not hold the species. */
  eco: string | null;
  /** Accepted name shown to the user when it differs from EcoCrop's, or the name when `eco` is null. */
  scientificName?: string;
  en: string;
  vi: string;
  aliases?: string[];
  category: CropCategory;
  lifeSpan?: CropProfile['lifeSpan'];
  /** Days from sowing (or the start of the yearly cycle) to harvest, when EcoCrop's range is unusable. */
  cycleDays?: [number, number];
  /** Thresholds that replace EcoCrop's, each explained in `reqNotes`. */
  req?: Partial<CropRequirements>;
  /** Complete requirements for a species EcoCrop does not hold. */
  fullReq?: CropRequirements;
  reqNotes?: string[];
  water: { model: CropWaterModel; assumed: boolean };
  rotation: CropRotationTraits;
  urban?: CropUrbanTraits;
  summary: [en: string, vi: string];
}

export type Rot = CropRotationTraits;
export type Urb = CropUrbanTraits;

/** Compact constructors so the overlay tables stay readable. */
export const rot = (
  family: string,
  nitrogenFixing: boolean,
  residue: Rot['residue'],
  rooting: Rot['rooting'],
  pestGroup: string,
  waterUse: Rot['waterUse'],
  coverValue: Rot['coverValue'],
): Rot => ({ family, nitrogenFixing, residue, rooting, pestGroup, waterUse, coverValue });

export const urb = (light: Urb['light'], container: boolean, difficulty: Urb['difficulty'], tags: string[]): Urb => ({
  suitable: true,
  light,
  container,
  difficulty,
  tags,
});

export const ALL_PHOTOPERIODS = ['short', 'neutral', 'long'];
