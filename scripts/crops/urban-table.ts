import type { CropCategory, CropRequirements, CropUrbanTraits, UrbanHarvestType } from '../../src/contracts';
import { parseCsvObjects } from './atlas/csv';

export const URBAN_ATTRIBUTES = [
  'pot_depth_min',
  'pot_volume_min',
  'spacing',
  'sun_hours_min',
  'first_harvest_min',
  'first_harvest_max',
  'harvest_type',
  'needs_trellis',
  'difficulty',
] as const;

export type UrbanAttribute = (typeof URBAN_ATTRIBUTES)[number];

const EXPECTED_UNIT: Record<UrbanAttribute, string> = {
  pot_depth_min: 'cm',
  pot_volume_min: 'L',
  spacing: 'cm',
  sun_hours_min: 'h',
  first_harvest_min: 'days',
  first_harvest_max: 'days',
  harvest_type: '',
  needs_trellis: '',
  difficulty: '',
};

const NUMERIC_BOUNDS: Partial<Record<UrbanAttribute, [min: number, max: number, integer?: boolean]>> = {
  pot_depth_min: [10, 80],
  pot_volume_min: [1, 150],
  spacing: [2, 250],
  sun_hours_min: [1, 12],
  first_harvest_min: [14, 365, true],
  first_harvest_max: [14, 365, true],
};

const HARVEST_TYPES = new Set<UrbanHarvestType>(['cut-and-come-again', 'once', 'repeated-fruit']);

export interface UrbanTableCrop {
  cropId: string;
  potDepthCm?: number;
  potVolumeL?: number;
  spacingCm?: number;
  sunHoursMin?: number;
  firstHarvestDays?: [number, number];
  harvestType?: UrbanHarvestType;
  needsTrellis?: boolean;
  difficulty?: 1 | 2 | 3;
  sources: string[];
  notes: string[];
}

export interface UrbanTableResult {
  byCrop: Map<string, UrbanTableCrop>;
  rowsRead: number;
  resolutions: string[];
}

/**
 * Maps direct sun hours per day to the three urban light classes shown in the UI (`src/ui/urban/strings.ts`
 * and `src/core/urban/sun.ts`): >= 6 h = 'full', 3–6 h = 'partial', < 3 h = 'shade'.
 */
export function lightFromSunHours(hours: number): 'full' | 'partial' | 'shade' {
  if (hours >= 6) return 'full';
  if (hours >= 3) return 'partial';
  return 'shade';
}

/**
 * A new candidate crop enters the urban catalogue only when `urban.csv` provides all three
 * core container attributes: `sun_hours_min`, `pot_depth_min`, and `difficulty`.
 */
export function qualifiesForUrbanCatalog(entry: UrbanTableCrop | undefined): boolean {
  return (
    entry != null &&
    entry.sunHoursMin != null &&
    entry.potDepthCm != null &&
    entry.difficulty != null
  );
}

interface RawAttrObservation {
  line: number;
  value: string;
  numValue?: number;
  source: string;
  url: string;
  accessed: string;
  note: string;
}

/**
 * Reads and validates `data/crops/atlas/urban.csv`. Throws with the 1-based CSV line number on any
 * unknown `crop_id`, unknown `attribute`, out-of-range value, unit mismatch, or missing provenance.
 * When two sources give different values for the same `(crop_id, attribute)`, chooses the more
 * conservative figure and logs the resolution.
 */
export function readUrbanTable(csvText: string, validCropIds: ReadonlySet<string>): UrbanTableResult {
  const rows = parseCsvObjects(csvText);
  const attrSet = new Set<string>(URBAN_ATTRIBUTES);
  const grouped = new Map<string, Map<UrbanAttribute, RawAttrObservation[]>>();
  const sourcesByCrop = new Map<string, Set<string>>();

  for (let i = 0; i < rows.length; i++) {
    const line = i + 2;
    const r = rows[i]!;
    const cropId = (r.crop_id ?? '').trim();
    const attr = (r.attribute ?? '').trim() as UrbanAttribute;
    const value = (r.value ?? '').trim();
    const unit = (r.unit ?? '').trim();
    const source = (r.source ?? '').trim();
    const url = (r.url ?? '').trim();
    const accessed = (r.accessed ?? '').trim();
    const note = (r.note ?? '').trim();

    if (!cropId) throw new Error(`urban.csv line ${line}: missing crop_id`);
    if (!validCropIds.has(cropId)) {
      throw new Error(`urban.csv line ${line}: unknown crop_id "${cropId}" (not in data/crops/atlas/crops.csv)`);
    }
    if (!attrSet.has(attr)) {
      throw new Error(`urban.csv line ${line} (${cropId}): invalid attribute "${attr}"`);
    }
    if (!value) {
      throw new Error(`urban.csv line ${line} (${cropId}.${attr}): empty value (omit rows without a sourced value)`);
    }
    if (!source) {
      throw new Error(`urban.csv line ${line} (${cropId}.${attr}): missing source`);
    }
    if (!/^https?:\/\/\S+$/.test(url)) {
      throw new Error(`urban.csv line ${line} (${cropId}.${attr}): missing or invalid url "${url}"`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(accessed)) {
      throw new Error(`urban.csv line ${line} (${cropId}.${attr}): missing or invalid accessed date "${accessed}" (expected YYYY-MM-DD)`);
    }
    const expectedUnit = EXPECTED_UNIT[attr];
    if (unit !== expectedUnit) {
      throw new Error(`urban.csv line ${line} (${cropId}.${attr}): unit "${unit}" does not match expected "${expectedUnit}"`);
    }

    let numValue: number | undefined;
    const bounds = NUMERIC_BOUNDS[attr];
    if (bounds) {
      const n = Number(value);
      const [lo, hi, mustBeInt] = bounds;
      if (!Number.isFinite(n) || n < lo || n > hi || (mustBeInt && !Number.isInteger(n))) {
        throw new Error(
          `urban.csv line ${line} (${cropId}.${attr}): value "${value}" outside valid range [${lo}, ${hi}]${mustBeInt ? ' (integer)' : ''}`,
        );
      }
      numValue = n;
    } else if (attr === 'harvest_type') {
      if (!HARVEST_TYPES.has(value as UrbanHarvestType)) {
        throw new Error(`urban.csv line ${line} (${cropId}.harvest_type): invalid value "${value}"`);
      }
    } else if (attr === 'needs_trellis') {
      if (value !== 'yes' && value !== 'no') {
        throw new Error(`urban.csv line ${line} (${cropId}.needs_trellis): invalid value "${value}" (expected yes or no)`);
      }
    } else if (attr === 'difficulty') {
      if (value !== '1' && value !== '2' && value !== '3') {
        throw new Error(`urban.csv line ${line} (${cropId}.difficulty): invalid value "${value}" (expected 1, 2 or 3)`);
      }
      if (!note) {
        throw new Error(`urban.csv line ${line} (${cropId}.difficulty): note is required to record source wording and mapping to 1..3`);
      }
      numValue = Number(value);
    }

    let cropMap = grouped.get(cropId);
    if (!cropMap) {
      cropMap = new Map();
      grouped.set(cropId, cropMap);
    }
    const list = cropMap.get(attr) ?? [];
    list.push({ line, value, numValue, source, url, accessed, note });
    cropMap.set(attr, list);

    let srcSet = sourcesByCrop.get(cropId);
    if (!srcSet) {
      srcSet = new Set();
      sourcesByCrop.set(cropId, srcSet);
    }
    srcSet.add(`${source} (${url}, accessed ${accessed})`);
  }

  const byCrop = new Map<string, UrbanTableCrop>();
  const resolutions: string[] = [];

  for (const [cropId, attrMap] of grouped.entries()) {
    const entry: UrbanTableCrop = {
      cropId,
      sources: [...(sourcesByCrop.get(cropId) ?? [])],
      notes: [],
    };

    const resolveMax = (attr: UrbanAttribute): number | undefined => {
      const obs = attrMap.get(attr);
      if (!obs?.length) return undefined;
      let chosen = obs[0]!;
      for (const o of obs.slice(1)) {
        if ((o.numValue ?? 0) > (chosen.numValue ?? 0)) chosen = o;
      }
      const distinct = new Set(obs.map((o) => o.numValue));
      if (distinct.size > 1) {
        const unit = EXPECTED_UNIT[attr] ? ` ${EXPECTED_UNIT[attr]}` : '';
        const detail = obs.map((o) => `${o.value}${unit} [${o.source}]`).join(' vs ');
        const msg = `${cropId}.${attr}: multiple sources (${detail}) -> took conservative ${chosen.value}${unit}`;
        resolutions.push(msg);
        entry.notes.push(msg);
      }
      return chosen.numValue;
    };

    entry.potDepthCm = resolveMax('pot_depth_min');
    entry.potVolumeL = resolveMax('pot_volume_min');
    entry.spacingCm = resolveMax('spacing');
    entry.sunHoursMin = resolveMax('sun_hours_min');
    const fhMin = resolveMax('first_harvest_min');
    const fhMax = resolveMax('first_harvest_max');
    if ((fhMin != null) !== (fhMax != null)) {
      const line = (attrMap.get('first_harvest_min') ?? attrMap.get('first_harvest_max'))![0]!.line;
      throw new Error(`urban.csv line ${line} (${cropId}): first_harvest_min and first_harvest_max must both be provided together`);
    }
    if (fhMin != null && fhMax != null) {
      if (fhMin > fhMax) {
        const line = attrMap.get('first_harvest_min')![0]!.line;
        throw new Error(`urban.csv line ${line} (${cropId}): first_harvest_min (${fhMin}) > first_harvest_max (${fhMax})`);
      }
      entry.firstHarvestDays = [fhMin, fhMax];
    }

    const htObs = attrMap.get('harvest_type');
    if (htObs?.length) {
      const distinct = new Set(htObs.map((o) => o.value));
      if (distinct.size > 1) {
        throw new Error(`urban.csv line ${htObs[1]!.line} (${cropId}.harvest_type): conflicting harvest_type values (${[...distinct].join(' vs ')})`);
      }
      entry.harvestType = htObs[0]!.value as UrbanHarvestType;
    }

    const trObs = attrMap.get('needs_trellis');
    if (trObs?.length) {
      const hasYes = trObs.some((o) => o.value === 'yes');
      const distinct = new Set(trObs.map((o) => o.value));
      if (distinct.size > 1) {
        const detail = trObs.map((o) => `${o.value} [${o.source}]`).join(' vs ');
        const msg = `${cropId}.needs_trellis: multiple sources (${detail}) -> took conservative yes`;
        resolutions.push(msg);
        entry.notes.push(msg);
      }
      entry.needsTrellis = hasYes;
    }

    const diffVal = resolveMax('difficulty');
    if (diffVal != null) {
      entry.difficulty = diffVal as 1 | 2 | 3;
    }

    byCrop.set(cropId, entry);
  }

  return { byCrop, rowsRead: rows.length, resolutions };
}

function inferCandidateTags(
  crop: { category: CropCategory; cycleDays: [number, number]; req: CropRequirements },
  light: 'full' | 'partial' | 'shade',
  entry: UrbanTableCrop,
): string[] {
  const tags = new Set<string>();
  if (crop.category === 'vegetable' || crop.category === 'root' || crop.category === 'pulse') tags.add('vegetables');
  else if (crop.category === 'herb' || crop.category === 'spice') tags.add('herbs');
  else if (crop.category === 'ornamental') tags.add('flowers');
  else if (crop.category === 'fruit') tags.add('fruit');

  if (entry.harvestType === 'repeated-fruit' && crop.category === 'vegetable') tags.add('fruit');
  if (entry.harvestType === 'cut-and-come-again') tags.add('cut-and-come-again');
  if (entry.needsTrellis) tags.add('climber');
  const firstMin = entry.firstHarvestDays?.[0] ?? crop.cycleDays[0];
  if (firstMin <= 45) tags.add('fast');
  if (light === 'partial' || light === 'shade') tags.add('shade-easy');
  if (crop.req.tempC[2] <= 24) tags.add('cool-season');
  if (crop.req.tempC[2] >= 28 && crop.req.tempC[3] >= 35) tags.add('heat-tolerant');
  return [...tags];
}

/**
 * Merges a crop's `urban.csv` entry with its overlay `CropUrbanTraits` (if curated) or builds
 * a new `CropUrbanTraits` when an uncurated `urban_candidate` qualifies (`sun_hours_min`,
 * `pot_depth_min`, and `difficulty` all present).
 */
export function mergeUrbanTraits(
  crop: { id: string; category: CropCategory; cycleDays: [number, number]; req: CropRequirements },
  baseUrban: CropUrbanTraits | undefined,
  entry: UrbanTableCrop | undefined,
): { urban?: CropUrbanTraits; notes: string[] } {
  const notes: string[] = [];
  if (!baseUrban && !qualifiesForUrbanCatalog(entry)) {
    return { urban: undefined, notes };
  }
  if (!entry) {
    return { urban: baseUrban, notes };
  }

  const derivedLight = entry.sunHoursMin != null ? lightFromSunHours(entry.sunHoursMin) : baseUrban?.light ?? 'full';
  const derivedDifficulty = entry.difficulty ?? baseUrban?.difficulty ?? 1;
  const derivedContainer = entry.potDepthCm != null ? entry.potDepthCm <= 40 : baseUrban?.container ?? true;

  if (baseUrban) {
    if (entry.sunHoursMin != null && derivedLight !== baseUrban.light) {
      notes.push(`urban.light overridden by urban.csv: ${baseUrban.light} -> ${derivedLight} (sun_hours_min = ${entry.sunHoursMin} h)`);
    }
    if (entry.difficulty != null && derivedDifficulty !== baseUrban.difficulty) {
      notes.push(`urban.difficulty overridden by urban.csv: ${baseUrban.difficulty} -> ${derivedDifficulty}`);
    }
    if (entry.potDepthCm != null && derivedContainer !== baseUrban.container) {
      notes.push(`urban.container overridden by urban.csv: ${baseUrban.container} -> ${derivedContainer} (pot_depth_min = ${entry.potDepthCm} cm)`);
    }
  }

  const tags = baseUrban ? [...baseUrban.tags] : inferCandidateTags(crop, derivedLight, entry);
  notes.push(...entry.notes);
  notes.push(
    `urban container table (data/crops/atlas/urban.csv): depth=${entry.potDepthCm ?? '—'} cm, volume=${entry.potVolumeL ?? '—'} L, spacing=${entry.spacingCm ?? '—'} cm, sun=${entry.sunHoursMin ?? '—'} h (${derivedLight}), harvest=${entry.firstHarvestDays ? `${entry.firstHarvestDays[0]}-${entry.firstHarvestDays[1]} d` : '—'} (${entry.harvestType ?? '—'}), trellis=${entry.needsTrellis == null ? '—' : entry.needsTrellis ? 'yes' : 'no'}, difficulty=${derivedDifficulty}; sources: ${entry.sources.join(' | ')}`,
  );

  const urban: CropUrbanTraits = {
    suitable: true,
    light: derivedLight,
    container: derivedContainer,
    difficulty: derivedDifficulty,
    tags,
    ...(entry.potDepthCm != null ? { potDepthCm: entry.potDepthCm } : {}),
    ...(entry.potVolumeL != null ? { potVolumeL: entry.potVolumeL } : {}),
    ...(entry.spacingCm != null ? { spacingCm: entry.spacingCm } : {}),
    ...(entry.sunHoursMin != null ? { sunHoursMin: entry.sunHoursMin } : {}),
    ...(entry.firstHarvestDays != null ? { firstHarvestDays: entry.firstHarvestDays } : {}),
    ...(entry.harvestType != null ? { harvestType: entry.harvestType } : {}),
    ...(entry.needsTrellis != null ? { needsTrellis: entry.needsTrellis } : {}),
    ...(entry.sources.length ? { sources: entry.sources } : {}),
  };

  return { urban, notes };
}
