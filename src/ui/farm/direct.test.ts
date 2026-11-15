import { describe, expect, it } from 'vitest';
import { type StoryFrame, VOICES, idleDelay, nextIdle, stepBeat, storyReactions } from './direct';

const calm = { mood: 'calm', alert: false } as const;
const base: StoryFrame = { sky: 'clear', harvesting: false, sowing: false, soil: 'usual', notes: { space: calm, soil: calm, rice: calm } };
const withNotes = (notes: Partial<StoryFrame['notes']>): StoryFrame => ({ ...base, notes: { ...base.notes, ...notes } });

describe('storyReactions', () => {
  it('stays still on the first frame and when nothing changed', () => {
    expect(storyReactions(null, base)).toEqual([]);
    expect(storyReactions(base, { ...base })).toEqual([]);
  });

  it('has the Satellite answer the sky', () => {
    expect(storyReactions(base, { ...base, sky: 'heavy-rain' })).toEqual([{ who: 'space', clip: 'Jump', toField: false }]);
    expect(storyReactions(base, { ...base, sky: 'rain' })[0].clip).toBe('Scan');
    expect(storyReactions(base, { ...base, sky: 'hot' })[0].clip).toBe('Think');
  });

  it('has Rice celebrate the harvest and Seed think over dry ground', () => {
    expect(storyReactions(base, { ...base, harvesting: true })).toEqual([{ who: 'rice', clip: 'Celebrate', toField: false }]);
    expect(storyReactions(base, { ...base, soil: 'dry' })).toEqual([{ who: 'soil', clip: 'Think', toField: false }]);
  });

  it('points at the field on a new alert, and follows a change of mood', () => {
    expect(storyReactions(base, withNotes({ soil: { mood: 'worried', alert: true } }))).toEqual([{ who: 'soil', clip: 'Point', toField: true }]);
    expect(storyReactions(base, withNotes({ rice: { mood: 'worried', alert: false } }))).toEqual([{ who: 'rice', clip: 'Think', toField: false }]);
    expect(storyReactions(base, withNotes({ rice: { mood: 'glad', alert: false } }))).toEqual([{ who: 'rice', clip: 'Celebrate', toField: false }]);
  });

  it('gives each character one reaction at most', () => {
    const next: StoryFrame = { ...withNotes({ space: { mood: 'worried', alert: true } }), sky: 'heavy-rain', harvesting: true };
    const out = storyReactions(base, next);
    expect(out.map((r) => r.who)).toEqual(['space', 'rice']);
    expect(out[0].clip).toBe('Jump');
  });
});

describe('idle routine', () => {
  it('never picks the one who just moved, nor one still busy', () => {
    const busy = { space: 0, soil: 10_000, rice: 0 };
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const next = nextIdle(() => r, busy, 'rice', 1000);
      expect(next?.who).toBe('space');
    }
    expect(nextIdle(() => 0.5, { space: 9e9, soil: 9e9, rice: 9e9 }, null, 0)).toBeNull();
  });

  it('waits between 3.5 and 8 seconds', () => {
    expect(idleDelay(() => 0)).toBe(1800);
    expect(idleDelay(() => 1)).toBe(4200);
  });
});

describe('a step with no change of part', () => {
  it('still moves one character, turn about, pointing at the field', () => {
    const seen = [0, 1, 2, 3].map((k) => stepBeat([], k));
    for (const r of seen) expect(r).toHaveLength(1);
    expect(seen.map((r) => r[0].who)).toEqual([...VOICES, VOICES[0]]);
    expect(seen.every((r) => r[0].toField)).toBe(true);
  });
  it('leaves the story reactions alone when there are some', () => {
    const rs = [{ who: 'rice' as const, clip: 'Celebrate' as const, toField: false }];
    expect(stepBeat(rs, 5)).toBe(rs);
  });
});
