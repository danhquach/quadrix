import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS, type SavedGame } from '../game.ts';
import { startRung, rung } from '../ladder.ts';
import { PENTOMINOES, TETROMINOES, type Kind } from '../pieces.ts';
import {
  FLOOR_GRAVITY_MS,
  FLOOR_LEVEL,
  START_GRAVITY_MS,
  classic,
  classicKinds,
} from './classic.ts';
import { override } from './override.ts';

/** The old linear curve, which Override still uses. */
const linear = (level: number) => Math.max(80, 800 - (level - 1) * 70);

describe('Classic speed', () => {
  it('starts at 800 ms and is strictly faster every level up to the floor', () => {
    expect(classic.gravityMs(1)).toBe(START_GRAVITY_MS);
    for (let level = 2; level <= FLOOR_LEVEL; level++) {
      expect(classic.gravityMs(level)).toBeLessThan(classic.gravityMs(level - 1));
    }
  });

  it('reaches the 50 ms floor at level 21, well after level 11, and stays there', () => {
    expect(FLOOR_LEVEL).toBe(21);
    expect(classic.gravityMs(FLOOR_LEVEL - 1)).toBeGreaterThan(FLOOR_GRAVITY_MS);
    for (const level of [FLOOR_LEVEL, FLOOR_LEVEL + 1, 100, 2 ** 40, Number.MAX_SAFE_INTEGER]) {
      expect(classic.gravityMs(level)).toBe(FLOOR_GRAVITY_MS);
    }
  });

  it('is faster than the old linear curve at every level from 2', () => {
    for (let level = 2; level <= 60; level++) {
      expect(classic.gravityMs(level)).toBeLessThan(linear(level));
    }
  });

  it('pins the curve', () => {
    const ms = Array.from({ length: 21 }, (_, i) => classic.gravityMs(i + 1));
    expect(ms).toEqual([
      800, 605, 461, 354, 275, 216, 173, 141, 117, 100, 87, 77, 70, 65, 61, 58, 56, 54, 53, 52, 50,
    ]);
  });
});

describe('Classic pieces', () => {
  it('deals the tetrominoes alone up to level 5', () => {
    for (let level = 1; level <= 5; level++) expect(classicKinds(level)).toEqual(TETROMINOES);
  });

  it('adds two pentominoes at levels 6, 11, 16 … 46, and nothing between or after', () => {
    for (let level = 1; level <= 60; level++) {
      const tiers = Math.min(9, Math.floor((level - 1) / 5));
      expect(classicKinds(level)).toEqual([...TETROMINOES, ...PENTOMINOES.slice(0, 2 * tiers)]);
    }
    expect(classicKinds(6).slice(7)).toEqual(['P', 'Pm']);
    expect(classicKinds(46)).toHaveLength(25);
    expect(classicKinds(Number.MAX_SAFE_INTEGER)).toHaveLength(25);
  });
});

describe('Override', () => {
  it('is unaffected: the old speed and the tetrominoes only', () => {
    for (let level = 1; level <= 60; level++) {
      expect(override.gravityMs(level)).toBe(linear(level));
      expect(override.kindsAt(level)).toEqual(TETROMINOES);
    }
  });
});

/** A free Classic game on `level` with a row one I piece short of clearing. */
function oneClearFrom(level: number, lines: number, seed = 3): Game {
  const board = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  board[ROWS - 1] = Array<number>(COLS).fill(1);
  for (let x = 0; x < 4; x++) board[ROWS - 1]![x] = 0;
  const g = new Game(classic, seed);
  const saved: SavedGame = { ...g.save(), board, level, lines };
  return new Game(classic, { ...saved, piece: { kind: 'I', rot: 0, x: 0, y: 0 } });
}

/** Kinds dealt by hard-dropping `n` pieces on an emptied board each time. */
function deal(g: Game, n: number): Kind[] {
  const seen: Kind[] = [];
  for (let i = 0; i < n; i++) {
    g.state.board = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
    g.hardDrop();
    seen.push(g.state.piece.kind);
  }
  return seen;
}

describe('Classic game: new pieces', () => {
  it('a level-up to 6 reports the new pieces, and they arrive from the next bag', () => {
    for (const seed of [1, 3, 42, 0xffffffff]) {
      const g = oneClearFrom(5, 49, seed);
      g.takeEvents();
      g.hardDrop();
      expect(g.state.level).toBe(6);
      const events = g.takeEvents().map((e) => e.type);
      expect(events.slice(events.indexOf('levelUp'))).toEqual(['levelUp', 'newPieces']);
      // At most the 6 left of the current bag before the new one; a 9-bag after that.
      const seen = deal(g, 6 + 9);
      expect(seen.some((k) => k === 'P' || k === 'Pm')).toBe(true);
      expect(seen.every((k) => classicKinds(6).includes(k))).toBe(true);
    }
  });

  it('never deals a pentomino before level 6', () => {
    for (const seed of [1, 3, 42]) {
      const g = new Game(classic, seed);
      for (const level of [1, 2, 3, 4, 5]) {
        g.state.level = level;
        expect(deal(g, 30).every((k) => (TETROMINOES as readonly Kind[]).includes(k))).toBe(true);
      }
    }
  });

  it('with a fixed seed the deal is reproducible', () => {
    const a = oneClearFrom(10, 99, 7);
    const b = oneClearFrom(10, 99, 7);
    a.hardDrop();
    b.hardDrop();
    expect(a.state.level).toBe(11);
    expect(deal(a, 40)).toEqual(deal(b, 40));
  });

  it('a level-up within a tier reports no new pieces', () => {
    const g = oneClearFrom(6, 59);
    g.takeEvents();
    g.hardDrop();
    expect(g.state.level).toBe(7);
    expect(g.takeEvents().some((e) => e.type === 'newPieces')).toBe(false);
  });

  it('pentominoes move, rotate, show a ghost and lock in their own colour', () => {
    for (const kind of PENTOMINOES) {
      const g = new Game(classic, 1);
      g.state.level = 46;
      g.state.piece = { kind, rot: 0, x: 3, y: 0 };
      expect(g.move(-1)).toBe(true);
      expect(g.rotate()).toBe(true);
      const ghost = g.ghost();
      expect(ghost.y).toBeGreaterThan(g.state.piece.y);
      g.hardDrop();
      const color = 1 + 7 + PENTOMINOES.indexOf(kind);
      expect(g.state.board.flat().filter((c) => c === color)).toHaveLength(5);
    }
  });
});

describe('ladder rungs', () => {
  it('deal the tetrominoes only, even from level 6 up', () => {
    const r = rung(64);
    expect(r.startLevel).toBeGreaterThanOrEqual(6);
    const g = startRung(r);
    expect(g.kinds).toEqual(TETROMINOES);
    const seen = deal(g, 40);
    expect(seen.every((k) => (TETROMINOES as readonly Kind[]).includes(k))).toBe(true);
  });

  it('use the new speed', () => {
    const r = rung(64);
    expect(startRung(r).state.mode.gravityMs(r.startLevel)).toBe(classic.gravityMs(r.startLevel));
    expect(classic.gravityMs(r.startLevel)).toBeLessThan(linear(r.startLevel));
  });
});
