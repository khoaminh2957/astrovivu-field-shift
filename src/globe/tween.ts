/**
 * Frame-driven value tweens. MapLibre's own paint transitions are not used for opacity fades
 * because layers draped on 3D terrain are cached in textures that a running transition does not
 * refresh: the fade would jump. Writing the value every frame works with and without terrain.
 */
export type Easing = (t: number) => number;

export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const linear: Easing = (t) => t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface Tween {
  cancel(): void;
  /** Resolves true when the tween ran to the end, false when it was cancelled. */
  done: Promise<boolean>;
}

export function tween(durationMs: number, onFrame: (t: number) => void, easing: Easing = easeOutCubic): Tween {
  let raf = 0;
  let finish: (completed: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  if (durationMs <= 0) {
    onFrame(1);
    finish(true);
    return { cancel: () => {}, done };
  }
  let start = -1;
  const step = (now: number) => {
    if (start < 0) start = now;
    const t = Math.min(1, (now - start) / durationMs);
    onFrame(easing(t));
    if (t < 1) raf = requestAnimationFrame(step);
    else finish(true);
  };
  raf = requestAnimationFrame(step);
  return {
    cancel: () => {
      cancelAnimationFrame(raf);
      finish(false);
    },
    done,
  };
}
