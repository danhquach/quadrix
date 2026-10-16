/** Maps progress 0–1 to eased progress; 0 gives 0 and 1 gives 1. */
export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;
export const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
export const easeIn: Ease = (t) => t ** 3;
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A value moving from `from` to `to` over `durationMs` with easing: a fade, a scale or a
 * move. It runs on the time it is given, so a paused caller simply stops advancing it.
 */
export class Tween {
  readonly from: number;
  readonly to: number;
  readonly durationMs: number;
  readonly ease: Ease;
  private elapsed = 0;

  constructor(from: number, to: number, durationMs: number, ease: Ease = easeOut) {
    this.from = from;
    this.to = to;
    this.durationMs = durationMs;
    this.ease = ease;
  }

  /** Advance by `dt` ms. Returns whether it is still running. */
  update(dt: number): boolean {
    this.elapsed = Math.min(this.durationMs, this.elapsed + Math.max(0, dt));
    return !this.done;
  }

  get done(): boolean {
    return this.elapsed >= this.durationMs;
  }

  /** Progress 0–1, before easing. */
  get progress(): number {
    return this.durationMs > 0 ? this.elapsed / this.durationMs : 1;
  }

  get value(): number {
    if (this.done) return this.to;
    return this.from + (this.to - this.from) * this.ease(this.progress);
  }
}
