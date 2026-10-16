import type { Cell, GameEvent } from '../core/events.ts';
import { ROWS, type Game } from '../core/game.ts';
import type { Kind } from '../core/pieces.ts';
import { MAX_FRAME_MS, type EffectsLevel } from './effects.ts';
import { Tween, easeOut, linear } from './tween.ts';

/** A new piece fades (and, on Full, scales) in. */
export const SPAWN_MS = 80;
export const SPAWN_SCALE = 0.6;
/** A move, rotate kick or gravity step slides the drawn piece into its new cell. */
export const SLIDE_MS = 50;
/** The drawn piece trails the real one by at most this many cells. */
export const MAX_TRAIL = 1;
/** Cleared rows hold, then the stack above drops into their place. */
export const HOLD_MS = 150;
export const DROP_MS = 120;
/** A hard-dropped piece stretches along the drop, then squashes on impact. */
export const SQUASH_MS = 60;
export const STRETCH = 1.2;
export const SQUASH = 0.8;
/** On game over the stack greys row by row from the bottom up. */
export const GREY_ROW_MS = 30;

/** How to draw the falling piece (and, for `dx` and `alpha`, its ghost). */
export interface PieceLook {
  /** Offset from its real cell, in cells. */
  readonly dx: number;
  readonly dy: number;
  readonly scale: number;
  readonly alpha: number;
}

/** A hard-dropped piece being squashed: draw `cells` scaled about their bottom centre. */
export interface SquashLook {
  readonly kind: Kind;
  readonly cells: readonly Cell[];
  readonly sx: number;
  readonly sy: number;
}

const STILL: PieceLook = { dx: 0, dy: 0, scale: 1, alpha: 1 };
const CLEAR_MS = HOLD_MS + DROP_MS;

/**
 * How the board is drawn between game states: the falling piece slides, cleared rows
 * hold and the stack drops, a hard drop squashes, game over greys the stack. Presentation
 * only: the game has already moved on, so input never waits on any of it. Full plays it
 * all; Reduced keeps the spawn fade and shows the rest at its end state; Off shows every
 * end state at once.
 */
export class Motion {
  private levelNow: EffectsLevel;
  private game: Game | null = null;
  private locks = 0;
  private x = 0;
  private y = 0;
  private slideX: Tween | null = null;
  private slideY: Tween | null = null;
  private spawn: Tween | null = null;
  /** Time into the line-clear hold and drop, or null when none runs. */
  private clearMs: number | null = null;
  private heldRows: { y: number; colors: readonly number[] }[] = [];
  /** Rows each board row dropped in the last clear. */
  private shift: number[] = [];
  private squash: { kind: Kind; cells: readonly Cell[]; t: Tween } | null = null;
  /** Time since game over, or null while the game is on. */
  private overMs: number | null = null;

  constructor(level: EffectsLevel = 'full') {
    this.levelNow = level;
  }

  get level(): EffectsLevel {
    return this.levelNow;
  }

  /** Change the level; whatever the new level doesn't allow jumps to its end now. */
  set level(level: EffectsLevel) {
    this.levelNow = level;
    if (level === 'full') return;
    this.slideX = this.slideY = this.squash = null;
    this.clearMs = null;
    if (level === 'off') this.spawn = null;
  }

  /**
   * Catch up with `game` after it acted: `events` are the ones it just reported. Call
   * after every action and every frame, so each move is seen on its own.
   */
  observe(game: Game, events: readonly GameEvent[]): void {
    if (game !== this.game) {
      this.clear();
      this.game = game;
      this.track(game);
    }
    const full = this.levelNow === 'full';
    const cleared = events.some((e) => e.type === 'clear');
    for (const e of events) {
      if (e.type === 'clear') {
        this.squash = null;
        if (full) this.startClear(e.rows, e.colors);
      } else if (e.type === 'hardDrop') {
        const over = events.some((o) => o.type === 'over');
        if (full && e.distance > 0 && !cleared && !over) {
          this.squash = { kind: e.kind, cells: e.cells, t: new Tween(0, 1, SQUASH_MS, linear) };
        }
      } else if (e.type === 'over') {
        this.overMs = 0;
      }
    }
    const p = game.state.piece;
    if (game.locks !== this.locks) {
      this.slideX = this.slideY = null;
      this.spawn =
        this.levelNow === 'off' || game.state.over ? null : new Tween(0, 1, SPAWN_MS, easeOut);
    } else if (full) {
      if (p.x !== this.x) this.slideX = slide((this.slideX?.value ?? 0) + this.x - p.x);
      if (p.y !== this.y) this.slideY = slide((this.slideY?.value ?? 0) + this.y - p.y);
    }
    this.track(game);
  }

  /** Advance by `dt` ms, unless paused: then nothing moves. */
  frame(dt: number, paused: boolean): void {
    if (paused) return;
    const step = Math.min(MAX_FRAME_MS, Math.max(0, dt));
    if (this.slideX && !this.slideX.update(step)) this.slideX = null;
    if (this.slideY && !this.slideY.update(step)) this.slideY = null;
    if (this.spawn && !this.spawn.update(step)) this.spawn = null;
    if (this.squash && !this.squash.t.update(step)) this.squash = null;
    if (this.clearMs !== null) {
      this.clearMs += step;
      if (this.clearMs >= CLEAR_MS) this.clearMs = null;
    }
    if (this.overMs !== null) this.overMs += step;
  }

  /** Forget everything: a new game starts still. */
  clear(): void {
    this.game = null;
    this.slideX = this.slideY = this.spawn = this.squash = null;
    this.clearMs = this.overMs = null;
  }

  /** How to draw the falling piece now. */
  piece(): PieceLook {
    if (!this.slideX && !this.slideY && !this.spawn) return STILL;
    const alpha = this.spawn?.value ?? 1;
    return {
      dx: this.slideX?.value ?? 0,
      dy: this.slideY?.value ?? 0,
      scale: this.levelNow === 'full' ? SPAWN_SCALE + (1 - SPAWN_SCALE) * alpha : 1,
      alpha,
    };
  }

  /** How to draw the ghost: it slides sideways and fades in with the piece, never apart. */
  ghost(alpha: number): { dx: number; alpha: number } {
    const look = this.piece();
    return { dx: look.dx, alpha: alpha * look.alpha };
  }

  /** Where board row `y` draws, in cells from its real place (0, or negative while dropping). */
  rowShift(y: number): number {
    if (this.clearMs === null) return 0;
    const k = this.shift[y] ?? 0;
    if (k === 0) return 0;
    if (this.clearMs < HOLD_MS) return -k;
    return -k * (1 - easeOut((this.clearMs - HOLD_MS) / DROP_MS));
  }

  /** Cleared rows still on show, where they stood before clearing, with their colours. */
  held(): readonly { y: number; colors: readonly number[] }[] {
    return this.clearMs !== null && this.clearMs < HOLD_MS ? this.heldRows : [];
  }

  /** The hard-dropped piece being squashed, or null. Its board cells are left to it. */
  squashed(): SquashLook | null {
    if (!this.squash) return null;
    const t = this.squash.t.progress;
    // A third of the time going from stretched to squashed, the rest easing back.
    const sy =
      t < 1 / 3
        ? STRETCH + (SQUASH - STRETCH) * 3 * t
        : SQUASH + (1 - SQUASH) * easeOut((t - 1 / 3) * 1.5);
    return { kind: this.squash.kind, cells: this.squash.cells, sx: 2 - sy, sy };
  }

  /** Whether board cell (x, y) is drawn by the squash instead of the board. */
  hides(x: number, y: number): boolean {
    return this.squash?.cells.some(([cx, cy]) => cx === x && cy === y) ?? false;
  }

  /** Whether board row `y` shows greyed: game over, and the sweep has reached it. */
  greyed(y: number): boolean {
    if (this.overMs === null) return false;
    if (this.levelNow !== 'full') return true;
    return ROWS - 1 - y < Math.floor(this.overMs / GREY_ROW_MS) + 1;
  }

  private track(game: Game): void {
    this.locks = game.locks;
    this.x = game.state.piece.x;
    this.y = game.state.piece.y;
  }

  /**
   * Hold `rows` (indices before clearing) and drop each row above by the rows cleared
   * below it. A clear still running ends where it is: the new one starts from the board
   * as it now stands.
   */
  private startClear(rows: readonly number[], colors: readonly (readonly number[])[]): void {
    this.heldRows = rows.map((y, i) => ({ y, colors: colors[i] ?? [] }));
    this.shift = Array<number>(ROWS).fill(0);
    for (let old = 0; old < ROWS; old++) {
      if (rows.includes(old)) continue;
      const below = rows.filter((r) => r > old).length;
      if (old + below < ROWS) this.shift[old + below] = below;
    }
    this.clearMs = 0;
  }
}

/** A slide from `offset` cells (kept within MAX_TRAIL) back to 0. */
function slide(offset: number): Tween | null {
  const o = Math.max(-MAX_TRAIL, Math.min(MAX_TRAIL, offset));
  return o === 0 ? null : new Tween(o, 0, SLIDE_MS, easeOut);
}
