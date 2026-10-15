import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS, spawn, type Piece } from './game.ts';
import { MODES } from './modes/index.ts';
import { KINDS, PieceBag, cellsOf, colorIndex } from './pieces.ts';

describe('pieces', () => {
  it('every kind has 4 cells in every rotation', () => {
    for (const k of KINDS) for (let r = 0; r < 4; r++) expect(cellsOf(k, r)).toHaveLength(4);
  });

  it('4 rotations return to the spawn shape', () => {
    for (const k of KINDS) expect(cellsOf(k, 4)).toEqual(cellsOf(k, 0));
  });

  it('7-bag deals each kind once per 7 draws', () => {
    const bag = new PieceBag(1);
    const seen = Array.from({ length: 7 }, () => bag.next()).sort();
    expect(seen).toEqual([...KINDS].sort());
  });
});

describe('game', () => {
  it('stops at the walls', () => {
    const g = new Game(MODES.classic!, 1);
    for (let i = 0; i < COLS; i++) g.move(-1);
    expect(g.move(-1)).toBe(false);
  });

  it('hard drop locks the piece on the floor and spawns the next', () => {
    const g = new Game(MODES.classic!, 1);
    const next = g.state.next;
    g.hardDrop();
    expect(g.state.board[ROWS - 1]!.some((c) => c !== 0)).toBe(true);
    expect(g.state.piece.kind).toBe(next);
  });

  it('clears a full row and scores it by mode', () => {
    const g = new Game(MODES.classic!, 1);
    g.state.board[ROWS - 1] = Array<number>(COLS).fill(1);
    g.state.board[ROWS - 1]![0] = 0;
    // Vertical I in column 0 fills the gap.
    g.state.piece = { kind: 'I', rot: 1, x: -2, y: 0 };
    g.hardDrop();
    expect(g.state.lines).toBe(1);
    expect(g.state.board[ROWS - 1]!.filter((c) => c !== 0)).toHaveLength(1);
  });

  it('ends when a new piece cannot spawn', () => {
    const g = new Game(MODES.classic!, 1);
    for (let y = 0; y < ROWS; y++)
      g.state.board[y] = Array<number>(COLS)
        .fill(1)
        .map((c, x) => (x === 9 ? 0 : c));
    g.state.piece = { kind: 'O', rot: 0, x: 3, y: -2 };
    g.hardDrop();
    expect(g.state.over).toBe(true);
  });

  it('a gravity step never locks: a resting piece stays put until lock()', () => {
    const g = new Game(MODES.classic!, 1);
    g.state.piece = { kind: 'O', rot: 0, x: 3, y: ROWS - 2 };
    expect(g.grounded()).toBe(true);
    expect(g.step()).toBe(false);
    expect(g.locks).toBe(0);
    expect(g.state.board[ROWS - 1]!.every((c) => c === 0)).toBe(true);
    g.lock();
    expect(g.locks).toBe(1);
    expect(g.state.board[ROWS - 1]![4]).not.toBe(0);
  });

  it('grounded is false while the piece can still fall', () => {
    const g = new Game(MODES.classic!, 1);
    expect(g.grounded()).toBe(false);
    g.state.piece = g.ghost();
    expect(g.grounded()).toBe(true);
  });

  describe('ghost', () => {
    /** A bumpy stack: column heights vary so the landing row depends on x. */
    function bumpy(g: Game): void {
      const heights = [1, 4, 2, 6, 3, 0, 5, 2, 7, 1];
      heights.forEach((h, x) => {
        for (let y = ROWS - h; y < ROWS; y++) g.state.board[y]![x] = 1;
      });
    }

    it.each(Object.keys(MODES))('every hard drop lands where the ghost was (%s)', (id) => {
      const g = new Game(MODES[id]!, 7);
      bumpy(g);
      let landed = 0;
      for (let i = 0; i < 40 && !g.state.over; i++) {
        // Vary column and rotation so the drops cover the whole stack.
        for (let r = 0; r < i % 4; r++) g.rotate();
        g.move((i % 9) - 4);
        const ghost = g.ghost();
        const lines = g.state.lines;
        const board = g.state.board.map((row) => [...row]);
        g.hardDrop();
        // A line clear shifts rows; game over leaves the board as it was.
        if (g.state.over || g.state.lines !== lines) continue;
        for (const [cx, cy] of cellsOf(ghost.kind, ghost.rot)) {
          board[ghost.y + cy]![ghost.x + cx] = colorIndex(ghost.kind);
        }
        expect(g.state.board).toEqual(board);
        landed++;
      }
      expect(landed).toBeGreaterThan(5);
    });

    it('scores the hard drop by the rows between piece and ghost', () => {
      const g = new Game(MODES.classic!, 1);
      const rows = g.ghost().y - g.state.piece.y;
      g.hardDrop();
      expect(g.state.score).toBe(2 * rows);
    });

    it('follows each move, rotate and gravity step', () => {
      const g = new Game(MODES.classic!, 3);
      bumpy(g);
      const check = () => {
        const p = g.state.piece;
        const ghost = g.ghost();
        expect([ghost.kind, ghost.rot, ghost.x]).toEqual([p.kind, p.rot, p.x]);
        expect(g.fits(ghost)).toBe(true);
        expect(g.fits({ ...ghost, y: ghost.y + 1 })).toBe(false);
      };
      check();
      g.move(-1);
      check();
      g.rotate();
      check();
      g.move(2);
      check();
      g.step();
      check();
    });

    it('rises after a line clear lowers the stack', () => {
      const g = new Game(MODES.classic!, 1);
      // Two bottom rows full but for column 0; a vertical I there clears both.
      for (const y of [ROWS - 1, ROWS - 2]) g.state.board[y] = Array<number>(COLS).fill(1);
      g.state.board[ROWS - 1]![0] = 0;
      g.state.board[ROWS - 2]![0] = 0;
      const bottom = (p: Piece) => Math.max(...cellsOf(p.kind, p.rot).map(([, cy]) => p.y + cy));
      // Before the clear, the next piece's ghost would land on the two rows.
      g.state.piece = spawn(g.state.next);
      expect(bottom(g.ghost())).toBe(ROWS - 3);
      g.state.piece = { kind: 'I', rot: 1, x: -2, y: 0 };
      g.hardDrop();
      expect(g.state.lines).toBe(2);
      // The next piece spawns over a now-empty well: its ghost reaches the floor.
      expect(bottom(g.ghost())).toBe(ROWS - 1);
    });

    it('is the piece itself when the piece rests on the stack', () => {
      const g = new Game(MODES.classic!, 1);
      // An O sitting on a one-row stack: one more step down would overlap it.
      g.state.board[ROWS - 1] = Array<number>(COLS).fill(1);
      g.state.board[ROWS - 1]![0] = 0;
      g.state.piece = { kind: 'O', rot: 0, x: 3, y: ROWS - 3 };
      const resting = { ...g.state.piece };
      expect(g.fits({ ...resting, y: resting.y + 1 })).toBe(false);
      expect(g.ghost()).toEqual(resting);
    });
  });

  it('both modes are registered', () => {
    expect(Object.keys(MODES).sort()).toEqual(['classic', 'override']);
  });
});
