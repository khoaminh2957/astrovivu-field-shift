/**
 * Stage directions for the three characters: which clip each plays when the story moves on, and
 * the small things they do between notes. Pure: the timing lives in `useStageDirector`.
 *
 * A reaction follows what the scene and the notes already say; it never says anything of its own.
 */
import type { FarmNote, FarmScene, FarmVoice, SkyKind } from '@/core/farm';
import type { MascotClip } from '@/ui/mascot';

export interface StoryFrame {
  sky: SkyKind;
  harvesting: boolean;
  sowing: boolean;
  soil: FarmScene['soil']['state'];
  notes: Record<FarmVoice, Pick<FarmNote, 'mood' | 'alert'>>;
}

export interface Reaction {
  who: FarmVoice;
  clip: MascotClip;
  /** True when the clip points at the field: the character also looks at it. */
  toField: boolean;
}

export const VOICES: FarmVoice[] = ['space', 'soil', 'rice'];

/** Seed stands left of the field, Rice and the Satellite right of it: each points toward the middle. */
export const POINT_TO_FIELD: Record<FarmVoice, MascotClip> = { space: 'PointLeft', soil: 'Point', rice: 'PointLeft' };

/** What each character does now and then while nobody is reading a note. */
export const IDLE_CLIPS: Record<FarmVoice, MascotClip[]> = {
  space: ['Scan', 'Wave', 'Spin', 'Scan', 'Point', 'Talk'],
  soil: ['LeafWiggle', 'Wave', 'Think', 'Jump', 'Talk', 'Point'],
  rice: ['LeafWiggle', 'Wave', 'Spin', 'LeafWiggle', 'Jump', 'Talk'],
};

export function frameOf(scene: FarmScene, notes: Record<FarmVoice, FarmNote>): StoryFrame {
  return {
    sky: scene.weather.kind,
    harvesting: scene.crop.harvested != null,
    sowing: scene.crop.sowing,
    soil: scene.soil.state,
    notes: { space: pick(notes.space), soil: pick(notes.soil), rice: pick(notes.rice) },
  };
}
const pick = (n: FarmNote): Pick<FarmNote, 'mood' | 'alert'> => ({ mood: n.mood, alert: n.alert });

const SKY_CLIP: Partial<Record<SkyKind, MascotClip>> = { 'heavy-rain': 'Jump', rain: 'Scan', hot: 'Think', frost: 'Think' };

/** The one thing a character's own part of the scene asks of it, when that part changed. */
function ownCue(who: FarmVoice, prev: StoryFrame, next: StoryFrame): MascotClip | null {
  if (who === 'space' && next.sky !== prev.sky) return SKY_CLIP[next.sky] ?? null;
  if (who === 'rice' && next.harvesting && !prev.harvesting) return 'Celebrate';
  if (who === 'rice' && next.sowing && !prev.sowing) return 'Jump';
  if (who === 'soil' && next.soil !== prev.soil) return next.soil === 'dry' ? 'Think' : next.soil === 'wet' ? 'LeafWiggle' : null;
  return null;
}

/**
 * How the characters answer a step of the story. Nothing on the first frame (they make their
 * entrance instead), nothing for a character whose part did not change.
 */
export function storyReactions(prev: StoryFrame | null, next: StoryFrame): Reaction[] {
  if (!prev) return [];
  const out: Reaction[] = [];
  for (const who of VOICES) {
    const a = prev.notes[who];
    const b = next.notes[who];
    const own = ownCue(who, prev, next);
    if (own) out.push({ who, clip: own, toField: false });
    else if (b.alert && !a.alert) out.push({ who, clip: POINT_TO_FIELD[who], toField: true });
    else if (b.mood !== a.mood) {
      if (b.mood === 'worried') out.push({ who, clip: 'Think', toField: false });
      else if (b.mood === 'glad') out.push({ who, clip: who === 'space' ? 'Spin' : 'Celebrate', toField: false });
    }
  }
  return out;
}

/** A small deterministic-or-not random source, so the routine can be tested. */
export type Rand = () => number;

/** Picks who does something idle next: not the one who just moved, not one still busy. */
export function nextIdle(rand: Rand, busyUntil: Record<FarmVoice, number>, last: FarmVoice | null, now: number): { who: FarmVoice; clip: MascotClip } | null {
  const free = VOICES.filter((v) => v !== last && busyUntil[v] <= now);
  if (free.length === 0) return null;
  const who = free[Math.floor(rand() * free.length) % free.length];
  const clips = IDLE_CLIPS[who];
  return { who, clip: clips[Math.floor(rand() * clips.length) % clips.length] };
}

/** Wait before the next idle beat: 1.8 to 4.2 s, so the stage stays alive and the three never move in step. */
export const idleDelay = (rand: Rand): number => 1800 + Math.round(rand() * 2400);

/**
 * A step of the time bar where nobody's part changed still gets an answer: one character, turn
 * about by step, points at the field and looks at it, so every month visibly moves the stage.
 */
export function stepBeat(reactions: Reaction[], step: number): Reaction[] {
  if (reactions.length) return reactions;
  const who = VOICES[((step % VOICES.length) + VOICES.length) % VOICES.length];
  return [{ who, clip: POINT_TO_FIELD[who], toField: true }];
}
