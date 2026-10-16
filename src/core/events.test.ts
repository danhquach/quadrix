import { describe, expect, it } from 'vitest';
import { MAX_EVENTS } from './events.ts';
import { COLS, Game, ROWS } from './game.ts';
import { MODES } from './modes/index.ts';
import { cellsOf, colorIndex } from './pieces.ts';
import { LOCK_DELAY_MS, Session } from './session.ts';

const emptyBoard = () => Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));

/**
 * An empty board with the piece on the floor and the rows it covers full bar its own
 * cells, so the next hard drop clears every row it is in. Returns those rows.
 */
function setUpClear(g: Game): number[] {
  g.state.board = emptyBoard();
  const land = g.ghost();
  g.state.piece = land;
  const cells = cellsOf(land.kind, land.rot).map(([cx, cy]) => [land.x + cx, land.y + cy]);
  const rows = [...new Set(cells.map(([, y]) => y!))].sort((a, b) => a - b);
  for (const y of rows) {
    g.state.board[y] = Array.from({ length: COLS }, (_, x) =>
      cells.some(([cx, cy]) => cx === x && cy === y) ? 0 : 1 + (x % 7),
    );
  }
  return rows;
}

describe('game events', () => {
  it('a hard drop reports the drop, then the lock, once each, with their cells', () => {
    const g = new Game(MODES.classic!, 1);
    const p = { ...g.state.piece };
    const land = g.ghost();
    g.hardDrop();
    const events = g.takeEvents();
    expect(events.map((e) => e.type)).toEqual(['hardDrop', 'lock']);
    const cells = cellsOf(p.kind, p.rot).map(([cx, cy]) => [land.x + cx, land.y + cy]);
    expect(events[0]).toEqual({
      type: 'hardDrop',
      kind: p.kind,
      fromY: p.y,
      distance: land.y - p.y,
      cells,
    });
    expect(events[1]).toEqual({ type: 'lock', kind: p.kind, cells });
    // Each cell reported is one the piece now fills on the board.
    for (const [x, y] of cells) expect(g.state.board[y!]![x!]).toBe(colorIndex(p.kind));
  });

  it('a lock without a hard drop (lock delay) reports only the lock', () => {
    const g = new Game(MODES.classic!, 1);
    while (g.step());
    expect(g.takeEvents()).toEqual([]);
    g.lock();
    expect(g.takeEvents().map((e) => e.type)).toEqual(['lock']);
  });

  it('a clear reports its rows top to bottom and their colours before clearing', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = new Game(MODES.classic!, seed);
      const rows = setUpClear(g);
      const kind = g.state.piece.kind;
      g.hardDrop();
      const events = g.takeEvents();
      expect(events.map((e) => e.type)).toEqual(['hardDrop', 'lock', 'clear']);
      const clear = events[2]!;
      if (clear.type !== 'clear') throw new Error('not a clear');
      expect(clear.rows).toEqual(rows);
      expect(clear.rows).toHaveLength(g.state.lines);
      // Every cleared row was full: the stack's colours plus the piece's own.
      for (const row of clear.colors) {
        expect(row).toHaveLength(COLS);
        expect(row.every((c) => c !== 0)).toBe(true);
        expect(row).toContain(colorIndex(kind));
      }
    }
  });

  it('a clear that raises the level reports it once, with old and new level', () => {
    const g = new Game(MODES.classic!, 1);
    g.state.lines = 9;
    setUpClear(g);
    g.hardDrop();
    const ups = g.takeEvents().filter((e) => e.type === 'levelUp');
    expect(ups).toEqual([{ type: 'levelUp', from: 1, level: 2 }]);
    // The next clear stays on level 2: no event.
    setUpClear(g);
    g.hardDrop();
    expect(g.takeEvents().some((e) => e.type === 'levelUp')).toBe(false);
  });

  it('game over is reported once, after the lock that caused it, and nothing after', () => {
    const g = new Game(MODES.classic!, 1);
    for (let y = 0; y < ROWS; y++)
      g.state.board[y] = Array<number>(COLS)
        .fill(1)
        .map((c, x) => (x === 9 ? 0 : c));
    g.state.piece = { kind: 'O', rot: 0, x: 3, y: -2 };
    g.hardDrop();
    expect(g.state.over).toBe(true);
    expect(g.takeEvents().map((e) => e.type)).toEqual(['hardDrop', 'over']);
    g.hardDrop();
    g.lock();
    g.move(1);
    expect(g.takeEvents()).toEqual([]);
  });

  it('a spawn that cannot fit reports the lock, then over', () => {
    const g = new Game(MODES.classic!, 1);
    // Block the spawn rows (one gap each, so they never clear); the piece locks below.
    for (let y = 0; y < 2; y++) g.state.board[y] = Array<number>(COLS).fill(1);
    for (let y = 0; y < 2; y++) g.state.board[y]![0] = 0;
    g.state.piece = { kind: 'O', rot: 0, x: 7, y: 2 };
    g.lock();
    expect(g.state.over).toBe(true);
    expect(g.takeEvents().map((e) => e.type)).toEqual(['lock', 'over']);
  });

  it('moves, rotations and gravity steps report nothing', () => {
    const g = new Game(MODES.classic!, 1);
    g.move(1);
    g.move(-1);
    g.rotate();
    g.step();
    expect(g.takeEvents()).toEqual([]);
  });

  it('taking the events empties them; each is taken once', () => {
    const g = new Game(MODES.classic!, 1);
    g.hardDrop();
    expect(g.takeEvents()).toHaveLength(2);
    expect(g.takeEvents()).toEqual([]);
  });

  it('keeps at most MAX_EVENTS untaken, dropping the oldest', () => {
    const g = new Game(MODES.classic!, 1);
    for (let i = 0; i < MAX_EVENTS; i++) {
      g.state.board = emptyBoard();
      g.hardDrop();
    }
    const events = g.takeEvents();
    expect(events).toHaveLength(MAX_EVENTS);
    // The newest survive: the list still ends on the last lock.
    expect(events.at(-1)!.type).toBe('lock');
  });

  it('a lock delay running out in a session reports one lock', () => {
    const g = new Game(MODES.classic!, 1);
    const s = new Session(g, 0);
    let now = 0;
    while (!g.grounded()) s.tick((now += 1000));
    g.takeEvents();
    s.tick(now + LOCK_DELAY_MS);
    expect(g.takeEvents().map((e) => e.type)).toEqual(['lock']);
  });

  it('taking events never changes the game: same seed, same moves, same state', () => {
    const play = (take: boolean) => {
      const g = new Game(MODES.classic!, 7);
      for (let i = 0; i < 200 && !g.state.over; i++) {
        if (i % 3 === 0) g.rotate();
        g.move((i % 5) - 2);
        if (i % 4 === 0) setUpClear(g);
        g.hardDrop();
        if (take) g.takeEvents();
      }
      return { state: g.state, save: g.save(), award: g.award };
    };
    expect(play(true)).toEqual(play(false));
  });
});
