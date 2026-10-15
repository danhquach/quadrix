import { ROWS } from '../core/game.ts';
import { actionForKey } from './keys.ts';

/** The moves that repeat while their key is held. */
export type RepeatMove = 'left' | 'right' | 'softDrop';

export interface RepeatTiming {
  /** From the press to the first repeat. */
  delayMs: number;
  /** Between sideways repeats; 0 is instant (straight to the wall). */
  intervalMs: number;
  /** Between soft-drop repeats. */
  softDropMs: number;
}

export const REPEAT_TIMING: RepeatTiming = { delayMs: 167, intervalMs: 33, softDropMs: 33 };

/** Most repeats of one move in a single tick: enough to cross the board either way. */
const MAX_PER_TICK = ROWS;

/** The repeating move a key (KeyboardEvent.key) holds, or null. Keys held with Ctrl, Cmd or Alt never repeat. */
export function heldMove(key: string, modified: boolean): RepeatMove | null {
  const action = actionForKey(key);
  return !modified && (action === 'left' || action === 'right' || action === 'softDrop')
    ? action
    : null;
}

/**
 * The game's own key repeat, the same on every computer: the computer's repeats are
 * ignored. A held key waits `delayMs`, then repeats every interval. Of ← and →, the last
 * one pressed wins; releasing it falls back to the other, after a fresh delay. ↓ repeats
 * alongside either. Pure: the caller passes the time and applies the moves.
 */
export class KeyRepeat {
  /** Held sideways keys, oldest first; the last one repeats. */
  private sides: ('left' | 'right')[] = [];
  private down = false;
  /** When the next repeat is due, or null to start a fresh delay on the next running tick. */
  private sideAt: number | null = null;
  private downAt: number | null = null;

  private readonly timing: RepeatTiming;

  constructor(timing: RepeatTiming = REPEAT_TIMING) {
    this.timing = timing;
  }

  /** A key went down. Returns false when it was already held (a computer repeat). */
  press(move: RepeatMove, now: number): boolean {
    if (move === 'softDrop') {
      if (this.down) return false;
      this.down = true;
      this.downAt = now + this.timing.delayMs;
      return true;
    }
    if (this.sides.includes(move)) return false;
    this.sides.push(move);
    this.sideAt = now + this.timing.delayMs;
    return true;
  }

  /** A key went up. */
  release(move: RepeatMove, now: number): void {
    if (move === 'softDrop') {
      this.down = false;
      this.downAt = null;
      return;
    }
    const wasActive = this.sides.at(-1) === move;
    this.sides = this.sides.filter((m) => m !== move);
    if (wasActive) this.sideAt = this.sides.length > 0 ? now + this.timing.delayMs : null;
  }

  /** Forget every held key: their keyups can be lost while the window is out of focus. */
  clear(): void {
    this.sides = [];
    this.down = false;
    this.sideAt = null;
    this.downAt = null;
  }

  /**
   * The repeats due by `now`, in order. While not running nothing repeats, and a key
   * still held when play starts again waits a fresh delay, so a pause never ends in a burst.
   */
  tick(now: number, running: boolean): RepeatMove[] {
    if (!running) {
      this.sideAt = null;
      this.downAt = null;
      return [];
    }
    const moves: RepeatMove[] = [];
    const side = this.sides.at(-1);
    if (side) {
      this.sideAt = this.due(
        this.sideAt ?? now + this.timing.delayMs,
        this.timing.intervalMs,
        now,
        side,
        moves,
      );
    }
    if (this.down) {
      this.downAt = this.due(
        this.downAt ?? now + this.timing.delayMs,
        this.timing.softDropMs,
        now,
        'softDrop',
        moves,
      );
    }
    return moves;
  }

  /** Push each repeat of `move` due from `at` by `now`; returns when the next is due. */
  private due(
    at: number,
    interval: number,
    now: number,
    move: RepeatMove,
    moves: RepeatMove[],
  ): number {
    let n = 0;
    while (at <= now && n < MAX_PER_TICK) {
      moves.push(move);
      at += interval;
      n++;
    }
    // A stall longer than a board's worth of moves drops the backlog instead of carrying it.
    return at <= now ? now + interval : at;
  }
}
