import type { GameState } from '../core/game.ts';

/**
 * Whether a piece has locked in a game, read from its state: a lock fills a cell, or
 * clears lines. For a game from a save, whose lock count starts again at 0. Assumes the
 * game started on an empty board: a ladder rung's garbage rows (#8) need a saved lock count.
 */
export function hasLocked(s: Pick<GameState, 'board' | 'lines'>): boolean {
  return s.lines > 0 || s.board.some((row) => row.some((c) => c !== 0));
}

/**
 * Decides when a game counts toward the profile: once a piece has locked in it, and
 * only once, at its first end (game over, Quit, Restart, a new Start).
 */
export class PlayedGame {
  private pending = false;

  /** A piece locked (or the game resumed from a save had locked one). */
  played(): void {
    this.pending = true;
  }

  /** The game ended: true if it should be recorded now. Later ends return false. */
  end(): boolean {
    const record = this.pending;
    this.pending = false;
    return record;
  }
}
