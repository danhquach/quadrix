import type { Game } from './game.ts';

/** A move the player makes on the board. */
export type Move = 'left' | 'right' | 'rotate' | 'softDrop' | 'hardDrop';

/** running: gravity and moves. paused: nothing. countdown: resuming, nothing until it ends. */
export type Phase = 'running' | 'paused' | 'countdown';

export const COUNTDOWN_MS = 3000;

/**
 * One game in play: gravity, pause and the resume countdown. Pure: the caller passes
 * the time (ms, any monotonic clock) into every call that needs it.
 */
export class Session {
  private phaseNow: Phase = 'running';
  readonly game: Game;
  private lastDrop: number;
  private countdownEnd = 0;

  constructor(game: Game, now: number) {
    this.game = game;
    this.lastDrop = now;
  }

  get phase(): Phase {
    return this.phaseNow;
  }

  /** Stop gravity and moves. Also cuts a countdown short. No-op once the game is over. */
  pause(): void {
    if (!this.game.state.over) this.phaseNow = 'paused';
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

  /** Advance time: end the countdown when due, then apply at most one gravity step. */
  tick(now: number): void {
    if (this.phaseNow === 'countdown' && now >= this.countdownEnd) {
      this.phaseNow = 'running';
      // The drop timer starts from zero: no time passes while paused.
      this.lastDrop = now;
    }
    const s = this.game.state;
    if (this.phaseNow !== 'running' || s.over) return;
    if (now - this.lastDrop >= s.mode.gravityMs(s.level)) {
      this.game.step();
      this.lastDrop = now;
    }
  }

  /** Apply a move. Ignored unless running. Returns whether it was applied. */
  act(move: Move, now: number): boolean {
    if (this.phaseNow !== 'running' || this.game.state.over) return false;
    switch (move) {
      case 'left':
        this.game.move(-1);
        break;
      case 'right':
        this.game.move(1);
        break;
      case 'rotate':
        this.game.rotate();
        break;
      case 'softDrop':
        if (this.game.step()) this.game.state.score += 1;
        this.lastDrop = now;
        break;
      case 'hardDrop':
        this.game.hardDrop();
        break;
    }
    return true;
  }
}
