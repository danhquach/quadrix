import type { Move } from '../core/session.ts';

/** A player action, from a gesture, an on-screen button or a key. */
export type Action = Move | 'pause';

export const ACTIONS: readonly Action[] = [
  'left',
  'right',
  'rotate',
  'softDrop',
  'hardDrop',
  'pause',
];

export function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/** Movement (CSS px) under which a touch is still a tap. Below any cell size, so a tap never moves. */
export const TAP_SLOP_PX = 10;
/** A press held longer than this is not a tap. */
export const TAP_MAX_MS = 300;
/** Downward speed (CSS px per ms) over the last FLICK_WINDOW_MS that makes a flick. */
export const FLICK_PX_PER_MS = 1;
export const FLICK_WINDOW_MS = 80;
/** A flick must also travel this far down from where the touch began. */
export const FLICK_MIN_PX = 24;
/** Past the slop, one axis must beat the other by this factor before the touch locks to it. */
export const AXIS_RATIO = 1.5;
/** Cap on moves from one pointer event, so a wild jump can't loop for long. */
const MAX_STEPS = 20;

/** Real pointer events are finite and on-screen; anything else is ignored. */
const MAX_COORD = 1e6;
function isSane(x: number, y: number, t: number): boolean {
  return Math.abs(x) <= MAX_COORD && Math.abs(y) <= MAX_COORD && Number.isFinite(t);
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

/**
 * Turns one pointer's down / move / up into actions. Pure: no DOM, no timers.
 * Coordinates are CSS pixels, times milliseconds.
 *
 * - Tap (moved less than TAP_SLOP_PX, released within TAP_MAX_MS) = rotate.
 * - Past the slop the touch is never a tap. Once one axis clearly leads (by
 *   AXIS_RATIO) the touch locks to it, so a sideways drag never soft-drops and a
 *   drag down never moves; a diagonal start waits until the drag picks a side.
 * - Horizontal: one move per cell width dragged.
 * - Down: one soft drop per cell height dragged; a fast flick is one hard drop,
 *   after which the touch does nothing more.
 */
export class GestureTracker {
  private origin: Sample | null = null;
  private cell = 1;
  private anchorX = 0;
  private anchorY = 0;
  private axis: 'x' | 'y' | null = null;
  private pastSlop = false;
  private flicked = false;
  private recent: Sample[] = [];

  /** Start a touch. `cellPx` is the board's cell edge in CSS pixels. */
  down(x: number, y: number, t: number, cellPx: number): void {
    if (!isSane(x, y, t)) {
      this.origin = null;
      return;
    }
    this.origin = { x, y, t };
    this.cell = Number.isFinite(cellPx) && cellPx > TAP_SLOP_PX ? cellPx : TAP_SLOP_PX + 1;
    this.anchorX = x;
    this.anchorY = y;
    this.axis = null;
    this.pastSlop = false;
    this.flicked = false;
    this.recent = [{ x, y, t }];
  }

  move(x: number, y: number, t: number): Action[] {
    const o = this.origin;
    if (!o || this.flicked || !isSane(x, y, t)) return [];
    this.recent.push({ x, y, t });
    // Keep one sample at or before the window's start as the speed baseline.
    while (this.recent.length > 1 && this.recent[1]!.t <= t - FLICK_WINDOW_MS) this.recent.shift();
    if (!this.axis) {
      const dx = x - o.x;
      const dy = y - o.y;
      if (Math.hypot(dx, dy) <= TAP_SLOP_PX && !this.pastSlop) return [];
      this.pastSlop = true;
      if (Math.abs(dx) > AXIS_RATIO * Math.abs(dy)) this.axis = 'x';
      else if (Math.abs(dy) > AXIS_RATIO * Math.abs(dx)) this.axis = 'y';
      else return [];
    }
    if (this.axis === 'x') {
      const steps = Math.trunc((x - this.anchorX) / this.cell);
      this.anchorX += steps * this.cell;
      const n = Math.min(Math.abs(steps), MAX_STEPS);
      return Array<Action>(n).fill(steps < 0 ? 'left' : 'right');
    }
    if (this.isFlick(y, t)) {
      this.flicked = true;
      return ['hardDrop'];
    }
    const steps = Math.trunc((y - this.anchorY) / this.cell);
    if (steps <= 0) return [];
    this.anchorY += steps * this.cell;
    return Array<Action>(Math.min(steps, MAX_STEPS)).fill('softDrop');
  }

  /** End the touch; returns its final actions. */
  up(x: number, y: number, t: number): Action[] {
    const o = this.origin;
    if (!o) return [];
    const actions = this.move(x, y, t);
    const tap = !this.pastSlop && t - o.t <= TAP_MAX_MS;
    this.origin = null;
    return tap ? ['rotate'] : actions;
  }

  /** Drop the touch without acting (pointercancel, pause). */
  cancel(): void {
    this.origin = null;
  }

  private isFlick(y: number, t: number): boolean {
    const o = this.origin!;
    const first = this.recent[0]!;
    const dt = t - first.t;
    return y - o.y >= FLICK_MIN_PX && dt > 0 && (y - first.y) / dt >= FLICK_PX_PER_MS;
  }
}
