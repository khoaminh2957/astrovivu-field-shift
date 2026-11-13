/**
 * Frame-time measurement for the bench. It records the interval between animation frames, which
 * is what a viewer perceives: a 60 Hz display that shows every frame gives 16.7 ms each; a frame
 * the browser could not finish in time shows up as 33 ms or more.
 */
export interface FrameStats {
  frames: number;
  seconds: number;
  fps: number;
  /** Frame intervals in milliseconds. */
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Intervals longer than one and a half 60 Hz frames: a frame was visibly dropped. */
  dropped: number;
  /** Intervals longer than 50 ms: a hitch anyone would notice. */
  hitches: number;
}

const DROP_MS = 25;
const HITCH_MS = 50;
const WINDOW = 240;

const quantile = (sorted: number[], q: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

export function summarise(intervals: number[]): FrameStats {
  const sorted = intervals.slice().sort((a, b) => a - b);
  const total = intervals.reduce((s, v) => s + v, 0);
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    frames: intervals.length,
    seconds: round(total / 1000),
    fps: total > 0 ? round((intervals.length * 1000) / total) : 0,
    p50: round(quantile(sorted, 0.5)),
    p95: round(quantile(sorted, 0.95)),
    p99: round(quantile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    dropped: intervals.filter((v) => v > DROP_MS).length,
    hitches: intervals.filter((v) => v > HITCH_MS).length,
  };
}

export class FrameMeter {
  /** Rolling window for the live readout. */
  readonly recent: number[] = [];
  private recording: number[] | null = null;
  private raf = 0;
  private last = 0;

  start(): void {
    if (this.raf) return;
    this.last = 0;
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      if (this.last) {
        const dt = now - this.last;
        this.recent.push(dt);
        if (this.recent.length > WINDOW) this.recent.shift();
        this.recording?.push(dt);
      }
      this.last = now;
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  beginRecording(): void {
    this.recording = [];
  }

  endRecording(): FrameStats {
    const data = this.recording ?? [];
    this.recording = null;
    return summarise(data);
  }

  /** Frames per second over the last second or so. */
  liveFps(): number {
    let total = 0;
    let n = 0;
    for (let i = this.recent.length - 1; i >= 0 && total < 1000; i--) {
      total += this.recent[i];
      n++;
    }
    return total > 0 ? (n * 1000) / total : 0;
  }
}
