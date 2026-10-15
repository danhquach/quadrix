import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS } from './game.ts';
import { MODES } from './modes/index.ts';
import { KINDS, cellsOf, makeBag, makeRng } from './pieces.ts';

describe('pieces', () => {
  it('every kind has 4 cells in every rotation', () => {
    for (const k of KINDS) for (let r = 0; r < 4; r++) expect(cellsOf(k, r)).toHaveLength(4);
  });

  it('4 rotations return to the spawn shape', () => {
    for (const k of KINDS) expect(cellsOf(k, 4)).toEqual(cellsOf(k, 0));
  });

  it('7-bag deals each kind once per 7 draws', () => {
    const draw = makeBag(makeRng(1));
    const seen = Array.from({ length: 7 }, draw).sort();
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

  it('both modes are registered', () => {
    expect(Object.keys(MODES).sort()).toEqual(['classic', 'override']);
  });
});
