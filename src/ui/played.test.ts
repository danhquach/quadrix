import { describe, expect, it } from 'vitest';
import { PlayedGame } from './played.ts';

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
