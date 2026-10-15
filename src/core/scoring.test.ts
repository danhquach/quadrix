import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS, tSpin, type Piece } from './game.ts';
import { MODES } from './modes/index.ts';
import { scoreLock } from './scoring.ts';

const classic = MODES.classic!;

/** An empty board with `rows` (bottom-up) filled except the listed columns. */
function board(rows: (number[] | null)[]): number[][] {
  const b = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  rows.forEach((holes, i) => {
    if (holes)
      b[ROWS - 1 - i] = Array.from({ length: COLS }, (_, x) => (holes.includes(x) ? 0 : 1));
  });
  return b;
}

/** Lock a vertical I in column 0 on the floor of a fresh board that clears `n` lines. */
function clear(g: Game, n: number, rest: (number[] | null)[] = []): number {
  const before = g.state.score;
  g.state.board = board([...Array<number[]>(n).fill([0]), ...rest]);
  g.state.piece = { kind: 'I', rot: 1, x: -2, y: ROWS - 4 };
  g.lock();
  return g.state.score - before;
}

/** Lock a vertical I in column 0 on an empty board: a drop that clears nothing. */
function miss(g: Game): number {
  const before = g.state.score;
  g.state.board = board([]);
  g.state.piece = { kind: 'I', rot: 1, x: -2, y: ROWS - 4 };
  g.lock();
  return g.state.score - before;
}

/** The slot for a spin double: T pointing down at x 3, y 17, under an overhang at (3, 17). */
function spinDoubleBoard(): number[][] {
  const b = board([[4], [3, 4, 5]]);
  b[ROWS - 3]![3] = 1;
  return b;
}

/** Twist a T from `from` into `to` with one rotate, then hard drop and lock. */
function twist(g: Game, from: Piece): number {
  const before = g.state.score;
  g.state.piece = from;
  expect(g.rotate()).toBe(true);
  g.hardDrop();
  return g.state.score - before;
}

describe('plain line clears', () => {
  it('score exactly as before: 100 / 300 / 500 / 800 times the level', () => {
    for (const [n, points] of [
      [1, 100],
      [2, 300],
      [3, 500],
      [4, 800],
    ] as const) {
      const g = new Game(classic, 1);
      // A row left behind so a 4-line clear isn't also a full clear.
      expect(clear(g, n, [[0, 1]])).toBe(points);
      expect(g.award!.labels).toEqual(n === 4 ? ['Quad'] : []);
    }
  });

  it('multiply by the level', () => {
    const g = new Game(classic, 1);
    g.state.level = 3;
    expect(clear(g, 2, [[0, 1]])).toBe(900);
  });

  it('match the mode table for every count', () => {
    for (const level of [1, 2, 7]) {
      for (const n of [0, 1, 2, 3, 4]) {
        const award = scoreLock(classic, level, n, 'none', { streak: 0, b2b: false }, false);
        expect(award.points).toBe(classic.scoreForLines(n, level));
      }
    }
  });
});

describe('combo', () => {
  it('adds 50 x combo count for each clearing drop after the first', () => {
    const g = new Game(classic, 1);
    expect(clear(g, 1, [[0, 1]])).toBe(100);
    expect(clear(g, 1, [[0, 1]])).toBe(100 + 50);
    expect(g.award!.labels).toEqual(['Combo 1']);
    expect(clear(g, 2, [[0, 1]])).toBe(300 + 100);
    expect(g.award!.labels).toEqual(['Combo 2']);
    expect(clear(g, 1, [[0, 1]])).toBe(100 + 150);
    expect(g.award!.labels).toEqual(['Combo 3']);
  });

  it('resets on a drop that clears nothing', () => {
    const g = new Game(classic, 1);
    clear(g, 1, [[0, 1]]);
    clear(g, 1, [[0, 1]]);
    expect(miss(g)).toBe(0);
    expect(g.award!.labels).toEqual([]);
    expect(clear(g, 1, [[0, 1]])).toBe(100);
    expect(clear(g, 1, [[0, 1]])).toBe(150);
  });

  it('is multiplied by the level', () => {
    const g = new Game(classic, 1);
    g.state.level = 2;
    clear(g, 1, [[0, 1]]);
    expect(clear(g, 1, [[0, 1]])).toBe(200 + 100);
  });
});

describe('back-to-back', () => {
  it('scores a quad after a quad at 1.5x', () => {
    const g = new Game(classic, 1);
    clear(g, 4, [[0, 1]]);
    miss(g);
    expect(clear(g, 4, [[0, 1]])).toBe(1200);
    expect(g.award!.labels).toEqual(['Back-to-back', 'Quad']);
  });

  it('only multiplies the clear, not the combo bonus', () => {
    const g = new Game(classic, 1);
    clear(g, 4, [[0, 1]]);
    expect(clear(g, 4, [[0, 1]])).toBe(1200 + 50);
    expect(g.award!.labels).toEqual(['Back-to-back', 'Quad', 'Combo 1']);
  });

  it('does not start on the first quad', () => {
    const g = new Game(classic, 1);
    expect(clear(g, 4, [[0, 1]])).toBe(800);
  });

  it('breaks on a plain clear between', () => {
    const g = new Game(classic, 1);
    clear(g, 4, [[0, 1]]);
    miss(g);
    clear(g, 1, [[0, 1]]);
    miss(g);
    expect(clear(g, 4, [[0, 1]])).toBe(800);
  });

  it('carries across a spin clear', () => {
    const g = new Game(classic, 1);
    clear(g, 4, [[0, 1]]);
    miss(g);
    g.state.board = spinDoubleBoard();
    expect(twist(g, { kind: 'T', rot: 1, x: 3, y: 17 })).toBe(1800);
    expect(g.award!.labels).toEqual(['Back-to-back', 'Spin double']);
  });
});

describe('spin detection', () => {
  it('finds a full spin when 3 corners and both front corners are filled', () => {
    // Pointing down into the slot: corners TL (overhang), BL and BR are filled.
    expect(tSpin(spinDoubleBoard(), { kind: 'T', rot: 2, x: 3, y: 17 })).toBe('full');
  });

  it('finds a mini spin when only one front corner is filled', () => {
    // Pointing right against the left wall: both back corners are wall, front BR filled.
    const b = board([[0]]);
    expect(tSpin(b, { kind: 'T', rot: 1, x: -1, y: 17 })).toBe('mini');
  });

  it('counts the floor as filled', () => {
    // Pointing up on the floor: BL and BR are floor, TL a block.
    const b = board([]);
    b[ROWS - 2]![0] = 1;
    expect(tSpin(b, { kind: 'T', rot: 0, x: 0, y: ROWS - 2 })).toBe('mini');
  });

  it('finds none with fewer than 3 corners filled, or for other pieces', () => {
    expect(tSpin(board([]), { kind: 'T', rot: 0, x: 3, y: 18 })).toBe('none');
    expect(tSpin(spinDoubleBoard(), { kind: 'L', rot: 2, x: 3, y: 17 })).toBe('none');
  });

  it('every rotation points at its own two front corners', () => {
    // On the floor with a block at TL: filled corners are TL, BR and BL.
    const b = board([]);
    b[ROWS - 2]![3] = 1;
    const p = (rot: number): Piece => ({ kind: 'T', rot, x: 3, y: ROWS - 2 });
    expect(tSpin(b, p(0))).toBe('mini'); // points up: TL, TR
    expect(tSpin(b, p(1))).toBe('mini'); // points right: TR, BR
    expect(tSpin(b, p(2))).toBe('full'); // points down: BR, BL
    expect(tSpin(b, p(3))).toBe('full'); // points left: BL, TL
  });
});

describe('spin scoring', () => {
  it('scores a spin double for 1200 after a twist into the slot', () => {
    const g = new Game(classic, 1);
    g.state.board = spinDoubleBoard();
    expect(twist(g, { kind: 'T', rot: 1, x: 3, y: 17 })).toBe(1200);
    expect(g.state.lines).toBe(2);
    expect(g.award!.labels).toEqual(['Spin double']);
  });

  it('scores a mini spin single for 200', () => {
    const g = new Game(classic, 1);
    g.state.board = board([[0]]);
    g.state.board[ROWS - 1]![1] = 1;
    // Rotating from pointing up at x 0 kicks left into the wall slot, pointing right.
    expect(twist(g, { kind: 'T', rot: 0, x: 0, y: 17 })).toBe(200);
    expect(g.award!.labels).toEqual(['Mini spin single']);
  });

  it('scores a spin with no lines, resetting the combo but keeping back-to-back', () => {
    const g = new Game(classic, 1);
    clear(g, 4, [[0, 1]]);
    const b = board([
      [4, 9],
      [3, 4, 5, 9],
    ]);
    b[ROWS - 3]![3] = 1;
    g.state.board = b;
    expect(twist(g, { kind: 'T', rot: 1, x: 3, y: 17 })).toBe(400);
    expect(g.state.lines).toBe(4);
    expect(g.award!.labels).toEqual(['Spin']);
    expect(clear(g, 4, [[0, 1]])).toBe(1200);
    expect(g.award!.labels).toEqual(['Back-to-back', 'Quad']);
  });

  it('needs the last move to be a rotation: a T set into the slot is a plain clear', () => {
    const g = new Game(classic, 1);
    g.state.board = spinDoubleBoard();
    g.state.piece = { kind: 'T', rot: 2, x: 3, y: 17 };
    g.lock();
    expect(g.state.score).toBe(300);
  });

  /** Row 19 full but column 4, blocks at (3, 17) and the floor corners: a mini spot for a
   * T pointing right at x 3, y 17, reachable straight down. */
  function dropSpot(): number[][] {
    const b = board([[4]]);
    b[ROWS - 3]![3] = 1;
    return b;
  }

  it('a rotation where the piece rests counts', () => {
    const g = new Game(classic, 1);
    g.state.board = dropSpot();
    expect(twist(g, { kind: 'T', rot: 0, x: 3, y: 17 })).toBe(200);
  });

  it('a rotation high up, then a hard drop into the same spot, does not', () => {
    const g = new Game(classic, 1);
    g.state.board = dropSpot();
    expect(twist(g, { kind: 'T', rot: 0, x: 3, y: 5 })).toBe(100 + 2 * 12);
    expect(g.award!.labels).toEqual([]);
  });

  it('a move or gravity step after the rotation clears it; a failed one does not', () => {
    const g = new Game(classic, 1);
    g.state.piece = { kind: 'T', rot: 0, x: 3, y: 5 };
    g.rotate();
    expect(g.save().spun).toBe(true);
    g.move(1);
    expect(g.save().spun).toBe(false);
    g.rotate();
    g.step();
    expect(g.save().spun).toBe(false);
    g.rotate();
    for (let i = 0; i < COLS; i++) g.move(-1);
    expect(g.save().spun).toBe(false);
    g.rotate();
    expect(g.move(-1)).toBe(false);
    expect(g.save().spun).toBe(true);
  });

  it('scores the same in Override', () => {
    const g = new Game(MODES.override!, 1);
    g.state.board = spinDoubleBoard();
    expect(twist(g, { kind: 'T', rot: 1, x: 3, y: 17 })).toBe(1200);
    clear(g, 4, [[0, 1]]);
    expect(g.award!.labels).toEqual(['Back-to-back', 'Quad', 'Combo 1']);
  });
});

describe('edge cases', () => {
  it('scores a mini spin clearing two lines as a full spin double', () => {
    const award = scoreLock(classic, 1, 2, 'mini', { streak: 0, b2b: false }, false);
    expect(award.points).toBe(1200);
    expect(award.labels).toEqual(['Spin double']);
  });

  it('a lock-out leaves no award from the lock before it', () => {
    const g = new Game(classic, 1);
    clear(g, 4, [[0, 1]]);
    expect(g.award!.labels).toEqual(['Quad']);
    g.state.piece = { kind: 'O', rot: 0, x: 3, y: -2 };
    g.lock();
    expect(g.state.over).toBe(true);
    expect(g.award).toBeNull();
  });

  it('a resumed game carries on its combo and back-to-back', () => {
    const g = new Game(classic, { ...new Game(classic, 1).save(), streak: 1, b2b: true });
    expect(clear(g, 4, [[0, 1]])).toBe(1200 + 50);
    expect(g.award!.labels).toEqual(['Back-to-back', 'Quad', 'Combo 1']);
  });
});

describe('full clear', () => {
  it('adds 2000 when a clear leaves the board empty', () => {
    const g = new Game(classic, 1);
    expect(clear(g, 4)).toBe(800 + 2000);
    expect(g.state.board.every((r) => r.every((c) => c === 0))).toBe(true);
    expect(g.award!.labels).toEqual(['Quad', 'Full clear']);
  });

  it('is multiplied by the level', () => {
    const g = new Game(classic, 1);
    g.state.level = 2;
    expect(clear(g, 4)).toBe(1600 + 4000);
  });

  it('does not count a drop that clears nothing on an empty board', () => {
    const g = new Game(classic, 1);
    miss(g);
    expect(g.award!.labels).toEqual([]);
  });
});
