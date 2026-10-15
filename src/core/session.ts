import type { Game } from './game.ts';

/** A move the player makes on the board. */
export type Move = 'left' | 'right' | 'rotate' | 'softDrop' | 'hardDrop';

/** running: gravity and moves. paused: nothing. countdown: resuming, nothing until it ends. */
export type Phase = 'running' | 'paused' | 'countdown';

export const COUNTDOWN_MS = 3000;
/** How long a piece rests on the stack before it locks. */
export const LOCK_DELAY_MS = 500;
/** Moves and rotates that may restart the lock timer, per piece. */
export const MAX_LOCK_RESETS = 15;

/**
 * One game in play: gravity, lock delay, pause and the resume countdown. Pure: the
 * caller passes the time (ms, any monotonic clock) into every call that needs it.
 */
export class Session {
  private phaseNow: Phase = 'running';
  readonly game: Game;
  private lastDrop: number;
  private countdownEnd = 0;
  /** When the resting piece locks, or null while it is in the air. */
  private lockAt: number | null = null;
  /** Lock time left when paused with the piece resting; restored on resume. */
  private lockLeft: number | null = null;
  /** Lock timer restarts used by the current piece. */
  private resets = 0;
  /** `game.locks` when the current piece spawned, to tell a new piece from the old. */
  private pieceNo: number;
  /** The latest time seen, so pause can keep what is left of the lock timer. */
  private lastNow: number;

  constructor(game: Game, now: number) {
    this.game = game;
    this.lastDrop = now;
    this.lastNow = now;
    this.pieceNo = game.locks;
  }

  get phase(): Phase {
    return this.phaseNow;
  }

  /** Stop gravity and moves. Also cuts a countdown short. No-op once the game is over. */
  pause(): void {
    if (this.game.state.over || this.phaseNow === 'paused') return;
    if (this.lockAt !== null) this.lockLeft = Math.max(0, this.lockAt - this.lastNow);
    this.lockAt = null;
    this.phaseNow = 'paused';
  }

  /** Start the countdown; gravity resumes when it ends. */
  resume(now: number): void {
    if (this.phaseNow !== 'paused') return;
    this.phaseNow = 'countdown';
    this.countdownEnd = now + COUNTDOWN_MS;
  }

  /** The pause control: pause while running or counting down, resume while paused. */
  toggle(now: number): void {
    if (this.phaseNow === 'paused') this.resume(now);
    else this.pause();
  }

  /** Whole seconds left in the countdown (3, 2, 1), or 0 when not counting down. */
  countdown(now: number): number {
    if (this.phaseNow !== 'countdown') return 0;
    return Math.max(1, Math.ceil((this.countdownEnd - now) / 1000));
  }

  /**
   * Advance time: end the countdown when due, apply at most one gravity step, then
   * lock a resting piece whose delay has run out.
   */
  tick(now: number): void {
    this.lastNow = now;
    if (this.phaseNow === 'countdown' && now >= this.countdownEnd) {
      this.phaseNow = 'running';
      // The drop timer starts from zero: no time passes while paused.
      this.lastDrop = now;
      // The lock timer carries on from where the pause stopped it.
      if (this.lockLeft !== null) this.lockAt = now + this.lockLeft;
      this.lockLeft = null;
    }
    const s = this.game.state;
    if (this.phaseNow !== 'running' || s.over) return;
    if (now - this.lastDrop >= s.mode.gravityMs(s.level)) {
      this.game.step();
      this.lastDrop = now;
    }
    this.updateLock(now);
  }

  /** Apply a move. Ignored unless running. Returns whether it was applied. */
  act(move: Move, now: number): boolean {
    if (this.phaseNow !== 'running' || this.game.state.over) return false;
    this.lastNow = now;
    let shifted = false;
    switch (move) {
      case 'left':
        shifted = this.game.move(-1);
        break;
      case 'right':
        shifted = this.game.move(1);
        break;
      case 'rotate':
        shifted = this.game.rotate();
        break;
      case 'softDrop':
        // Never locks: a resting piece just stays put until its delay runs out.
        if (this.game.step()) this.game.state.score += 1;
        this.lastDrop = now;
        break;
      case 'hardDrop':
        this.game.hardDrop();
        break;
    }
    // A move or rotate while the lock timer runs buys a fresh delay, up to the cap.
    if (shifted && this.lockAt !== null && this.resets < MAX_LOCK_RESETS) {
      this.resets++;
      this.lockAt = now + LOCK_DELAY_MS;
    }
    this.updateLock(now);
    return true;
  }

  /**
   * Keep the lock timer in step with the piece: start it on touchdown, stop it when the
   * piece lifts off, lock when it runs out. With its resets used up, a piece locks the
   * moment it touches down.
   */
  private updateLock(now: number): void {
    if (this.game.locks !== this.pieceNo) {
      this.pieceNo = this.game.locks;
      this.resets = 0;
      this.lockAt = null;
      // Each new piece gets a full gravity interval, however the last one locked.
      this.lastDrop = now;
    }
    if (this.game.state.over || !this.game.grounded()) {
      this.lockAt = null;
      return;
    }
    if (this.lockAt === null) {
      this.lockAt = this.resets < MAX_LOCK_RESETS ? now + LOCK_DELAY_MS : now;
    }
    if (now >= this.lockAt) {
      this.game.lock();
      this.updateLock(now);
    }
  }
}
