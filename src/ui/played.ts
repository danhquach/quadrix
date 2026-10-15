/**
 * Decides when a game counts toward the profile: once a piece has locked in it, and
 * only once, at its first end (game over, Quit, Restart, a new Start).
 */
export class PlayedGame {
  private pending = false;

  /** A piece locked (or the game resumed from a save had locked one: see Game.locks). */
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
