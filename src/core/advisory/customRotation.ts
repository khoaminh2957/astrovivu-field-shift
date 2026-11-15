/**
 * Interactive what-if editing of a rotation strategy: list the crops that fit a clicked season
 * slot on the calendar, swap a slot to another crop (or fallow), and re-score the edited strategy
 * alongside the engine's strategies with the exact same metrics, economics and risk rules.
 */
import type { CropProfile, I18nText, ModelInput, PrevalenceLevel, RotationSeason, RotationStrategy, SlotCropChoice } from '@/contracts';
import { getCrop, listCrops } from '@/core/crops';
import { TRIAL_MIN_COMPATIBILITY, windowMonths } from '@/core/scoring';
import { type Candidate, type Evaluated, type Plan, countryStatus, evaluate, isStand, isTree, makeCtx, proposable, scoreAll } from './rotation';
import { cropText, monthsFrom, tx, wrapMonth } from './util';

export interface CustomRotationSpec {
  /** Name of the strategy the farmer started editing from. */
  fromName: I18nText;
  years: number;
  seasons: RotationSeason[];
}

const lenOf = (s: Pick<RotationSeason, 'startMonth' | 'endMonth'>): number => ((s.endMonth - s.startMonth + 12) % 12) + 1;

function seasonToPlan(s: RotationSeason): Plan {
  return {
    cropId: s.cropId,
    start: s.startMonth,
    len: lenOf(s),
    year: s.year ?? 0,
    share: s.share ?? 1,
    ...(s.slotRole ? { role: s.slotRole } : {}),
    ...(s.detail?.role === 'legume' ? { forN: true } : {}),
  };
}

/** Contiguous run of free months (1..12, wrapping Dec) in `year` that contains `anchor`. */
function freeRunAt(free: ReadonlySet<number>, anchor: number): number[] {
  if (!free.has(anchor)) return [];
  if (free.size >= 12) return monthsFrom(anchor, 12);
  let start = anchor;
  while (free.has(wrapMonth(start - 1))) start = wrapMonth(start - 1);
  const run: number[] = [];
  let cur = start;
  while (free.has(cur) && run.length < 12) {
    run.push(cur);
    cur = wrapMonth(cur + 1);
  }
  return run;
}

function toEvaluated(r: RotationStrategy): Evaluated {
  const { score: _score, ...rest } = r;
  return { ...rest, costPerYear: r.economics.perYear.costUsd };
}

/**
 * Curated crops (plus `'fallow'` when at least one other crop remains) that fit the calendar window
 * of `strategy.seasons[seasonIndex]`, sorted from highest to lowest suitability on this field.
 */
export function slotCropChoices(input: ModelInput, strategy: RotationStrategy, seasonIndex: number): SlotCropChoice[] {
  const target = strategy.seasons[seasonIndex];
  if (!target) return [];
  const ctx = makeCtx(input);
  const otherPlans = strategy.seasons
    .map((s, idx) => ({ s, idx }))
    .filter((x) => x.idx !== seasonIndex && x.s.cropId !== 'fallow')
    .map((x) => seasonToPlan(x.s));
  const canFallow = target.cropId !== 'fallow' && otherPlans.length >= 1;
  const avoid = new Set(input.groundTruth.avoidCropIds ?? []);
  const share = target.share ?? 1;
  const year = target.year ?? 0;

  const choices: SlotCropChoice[] = [];

  if (share < 1) {
    const hostId = otherPlans.find((p) => p.share === 1 || isTree(getCrop(p.cropId)!))?.cropId;
    const pool = listCrops().filter((c) => {
      if (!c.curated || !c.rotation || avoid.has(c.id) || c.id === hostId) return false;
      if (target.slotRole === 'inter-row') return c.category === 'cover';
      if (target.slotRole === 'companion') return isTree(c);
      return isTree(c) || (c.lifeSpan === 'annual' && c.category !== 'cover');
    });
    for (const c of pool) {
      const f = ctx.fit(c.id);
      const cycleMonths = c.lifeSpan === 'annual' ? windowMonths(c) : 12;
      const startMonth = c.lifeSpan === 'annual' ? ctx.best(c.id).month : 1;
      const suitability = f.known ? (c.lifeSpan === 'annual' ? f.s[startMonth - 1] : Math.max(...f.s)) : null;
      choices.push({ cropId: c.id, label: cropText(c.id), suitability, startMonth, cycleMonths });
    }
  } else {
    const occupied = new Set<number>();
    for (const p of otherPlans) {
      if (p.year === year && p.share === 1) {
        for (const m of monthsFrom(p.start, p.len)) occupied.add(m);
      }
    }
    const free = new Set<number>();
    for (let m = 1; m <= 12; m++) if (!occupied.has(m)) free.add(m);
    const run = freeRunAt(free, target.startMonth);
    const runSet = new Set(run);
    const uplandStand = otherPlans.some((p) => {
      const c = getCrop(p.cropId);
      return !!c && isStand(c);
    });

    for (const c of listCrops()) {
      if (!c.curated || !c.rotation || avoid.has(c.id)) continue;
      if (uplandStand && c.id === 'oryza-sativa') continue;
      const f = ctx.fit(c.id);
      if (c.lifeSpan !== 'annual') {
        if (run.length < 12) continue;
        const suitability = f.known ? Math.max(...f.s) : null;
        choices.push({ cropId: c.id, label: cropText(c.id), suitability, startMonth: 1, cycleMonths: 12 });
        continue;
      }
      const len = windowMonths(c);
      if (len > run.length) continue;
      const validStarts = run.filter((st) => monthsFrom(st, len).every((m) => runSet.has(m)));
      if (!validStarts.length) continue;
      let bestStart = validStarts[0];
      const rank = (st: number) => [f.s[st - 1], st === target.startMonth ? 1 : 0, f.rel[st - 1] ?? 0] as const;
      for (const st of validStarts.slice(1)) {
        const a = rank(st);
        const b = rank(bestStart);
        if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) bestStart = st;
      }
      const suitability = f.known ? f.s[bestStart - 1] : null;
      choices.push({ cropId: c.id, label: cropText(c.id), suitability, startMonth: bestStart, cycleMonths: len });
    }
  }

  // With a country table: every choice says how much of it the country grows. A crop the country
  // reports none of is offered only where it suits the field (the threshold of the ranking's
  // second list), and after every other crop: it is a new crop that needs a trial.
  if (input.country) {
    const kept = choices.filter((c) => proposable(input, c.cropId) || (c.suitability ?? 0) >= TRIAL_MIN_COMPATIBILITY * 100);
    choices.length = 0;
    for (const c of kept) {
      const status = countryStatus(input, c.cropId);
      const level: PrevalenceLevel = status === 'unknown' ? 'unknown' : (input.country.prevalence[c.cropId]?.level ?? 'unknown');
      // A crop the grower grows is grown here: a statistic that reports none of it is not repeated.
      choices.push(status === 'absent' && proposable(input, c.cropId) ? c : { ...c, prevalence: level });
    }
  }
  const trial = (c: SlotCropChoice) => (c.prevalence === 'absent' ? 1 : 0);
  choices.sort((a, b) => trial(a) - trial(b) || (b.suitability ?? -1) - (a.suitability ?? -1) || a.label.en.localeCompare(b.label.en));
  if (canFallow) {
    choices.unshift({
      cropId: 'fallow',
      label: cropText('fallow'),
      suitability: null,
      startMonth: target.startMonth,
      cycleMonths: lenOf(target),
    });
  }
  return choices;
}

function buildPlansFromSpec(spec: CustomRotationSpec): Plan[] {
  return spec.seasons.filter((s) => s.cropId !== 'fallow' && !!getCrop(s.cropId)).map(seasonToPlan);
}

/** Re-evaluates a saved custom rotation spec against the current `input` and `baseRotations`. */
export function evaluateCustomRotation(input: ModelInput, baseRotations: readonly RotationStrategy[], spec: CustomRotationSpec): RotationStrategy[] {
  const engine = baseRotations.filter((r) => r.kind !== 'custom');
  const plans = buildPlansFromSpec(spec);
  if (!plans.length || !engine.length) return [...engine];
  const ctx = makeCtx(input);
  const current = engine.find((r) => r.kind === 'current');
  const curEval = current ? toEvaluated(current) : null;
  const cand: Candidate = {
    kind: 'custom',
    plans,
    years: Math.max(1, spec.years, ...plans.map((p) => p.year + 1)),
    why: [
      tx(
        `Modified by you from "${spec.fromName.en}" to test your own crop choice on this field.`,
        `Do bạn tự chỉnh từ "${spec.fromName.vi}" để thử lựa chọn cây trồng của riêng mình trên thửa ruộng này.`,
      ),
    ],
  };
  const customEval = evaluate(ctx, cand, curEval, 'custom');
  return scoreAll([...engine.map(toEvaluated), customEval], input.priorities);
}

function inferRole(target: RotationSeason, crop: CropProfile, otherPlans: readonly Plan[]): Plan['role'] {
  if ((target.share ?? 1) < 1) return target.slotRole;
  if (crop.category === 'cover') return 'cover';
  if (crop.lifeSpan === 'annual' && otherPlans.some((p) => isStand(getCrop(p.cropId)!))) return 'break';
  return undefined;
}

/**
 * Replaces `sourceStrategy.seasons[seasonIndex]` with `newCropId` (`'fallow'` removes that crop
 * season) and returns both the updated `CustomRotationSpec` and the re-scored `RotationStrategy[]`.
 */
export function swapRotationSeason(
  input: ModelInput,
  baseRotations: readonly RotationStrategy[],
  sourceStrategy: RotationStrategy,
  seasonIndex: number,
  newCropId: string,
  prevCustom?: CustomRotationSpec | null,
): { spec: CustomRotationSpec; rotations: RotationStrategy[] } | null {
  const target = sourceStrategy.seasons[seasonIndex];
  if (!target) return null;
  let otherPlans = sourceStrategy.seasons
    .map((s, idx) => ({ s, idx }))
    .filter((x) => x.idx !== seasonIndex && x.s.cropId !== 'fallow')
    .map((x) => seasonToPlan(x.s));

  let nextPlans: Plan[];
  if (newCropId === 'fallow') {
    if (!otherPlans.length) return null;
    nextPlans = otherPlans;
  } else {
    const crop = getCrop(newCropId);
    const choice = slotCropChoices(input, sourceStrategy, seasonIndex).find((c) => c.cropId === newCropId);
    if (!crop || !choice) return null;
    const year = target.year ?? 0;
    const share = target.share ?? 1;
    const oldCrop = getCrop(target.cropId);
    // Replacing the host tree of an intercrop with a non-tree removes fractional tree companions in that year.
    if (share === 1 && oldCrop && isTree(oldCrop) && !isTree(crop)) {
      otherPlans = otherPlans.filter((p) => !(p.year === year && p.share < 1));
    }
    const role = inferRole(target, crop, otherPlans);
    const forN =
      share === 1 &&
      crop.lifeSpan === 'annual' &&
      crop.category !== 'cover' &&
      !!crop.rotation?.nitrogenFixing &&
      otherPlans.some((p) => !getCrop(p.cropId)?.rotation?.nitrogenFixing);
    const added: Plan = {
      cropId: newCropId,
      start: choice.startMonth,
      len: choice.cycleMonths,
      year,
      share,
      ...(role ? { role } : {}),
      ...(forN ? { forN: true } : {}),
    };
    nextPlans = [...otherPlans, added].sort((a, b) => a.year - b.year || (a.share === 1 ? 0 : 1) - (b.share === 1 ? 0 : 1) || a.start - b.start);
  }

  const fromName = sourceStrategy.kind === 'custom' && prevCustom ? prevCustom.fromName : sourceStrategy.name;
  const years = Math.max(1, sourceStrategy.years, ...nextPlans.map((p) => p.year + 1));
  const draftSeasons: RotationSeason[] = nextPlans.map((p) => ({
    cropId: p.cropId,
    label: cropText(p.cropId),
    startMonth: p.start,
    endMonth: wrapMonth(p.start + p.len - 1),
    year: p.year,
    ...(p.share < 1 ? { share: p.share } : {}),
    ...(p.role ? { slotRole: p.role } : {}),
  }));
  const rotations = evaluateCustomRotation(input, baseRotations, { fromName, years, seasons: draftSeasons });
  const built = rotations.find((r) => r.kind === 'custom');
  if (!built) return null;
  return { spec: { fromName, years: built.years, seasons: built.seasons }, rotations };
}
