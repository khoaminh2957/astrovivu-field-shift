/**
 * Keeps the three characters alive between presses (docs/FARM.md §4): a wave as they come on,
 * a small clip now and then from one of them at a time, a reaction when the step shown changes
 * their part of the story, the speaker talking and the others turning to it while a note is open.
 * Nothing runs under `prefers-reduced-motion`.
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { FarmVoice } from '@/core/farm';
import type { MascotClip } from '@/ui/mascot';
import { type StoryFrame, VOICES, idleDelay, nextIdle, storyReactions } from './direct';

export type Aim = { x: number; y: number } | null;
type Beats = Record<FarmVoice, { clip?: MascotClip; n: number }>;
type Looks = Record<FarmVoice, Aim>;

/** About how long a one-shot clip of the kit lasts, with a little air after it. */
const CLIP_MS = 2600;
const STAGGER_MS = 420;
const GLANCE_MS = 1900;
/** No idle clip this soon after any other clip: two characters never start together. */
const QUIET_MS = 2200;
const NO_LOOKS: Looks = { space: null, soil: null, rice: null };

interface Options {
  root: RefObject<HTMLElement | null>;
  open: FarmVoice | null;
  frame: StoryFrame | null;
  reduced: boolean;
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));

export function useStageDirector({ root, open, frame, reduced }: Options) {
  const [beats, setBeats] = useState<Beats>({ space: { n: 0 }, soil: { n: 0 }, rice: { n: 0 } });
  const [looks, setLooks] = useState<Looks>(NO_LOOKS);
  const busy = useRef<Record<FarmVoice, number>>({ space: 0, soil: 0, rice: 0 });
  const lastAct = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
    return id;
  }, []);
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const id of all) clearTimeout(id);
      all.clear();
    };
  }, []);

  const act = useCallback((who: FarmVoice, clip: MascotClip) => {
    lastAct.current = performance.now();
    busy.current[who] = lastAct.current + CLIP_MS;
    setBeats((b) => ({ ...b, [who]: { clip, n: b[who].n + 1 } }));
  }, []);

  /** Where `to` is (another character, or the middle of the field) seen from `from`, -1..1. */
  const aimFrom = useCallback(
    (from: FarmVoice, to: FarmVoice | 'field'): Aim => {
      const box = root.current;
      const me = box?.querySelector(`[data-farm-mascot='${from}']`)?.getBoundingClientRect();
      if (!box || !me) return null;
      const r = box.getBoundingClientRect();
      const there = to === 'field' ? { x: r.left + r.width / 2, y: r.top + r.height * 0.62 } : centre(box.querySelector(`[data-farm-mascot='${to}']`)?.getBoundingClientRect());
      if (!there) return null;
      const here = centre(me)!;
      return { x: clamp(((there.x - here.x) / (r.width / 2)) * 1.6), y: clamp(((there.y - here.y) / (r.height / 2)) * 1.6) };
    },
    [root],
  );

  const setLook = useCallback((who: FarmVoice, aim: Aim) => setLooks((l) => (l[who] === aim ? l : { ...l, [who]: aim })), []);

  // Coming on: each waves in turn, after its hop-in.
  useEffect(() => {
    if (reduced) return;
    VOICES.forEach((who, k) => later(() => act(who, who === 'space' ? 'Scan' : 'Wave'), 700 + k * 520));
  }, [reduced, act, later]);

  // A step of the story: the characters whose part changed answer it, one after the other.
  const prevFrame = useRef<StoryFrame | null>(null);
  const frameKey = frame ? JSON.stringify(frame) : '';
  useEffect(() => {
    if (!frame) return;
    const prev = prevFrame.current;
    prevFrame.current = frame;
    if (reduced) return;
    storyReactions(prev, frame).forEach((r, k) => {
      later(() => {
        act(r.who, r.clip);
        if (r.toField && open == null) {
          setLook(r.who, aimFrom(r.who, 'field'));
          later(() => setLook(r.who, null), CLIP_MS);
        }
      }, 150 + k * STAGGER_MS);
    });
    // `frame` is read through its key: a new object with the same content is not a new step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, reduced]);

  // A note opens: its speaker talks and the other two turn to it. It closes: everyone faces front.
  useEffect(() => {
    if (open == null) {
      setLooks(NO_LOOKS);
      return;
    }
    if (!reduced) act(open, 'Talk');
    setLooks({ space: null, soil: null, rice: null, ...Object.fromEntries(VOICES.filter((v) => v !== open).map((v) => [v, aimFrom(v, open)])) });
  }, [open, reduced, act, aimFrom]);

  // Between notes: one character at a time does something small; sometimes another glances at it.
  useEffect(() => {
    if (reduced || open != null) return;
    let last: FarmVoice | null = null;
    let id: ReturnType<typeof setTimeout>;
    const beat = () => {
      id = later(() => {
        const quiet = performance.now() - lastAct.current >= QUIET_MS;
        if (quiet && (typeof document === 'undefined' || !document.hidden)) {
          const next = nextIdle(Math.random, busy.current, last, performance.now());
          if (next) {
            last = next.who;
            act(next.who, next.clip);
            if (Math.random() < 0.4) {
              const others = VOICES.filter((v) => v !== next.who);
              const watcher = others[Math.floor(Math.random() * others.length)];
              setLook(watcher, aimFrom(watcher, next.who));
              later(() => setLook(watcher, null), GLANCE_MS);
            }
          }
        }
        beat();
      }, idleDelay(Math.random));
    };
    // The first idle beat waits for the entrance to finish.
    id = later(beat, 2200);
    return () => clearTimeout(id);
  }, [reduced, open, act, later, aimFrom, setLook]);

  return { beats, looks, act };
}

function centre(r: DOMRect | undefined): { x: number; y: number } | null {
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}
