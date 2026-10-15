import { describe, expect, it } from 'vitest';
import { Game } from '../core/game.ts';
import { MODES } from '../core/modes/index.ts';
import { PlayedGame, hasLocked } from './played.ts';

describe('PlayedGame', () => {
  it('records a game once a piece locked, at its first end only', () => {
    const g = new PlayedGame();
    g.played();
    g.played();
    expect(g.end()).toBe(true);
    // Game over then Quit: the second end records nothing.
    expect(g.end()).toBe(false);
  });

  it('does not record a game ended before any piece locked', () => {
    expect(new PlayedGame().end()).toBe(false);
  });

  it('records each game in turn: Restart ends one game and starts the next', () => {
    const g = new PlayedGame();
    g.played();
    expect(g.end()).toBe(true);
    expect(g.end()).toBe(false);
    g.played();
    expect(g.end()).toBe(true);
  });
});

describe('hasLocked', () => {
  it('is false for a game saved at its start, before any piece locked', () => {
    expect(hasLocked(new Game(MODES.classic!, 3).state)).toBe(false);
  });

  it('is true once a piece has locked, even if a line clear emptied the board', () => {
    const g = new Game(MODES.classic!, 3);
    g.hardDrop();
    expect(hasLocked(g.state)).toBe(true);
    const cleared = { board: g.state.board.map((row) => row.map(() => 0)), lines: 4 };
    expect(hasLocked(cleared)).toBe(true);
  });
});
