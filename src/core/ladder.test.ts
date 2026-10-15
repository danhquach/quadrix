import { describe, expect, it } from 'vitest';
import { COLS, ROWS } from './game.ts';
import { MAX_GARBAGE_ROWS, rung, rungOutcome, rungStars, startRung } from './ladder.ts';
import { PieceBag, cellsOf } from './pieces.ts';

const SAMPLES = [1, 10, 100, 1_000, 100_000];

describe('pieces PRNG', () => {
  it('deals the same sequence as before the shared mulberry32', () => {
    const bag = new PieceBag(1);
    expect(Array.from({ length: 21 }, () => bag.next()).join('')).toBe('ZITSLJOZLTSOIJITOLZSJ');
    expect(bag.save()).toEqual({ rng: 2903413563, bag: [] });
  });
});

describe('ladder rungs', () => {
  it('the same number gives an identical rung every time', () => {
    for (const n of [...SAMPLES, Number.MAX_SAFE_INTEGER]) expect(rung(n)).toEqual(rung(n));
  });

  it('is pinned so every device gets the same rung', () => {
    expect(rung(1).pieceSeed).toBe(PIN_1);
    expect(rung(1_000).pieceSeed).toBe(PIN_1000);
    expect(
      rung(1_000)
        .board.slice(ROWS - 4)
        .map((r) => r.indexOf(0)),
    ).toEqual(PIN_1000_HOLES);
  });

  it('different numbers give different rungs', () => {
    const seeds = new Set(Array.from({ length: 1_000 }, (_, i) => rung(i + 1).pieceSeed));
    expect(seeds.size).toBe(1_000);
    expect(rung(2 ** 32 + 1).pieceSeed).not.toBe(rung(1).pieceSeed);
  });

  it.each(SAMPLES)('rung %i starts valid: no full rows, spawn area clear', (n) => {
    const r = rung(n);
    expect(r.board).toHaveLength(ROWS);
    const garbage = r.board.filter((row) => row.some((c) => c !== 0)).length;
    expect(garbage).toBeLessThanOrEqual(MAX_GARBAGE_ROWS);
    r.board.forEach((row, y) => {
      expect(row).toHaveLength(COLS);
      for (const c of row) expect(Number.isInteger(c) && c >= 0 && c <= 7).toBe(true);
      if (y < ROWS - garbage) expect(row.every((c) => c === 0)).toBe(true);
      else expect(row.filter((c) => c === 0)).toHaveLength(1);
    });
    const g = startRung(r);
    expect(g.state.over).toBe(false);
    expect(g.fits(g.state.piece)).toBe(true);
    expect(g.state.level).toBe(r.startLevel);
    expect(g.state.board).toEqual(r.board);
    g.hardDrop();
    expect(g.state.over).toBe(false);
  });

  it('difficulty never decreases and keeps rising', () => {
    let prev = rung(1);
    for (let n = 2; n <= 5_000; n++) {
      const r = rung(n);
      expect(r.goalLines).toBeGreaterThanOrEqual(prev.goalLines);
      expect(r.startLevel).toBeGreaterThanOrEqual(prev.startLevel);
      expect(garbageRows(r)).toBeGreaterThanOrEqual(garbageRows(prev));
      prev = r;
    }
    const big = [1e5, 1e6, 1e9, 1e12, Number.MAX_SAFE_INTEGER].map(rung);
    for (let i = 1; i < big.length; i++) {
      expect(big[i]!.goalLines).toBeGreaterThan(big[i - 1]!.goalLines);
      expect(big[i]!.startLevel).toBeGreaterThan(big[i - 1]!.startLevel);
    }
  });

  it('rejects numbers that are not rungs', () => {
    for (const n of [0, -1, 1.5, NaN, Infinity, 2 ** 53]) expect(() => rung(n)).toThrow(RangeError);
  });
});

describe('rung play', () => {
  it.each(SAMPLES.filter((n) => garbageRows(rung(n)) > 0))(
    'rung %i garbage clears and keeps the starting level',
    (n) => {
      const r = rung(n);
      const g = startRung(r);
      const top = ROWS - garbageRows(r);
      const hole = r.board[top]!.indexOf(0);
      // Vertical I drops into the top garbage row's hole and clears it.
      g.state.piece = { kind: 'I', rot: 1, x: hole - cellsOf('I', 1)[0]![0], y: 0 };
      g.hardDrop();
      expect(g.state.lines).toBeGreaterThanOrEqual(1);
      expect(g.state.level).toBe(r.startLevel);
    },
  );

  it('passes on meeting the goal, fails on topping out first', () => {
    const r = rung(1);
    expect(rungOutcome(r, { lines: 0, over: false })).toBe('playing');
    expect(rungOutcome(r, { lines: r.goalLines - 1, over: false })).toBe('playing');
    expect(rungOutcome(r, { lines: r.goalLines - 1, over: true })).toBe('failed');
    expect(rungOutcome(r, { lines: r.goalLines, over: false })).toBe('passed');
    expect(rungOutcome(r, { lines: r.goalLines + 3, over: true })).toBe('passed');
  });

  it('awards 3, 2 or 1 stars by pieces used', () => {
    const r = rung(100);
    expect(r.stars.three).toBeLessThan(r.stars.two);
    expect(rungStars(r, 1)).toBe(3);
    expect(rungStars(r, r.stars.three)).toBe(3);
    expect(rungStars(r, r.stars.three + 1)).toBe(2);
    expect(rungStars(r, r.stars.two)).toBe(2);
    expect(rungStars(r, r.stars.two + 1)).toBe(1);
    expect(rungStars(r, 1e9)).toBe(1);
  });
});

function garbageRows(r: { board: number[][] }): number {
  return r.board.filter((row) => row.some((c) => c !== 0)).length;
}

// Golden values: changing generation changes these, and every player's ladder with them.
const PIN_1 = 2046035663;
const PIN_1000 = 530143408;
const PIN_1000_HOLES = [8, 7, 3, 3];
