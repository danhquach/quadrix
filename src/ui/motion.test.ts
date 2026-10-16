import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS } from '../core/game.ts';
import { MODES } from '../core/modes/index.ts';
import { cellsOf } from '../core/pieces.ts';
import { Session } from '../core/session.ts';
import {
  DROP_MS,
  GREY_ROW_MS,
  HOLD_MS,
  MAX_TRAIL,
  Motion,
  SLIDE_MS,
  SPAWN_MS,
  SPAWN_SCALE,
  SQUASH_MS,
  STRETCH,
} from './motion.ts';

const newGame = () => new Game(MODES.classic!, 7);

/** A motion watching `g`, settled: nothing animating yet. */
function watch(g: Game, level: 'full' | 'reduced' | 'off' = 'full'): Motion {
  const m = new Motion(level);
  m.observe(g, g.takeEvents());
  return m;
}

/** Let `g` act, then show the motion what happened, as main's settle does. */
function act(m: Motion, g: Game, action: (g: Game) => unknown): void {
  action(g);
  m.observe(g, g.takeEvents());
}

/** Run `m` for `ms` in frames short enough that none is clamped. */
function run(m: Motion, ms: number): void {
  for (let left = ms; left > 0; left -= 10) m.frame(Math.min(10, left), false);
}

/** Fill the rows the piece lands in, bar its own cells: a hard drop clears them. */
function setUpClear(g: Game): number[] {
  g.state.board = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  const land = g.ghost();
  const cells = cellsOf(land.kind, land.rot).map(([cx, cy]) => [land.x + cx, land.y + cy]);
  const rows = [...new Set(cells.map(([, y]) => y!))];
  for (const y of rows) {
    g.state.board[y] = Array.from({ length: COLS }, (_, x) =>
      cells.some(([cx, cy]) => cx === x && cy === y) ? 0 : 1,
    );
  }
  return rows;
}

describe('Motion: moves', () => {
  it('slides the drawn piece from its old cell to the new one', () => {
    const g = newGame();
    const m = watch(g);
    act(m, g, (g) => g.move(-1));
    expect(m.piece().dx).toBe(1);
    m.frame(SLIDE_MS / 2, false);
    expect(m.piece().dx).toBeGreaterThan(0);
    expect(m.piece().dx).toBeLessThan(1);
    m.frame(SLIDE_MS, false);
    expect(m.piece()).toEqual({ dx: 0, dy: 0, scale: 1, alpha: 1 });
  });

  it('slides a gravity step down', () => {
    const g = newGame();
    const m = watch(g);
    act(m, g, (g) => g.step());
    expect(m.piece().dy).toBe(-1);
    m.frame(SLIDE_MS, false);
    expect(m.piece().dy).toBe(0);
  });

  it('never blocks input: 10 presses in 100 ms all land at once, the drawing trails by a cell at most', () => {
    const g = newGame();
    const s = new Session(g, 0);
    const m = watch(g);
    const x0 = g.state.piece.x;
    const moved: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      // Right then left, so no wall cuts the run short.
      act(m, g, () => moved.push(s.act(i % 2 === 0 ? 'right' : 'left', i * 10)));
      expect(g.state.piece.x).toBe(i % 2 === 0 ? x0 + 1 : x0);
      expect(Math.abs(m.piece().dx)).toBeLessThanOrEqual(MAX_TRAIL);
      m.frame(10, false);
    }
    expect(moved).toEqual(Array(10).fill(true));
  });

  it('keeps a run of presses one way within a cell of the real piece', () => {
    const g = newGame();
    const m = watch(g);
    for (let i = 0; i < 3; i++) act(m, g, (g) => g.move(-1));
    expect(m.piece().dx).toBe(MAX_TRAIL);
  });

  it('a rotation without a kick does not slide', () => {
    const g = newGame();
    const m = watch(g);
    act(m, g, (g) => g.step());
    act(m, g, (g) => g.step());
    m.frame(SLIDE_MS, false);
    act(m, g, (g) => g.rotate());
    expect(m.piece().dx).toBe(0);
  });

  it('the ghost slides and fades with the piece', () => {
    const g = newGame();
    const m = watch(g);
    act(m, g, (g) => g.move(-1));
    expect(m.ghost(0.3)).toEqual({ dx: 1, alpha: 0.3 });
    act(m, g, (g) => g.hardDrop());
    expect(m.ghost(0.3)).toEqual({ dx: 0, alpha: 0 });
    run(m, SPAWN_MS);
    expect(m.ghost(0.3)).toEqual({ dx: 0, alpha: 0.3 });
  });

  it('never touches the game', () => {
    const g = newGame();
    const m = watch(g);
    g.move(1);
    const before = JSON.stringify(g.save());
    m.observe(g, g.takeEvents());
    m.frame(16, false);
    m.piece();
    expect(JSON.stringify(g.save())).toBe(before);
  });
});

describe('Motion: spawn', () => {
  it('fades and scales a new piece in', () => {
    const g = newGame();
    const m = watch(g);
    act(m, g, (g) => g.hardDrop());
    expect(m.piece().alpha).toBe(0);
    expect(m.piece().scale).toBe(SPAWN_SCALE);
    m.frame(SPAWN_MS, false);
    expect(m.piece()).toEqual({ dx: 0, dy: 0, scale: 1, alpha: 1 });
  });

  it('Reduced fades in without scaling; Off shows it at once', () => {
    const r = newGame();
    const reduced = watch(r, 'reduced');
    act(reduced, r, (g) => g.hardDrop());
    expect(reduced.piece()).toMatchObject({ alpha: 0, scale: 1 });
    const o = newGame();
    const off = watch(o, 'off');
    act(off, o, (g) => g.hardDrop());
    expect(off.piece()).toEqual({ dx: 0, dy: 0, scale: 1, alpha: 1 });
  });

  it('a new game starts still, with no slide from the last one', () => {
    const m = watch(newGame());
    const g = newGame();
    g.move(-3);
    m.observe(g, g.takeEvents());
    expect(m.piece()).toEqual({ dx: 0, dy: 0, scale: 1, alpha: 1 });
  });
});

describe('Motion: line clear', () => {
  it('holds the cleared rows, then drops the stack above with an ease-out', () => {
    const g = newGame();
    const rows = setUpClear(g);
    const top = Math.min(...rows);
    // A block above the cleared rows, to drop.
    g.state.board[top - 1]![0] = 1;
    const m = watch(g);
    act(m, g, (g) => g.hardDrop());
    const k = rows.length;
    const row = top - 1 + k;
    expect(g.state.board[row]![0]).toBe(1);
    expect(m.held().map((h) => h.y)).toEqual(rows);
    expect(m.held()[0]!.colors.every((c) => c > 0)).toBe(true);
    expect(m.rowShift(row)).toBe(-k);
    run(m, HOLD_MS - 1);
    expect(m.rowShift(row)).toBe(-k);
    run(m, 1 + DROP_MS / 2);
    expect(m.held()).toEqual([]);
    const mid = m.rowShift(row);
    // Ease-out: more than half way down at half time.
    expect(mid).toBeGreaterThan(-k / 2);
    expect(mid).toBeLessThan(0);
    run(m, DROP_MS / 2);
    expect(m.rowShift(row)).toBe(0);
  });

  it('drops each row by the rows cleared below it', () => {
    const g = newGame();
    const m = watch(g);
    const colors = Array<number>(COLS).fill(1);
    m.observe(g, [{ type: 'clear', rows: [16, 18], colors: [colors, colors] }]);
    expect(m.rowShift(19)).toBe(0);
    // Old 17 now sits at 18, old 15 at 17.
    expect(m.rowShift(18)).toBe(-1);
    expect(m.rowShift(17)).toBe(-2);
    expect(m.rowShift(2)).toBe(-2);
  });

  it('does not hold up the game: the next piece is in play at once and gravity keeps time', () => {
    const g = newGame();
    setUpClear(g);
    const s = new Session(g, 0);
    const m = watch(g);
    act(m, g, () => s.act('hardDrop', 0));
    expect(g.locks).toBe(1);
    expect(s.act('left', 1)).toBe(true);
    const y = g.state.piece.y;
    s.tick(g.state.mode.gravityMs(g.state.level));
    expect(g.state.piece.y).toBe(y + 1);
  });

  it('a second clear while the first still drops starts from the board as it stands', () => {
    const g = newGame();
    const m = watch(g);
    const colors = Array<number>(COLS).fill(1);
    m.observe(g, [{ type: 'clear', rows: [19], colors: [colors] }]);
    run(m, HOLD_MS + 10);
    m.observe(g, [{ type: 'clear', rows: [18, 19], colors: [colors, colors] }]);
    expect(m.held().map((h) => h.y)).toEqual([18, 19]);
    expect(m.rowShift(19)).toBe(-2);
    run(m, HOLD_MS + DROP_MS);
    expect(m.rowShift(19)).toBe(0);
    expect(m.held()).toEqual([]);
  });

  it('a clear that also ends the game holds, drops and greys', () => {
    const g = newGame();
    const m = watch(g);
    const colors = Array<number>(COLS).fill(1);
    m.observe(g, [
      { type: 'hardDrop', kind: 'I', fromY: 0, distance: 18, cells: [[0, 19]] },
      { type: 'lock', kind: 'I', cells: [[0, 19]] },
      { type: 'clear', rows: [19], colors: [colors] },
      { type: 'over' },
    ]);
    expect(m.held().map((h) => h.y)).toEqual([19]);
    expect(m.rowShift(19)).toBe(-1);
    expect(m.squashed()).toBeNull();
    expect(m.greyed(ROWS - 1)).toBe(true);
  });

  it('Reduced and Off clear at once', () => {
    for (const level of ['reduced', 'off'] as const) {
      const g = newGame();
      setUpClear(g);
      const m = watch(g, level);
      act(m, g, (g) => g.hardDrop());
      expect(m.held()).toEqual([]);
      expect(m.rowShift(ROWS - 1)).toBe(0);
    }
  });
});

describe('Motion: hard drop', () => {
  it('stretches, then squashes on impact, drawing the landed cells itself', () => {
    const g = newGame();
    const m = watch(g);
    act(m, g, (g) => g.hardDrop());
    const sq = m.squashed()!;
    expect(sq.sy).toBe(STRETCH);
    expect(sq.sx).toBeLessThan(1);
    const [x, y] = sq.cells[0]!;
    expect(g.state.board[y]![x]).toBeGreaterThan(0);
    expect(m.hides(x, y)).toBe(true);
    m.frame(SQUASH_MS / 3, false);
    expect(m.squashed()!.sy).toBeLessThan(1);
    m.frame(SQUASH_MS, false);
    expect(m.squashed()).toBeNull();
    expect(m.hides(x, y)).toBe(false);
  });

  it('a drop that clears lines holds the rows instead', () => {
    const g = newGame();
    setUpClear(g);
    const m = watch(g);
    act(m, g, (g) => g.hardDrop());
    expect(m.squashed()).toBeNull();
  });

  it('Reduced and Off do not squash', () => {
    for (const level of ['reduced', 'off'] as const) {
      const g = newGame();
      const m = watch(g, level);
      act(m, g, (g) => g.hardDrop());
      expect(m.squashed()).toBeNull();
    }
  });
});

describe('Motion: game over', () => {
  it('greys the stack row by row from the bottom up', () => {
    const g = newGame();
    const m = watch(g);
    m.observe(g, [{ type: 'over' }]);
    expect(m.greyed(ROWS - 1)).toBe(true);
    expect(m.greyed(ROWS - 2)).toBe(false);
    m.frame(GREY_ROW_MS, false);
    expect(m.greyed(ROWS - 2)).toBe(true);
    expect(m.greyed(0)).toBe(false);
    for (let t = 0; t < ROWS; t++) m.frame(GREY_ROW_MS, false);
    expect(m.greyed(0)).toBe(true);
  });

  it('reports the sweep as running until the top row greys, frame by frame', () => {
    const g = newGame();
    const m = watch(g);
    expect(m.greying()).toBe(false);
    m.observe(g, [{ type: 'over' }]);
    let ms = 0;
    while (m.greying()) {
      expect(m.greyed(0)).toBe(false);
      m.frame(10, false);
      ms += 10;
    }
    expect(m.greyed(0)).toBe(true);
    expect(ms).toBe((ROWS - 1) * GREY_ROW_MS);
    // A pause holds it.
    const h = newGame();
    const n = watch(h);
    n.observe(h, [{ type: 'over' }]);
    n.frame(10_000, true);
    expect(n.greying()).toBe(true);
  });

  it('Reduced and Off have no sweep to wait for', () => {
    for (const level of ['reduced', 'off'] as const) {
      const g = newGame();
      const m = watch(g, level);
      m.observe(g, [{ type: 'over' }]);
      expect(m.greying()).toBe(false);
    }
  });

  it('Reduced and Off grey it all at once', () => {
    for (const level of ['reduced', 'off'] as const) {
      const g = newGame();
      const m = watch(g, level);
      m.observe(g, [{ type: 'over' }]);
      expect(m.greyed(0)).toBe(true);
    }
  });

  it('a new game is not grey', () => {
    const g = newGame();
    const m = watch(g);
    m.observe(g, [{ type: 'over' }]);
    m.clear();
    m.observe(newGame(), []);
    expect(m.greyed(ROWS - 1)).toBe(false);
  });
});

describe('Motion: clock and level', () => {
  it('stands still while paused', () => {
    const g = newGame();
    const m = watch(g);
    act(m, g, (g) => g.move(1));
    m.frame(1000, true);
    expect(m.piece().dx).toBe(-1);
  });

  it('dropping to Reduced ends the motion at once, keeping the fade', () => {
    const g = newGame();
    setUpClear(g);
    const m = watch(g);
    act(m, g, (g) => g.hardDrop());
    act(m, g, (g) => g.move(1));
    m.level = 'reduced';
    expect(m.held()).toEqual([]);
    expect(m.rowShift(ROWS - 1)).toBe(0);
    expect(m.piece()).toMatchObject({ dx: 0, scale: 1, alpha: 0 });
    m.level = 'off';
    expect(m.piece().alpha).toBe(1);
  });
});
