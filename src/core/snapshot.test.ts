import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS } from './game.ts';
import { MAX_RUNGS, rung, startRung } from './ladder.ts';
import { MODES } from './modes/index.ts';
import {
  MAX_COUNT,
  MAX_SNAPSHOT_CHARS,
  SNAPSHOT_VERSION,
  fromSnapshot,
  toSnapshot,
} from './snapshot.ts';

/** A game a few pieces in, with a partly used bag and some board filled. */
function played(seed = 7, drops = 9): Game {
  const g = new Game(MODES.classic!, seed);
  for (let i = 0; i < drops; i++) {
    g.move(i % 2 ? -(i % 4) : i % 5);
    if (i % 3 === 0) g.rotate();
    g.hardDrop();
  }
  g.step();
  return g;
}

/** Drive a game with a fixed move script and record what it deals. */
function playOut(g: Game, n: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < n && !g.state.over; i++) {
    g.move((i % 7) - 3);
    if (i % 2) g.rotate();
    g.hardDrop();
    seen.push(`${g.state.piece.kind}${g.state.next}:${g.state.score}:${g.state.lines}`);
  }
  return seen;
}

function valid(): Record<string, unknown> {
  return JSON.parse(toSnapshot(played())) as Record<string, unknown>;
}

const parse = (o: unknown) => fromSnapshot(JSON.stringify(o));

describe('snapshot round trip', () => {
  it('restores an identical state', () => {
    const g = played();
    const r = fromSnapshot(toSnapshot(g))!;
    expect(r).not.toBeNull();
    const { mode, ...rest } = r.state;
    const { mode: gMode, ...gRest } = g.state;
    expect(mode).toBe(gMode);
    expect(rest).toEqual(gRest);
    expect(r.save()).toEqual(g.save());
  });

  it('deals the same next pieces and plays out the same', () => {
    for (const seed of [1, 7, 42, 0xffffffff]) {
      for (const drops of [0, 1, 6, 7, 13]) {
        const g = played(seed, drops);
        const r = fromSnapshot(toSnapshot(g))!;
        expect(playOut(r, 40)).toEqual(playOut(g, 40));
        expect(r.state.board).toEqual(g.state.board);
      }
    }
  });

  it('keeps the scoring chain: combo streak, back-to-back and a T piece just rotated', () => {
    // 6 pieces and 2 lines leave 4 cells: one O on the floor. Streak 2 is within lines 2.
    const board = new Game(MODES.classic!, 1).save().board;
    board[ROWS - 1]![0] = board[ROWS - 1]![1] = board[ROWS - 2]![0] = board[ROWS - 2]![1] = 2;
    const start = { ...new Game(MODES.classic!, 1).save(), board, lines: 2, pieces: 6 };
    const g = new Game(MODES.classic!, start);
    g.state.piece = { kind: 'T', rot: 0, x: 3, y: 0 };
    expect(g.rotate()).toBe(true);
    const saved = { ...g.save(), streak: 2, b2b: true };
    const text = toSnapshot(new Game(MODES.classic!, saved));
    expect(JSON.parse(text)).toMatchObject({ streak: 2, b2b: true, spun: true });
    expect(fromSnapshot(text)!.save()).toEqual(saved);
  });

  it('reads a streak too big for a safe integer as invalid', () => {
    expect(fromSnapshot(toSnapshot(played()).replace('"streak":0', '"streak":1e400'))).toBeNull();
  });

  it('accepts a just-rotated flag only on a T piece', () => {
    const g = new Game(MODES.classic!, 1);
    for (const kind of ['T', 'O'] as const) {
      g.state.piece = { kind, rot: 0, x: 3, y: 0 };
      const snap = { ...(JSON.parse(toSnapshot(g)) as object), spun: true };
      expect(parse(snap) !== null).toBe(kind === 'T');
      expect(parse({ ...snap, spun: false })).not.toBeNull();
    }
  });

  it('keeps the mode', () => {
    const g = new Game(MODES.override!, 3);
    expect(fromSnapshot(toSnapshot(g))!.state.mode).toBe(MODES.override);
  });

  it('copies state: the restored game does not share arrays with the text source', () => {
    const g = played();
    const r = fromSnapshot(toSnapshot(g))!;
    r.state.board[ROWS - 1]![0] = 5;
    r.hardDrop();
    expect(g.save()).toEqual(played().save());
  });
});

describe('snapshot rejects bad input', () => {
  const cases: [string, (s: Record<string, unknown>) => unknown][] = [
    ['older version', (s) => ({ ...s, v: SNAPSHOT_VERSION - 1 })],
    ['newer version', (s) => ({ ...s, v: SNAPSHOT_VERSION + 1 })],
    ['version as string', (s) => ({ ...s, v: String(SNAPSHOT_VERSION) })],
    ['unknown mode', (s) => ({ ...s, mode: 'turbo' })],
    ['inherited mode name', (s) => ({ ...s, mode: 'toString' })],
    ['mode as __proto__', (s) => ({ ...s, mode: '__proto__' })],
    ['mode with zero-width space', (s) => ({ ...s, mode: 'classic​' })],
    ['mode with bidi override', (s) => ({ ...s, mode: '‮classic' })],
    ['mode with Cyrillic look-alike', (s) => ({ ...s, mode: 'сlassic' })],
    ['mode in other case', (s) => ({ ...s, mode: 'Classic' })],
    ['extra key', (s) => ({ ...s, extra: 1 })],
    ['missing key', (s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'rng'))],
    ['null', () => null],
    ['array', () => []],
    ['number', () => 5],
    ['string', () => 'x'],
    ['score as string', (s) => ({ ...s, score: '100' })],
    ['negative score', (s) => ({ ...s, score: -1 })],
    ['fractional score', (s) => ({ ...s, score: 1.5 })],
    ['unsafe score', (s) => ({ ...s, score: 2 ** 60 })],
    ['score over the cap', (s) => ({ ...s, score: MAX_COUNT + 1 })],
    [
      'lines over the cap',
      (s) => ({ ...s, lines: MAX_COUNT + 1, level: MODES.classic!.levelForLines(MAX_COUNT + 1) }),
    ],
    ['level 0', (s) => ({ ...s, level: 0, lines: 0 })],
    ['level not matching lines', (s) => ({ ...s, level: 5 })],
    ['lines as null', (s) => ({ ...s, lines: null })],
    ['rng negative', (s) => ({ ...s, rng: -1 })],
    ['rng too big', (s) => ({ ...s, rng: 2 ** 32 })],
    ['next unknown', (s) => ({ ...s, next: 'X' })],
    ['bag oversize', (s) => ({ ...s, bag: ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] })],
    ['bag repeats', (s) => ({ ...s, bag: ['I', 'I'] })],
    ['bag of numbers', (s) => ({ ...s, bag: [1, 2] })],
    ['bag huge', (s) => ({ ...s, bag: Array(100000).fill('I') })],
    ['bag as object', (s) => ({ ...s, bag: { 0: 'I', length: 1 } })],
    ['board short', (s) => ({ ...s, board: (s.board as unknown[]).slice(1) })],
    ['board long', (s) => ({ ...s, board: [...(s.board as unknown[]), Array(COLS).fill(0)] })],
    ['board row wide', (s) => ({ ...s, board: (s.board as number[][]).map((r) => [...r, 0]) })],
    ['board as string', (s) => ({ ...s, board: 'x'.repeat(200) })],
    ['cell out of range', (s) => ({ ...s, board: withCell(s, 8) })],
    ['negative cell', (s) => ({ ...s, board: withCell(s, -1) })],
    ['fractional cell', (s) => ({ ...s, board: withCell(s, 0.5) })],
    ['cell as string', (s) => ({ ...s, board: withCell(s, '1') })],
    ['cell as null', (s) => ({ ...s, board: withCell(s, null) })],
    ['piece kind unknown', (s) => ({ ...s, piece: { ...piece(s), kind: 'Q' } })],
    ['piece rot 4', (s) => ({ ...s, piece: { ...piece(s), rot: 4 } })],
    ['piece off the left', (s) => ({ ...s, piece: { ...piece(s), x: -3 } })],
    ['piece off the right', (s) => ({ ...s, piece: { ...piece(s), x: COLS } })],
    ['piece below the floor', (s) => ({ ...s, piece: { ...piece(s), y: ROWS } })],
    ['piece far away', (s) => ({ ...s, piece: { ...piece(s), x: 1e9 } })],
    ['piece extra key', (s) => ({ ...s, piece: { ...piece(s), color: 1 } })],
    ['piece as array', (s) => ({ ...s, piece: [0, 0, 0, 0] })],
    ['streak as string', (s) => ({ ...s, streak: '1' })],
    ['negative streak', (s) => ({ ...s, streak: -1 })],
    ['fractional streak', (s) => ({ ...s, streak: 0.5 })],
    ['streak over the pieces locked', (s) => ({ ...s, streak: (s.pieces as number) + 1 })],
    ['streak over the lines cleared', (s) => ({ ...s, streak: (s.lines as number) + 1 })],
    ['streak missing', (s) => ({ ...s, streak: undefined })],
    ['streak as null', (s) => ({ ...s, streak: null })],
    ['unsafe streak', (s) => ({ ...s, streak: 2 ** 60 })],
    ['b2b as null', (s) => ({ ...s, b2b: null })],
    ['b2b with no lines cleared', (s) => ({ ...s, b2b: true })],
    ['spun missing', (s) => ({ ...s, spun: undefined })],
    ['spun as number', (s) => ({ ...s, spun: 1 })],
    ['spun as null', (s) => ({ ...s, spun: null })],
    ['b2b as number', (s) => ({ ...s, b2b: 1 })],
    ['b2b as string', (s) => ({ ...s, b2b: 'true' })],
    ['b2b missing', (s) => ({ ...s, b2b: undefined })],
    ['spun as string', (s) => ({ ...s, spun: 'true' })],
    [
      'piece overlapping the stack',
      (s) => ({ ...s, board: (s.board as number[][]).map((r) => r.map(() => 1)) }),
    ],
  ];

  it.each(cases)('%s', (_name, mutate) => {
    expect(parse(mutate(valid()))).toBeNull();
  });

  it('accepts the unmodified snapshot (the cases above are not all failing for one reason)', () => {
    expect(parse(valid())).not.toBeNull();
  });

  it('rejects __proto__ keys at any level and does not pollute Object.prototype', () => {
    const top = toSnapshot(played()).replace('{', '{"__proto__":{"polluted":1},');
    const inner = toSnapshot(played()).replace('"piece":{', '"piece":{"__proto__":{"polluted":1},');
    const ctor = toSnapshot(played()).replace('{', '{"constructor":{"prototype":{"polluted":1}},');
    for (const text of [top, inner, ctor]) {
      expect(fromSnapshot(text)).toBeNull();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it('rejects text that is not JSON, empty, or oversize', () => {
    expect(fromSnapshot('')).toBeNull();
    expect(fromSnapshot('{')).toBeNull();
    expect(fromSnapshot('undefined')).toBeNull();
    const big = toSnapshot(played()).replace('{', `{"pad":"${'x'.repeat(MAX_SNAPSHOT_CHARS)}",`);
    expect(fromSnapshot(big)).toBeNull();
  });

  it('rejects deeply nested input without blowing the stack', () => {
    const deep = '['.repeat(2000) + ']'.repeat(2000);
    expect(fromSnapshot(deep)).toBeNull();
  });
});

function withCell(s: Record<string, unknown>, value: unknown): unknown[][] {
  const board = (s.board as unknown[][]).map((r) => [...r]);
  board[ROWS - 1]![0] = value;
  return board;
}

function piece(s: Record<string, unknown>): Record<string, unknown> {
  return s.piece as Record<string, unknown>;
}

describe('snapshot of a ladder rung', () => {
  /** Rung `n` a few pieces in, short of its goal. */
  function rungPlayed(n = 16, drops = 5): Game {
    const g = startRung(rung(n));
    for (let i = 0; i < drops; i++) {
      g.move((i % 5) - 2);
      g.hardDrop();
    }
    return g;
  }
  const rungValid = () => JSON.parse(toSnapshot(rungPlayed())) as Record<string, unknown>;

  it('resumes as the same rung, pieces locked included', () => {
    for (const n of [1, 16, 1_000, MAX_RUNGS]) {
      const g = rungPlayed(n);
      const r = fromSnapshot(toSnapshot(g))!;
      expect(r).not.toBeNull();
      expect(r.rung).toBe(n);
      expect(r.locks).toBe(g.locks);
      expect(r.state.level).toBe(rung(n).startLevel);
      expect(r.save()).toEqual(g.save());
      expect(playOut(r, 20)).toEqual(playOut(g, 20));
    }
  });

  it('keeps the lock count of a free game too', () => {
    const g = played();
    expect(g.locks).toBeGreaterThan(0);
    expect(fromSnapshot(toSnapshot(g))!.locks).toBe(g.locks);
    expect(fromSnapshot(toSnapshot(g))!.rung).toBeNull();
  });

  it('accepts a rung with lines cleared, as long as the goal is not met', () => {
    // 10 more lines took 25 more pieces (4 cells each, 10 a line), leaving the board as is.
    const s = rungValid();
    expect(s.lines).toBe(0);
    const ten = { ...s, lines: 10, pieces: (s.pieces as number) + 25 };
    expect(rung(16).goalLines).toBeGreaterThan(10);
    expect(parse(ten)).not.toBeNull();
  });

  it('rejects a save whose board, pieces and lines disagree (forged stars)', () => {
    const s = rungValid();
    const pieces = s.pieces as number;
    expect(parse({ ...s, pieces: pieces - 1 })).toBeNull();
    expect(parse({ ...s, pieces: 0 })).toBeNull();
    expect(parse({ ...s, pieces: pieces + 1 })).toBeNull();
    expect(parse({ ...s, lines: 1 })).toBeNull();
    expect(parse({ ...valid(), pieces: (valid().pieces as number) - 1 })).toBeNull();
    // A free game claims no garbage: the rung's start cells don't count for it.
    expect(parse({ ...s, rung: null, level: 1 })).toBeNull();
  });

  const cases: [string, (s: Record<string, unknown>) => unknown][] = [
    ['rung 0', (s) => ({ ...s, rung: 0 })],
    ['rung negative', (s) => ({ ...s, rung: -1 })],
    ['rung over the cap', (s) => ({ ...s, rung: MAX_RUNGS + 1 })],
    ['rung unsafe', (s) => ({ ...s, rung: 2 ** 60 })],
    ['rung fractional', (s) => ({ ...s, rung: 1.5 })],
    ['rung as string', (s) => ({ ...s, rung: '16' })],
    ['rung as object', (s) => ({ ...s, rung: { valueOf: 16 } })],
    ['rung missing', (s) => ({ ...s, rung: undefined })],
    ['rung as boolean', (s) => ({ ...s, rung: true })],
    ['pieces as boolean', (s) => ({ ...s, pieces: true })],
    ['rung in another mode', (s) => ({ ...s, mode: 'override' })],
    ['rung goal already met', (s) => ({ ...s, lines: rung(16).goalLines })],
    ['rung level below its start', (s) => ({ ...s, level: rung(16).startLevel - 1 })],
    ['rung level above its start', (s) => ({ ...s, level: rung(16).startLevel + 1 })],
    ['level of a free game on a rung', (s) => ({ ...s, rung: null })],
    ['pieces negative', (s) => ({ ...s, pieces: -1 })],
    ['pieces over the cap', (s) => ({ ...s, pieces: MAX_COUNT + 1 })],
    ['pieces fractional', (s) => ({ ...s, pieces: 0.5 })],
    ['pieces as string', (s) => ({ ...s, pieces: '3' })],
    ['pieces missing', (s) => ({ ...s, pieces: undefined })],
  ];

  it.each(cases)('rejects %s', (_name, mutate) => {
    expect(parse(mutate(rungValid()))).toBeNull();
  });

  it('accepts the unmodified rung snapshot', () => {
    expect(parse(rungValid())).not.toBeNull();
  });

  it('rejects a version 1 snapshot, which had no rung or piece count', () => {
    const old = valid();
    delete old.rung;
    delete old.pieces;
    delete old.streak;
    delete old.b2b;
    delete old.spun;
    expect(parse({ ...old, v: 1 })).toBeNull();
  });

  it('rejects a version 2 snapshot, which had no scoring chain', () => {
    const old = valid();
    delete old.streak;
    delete old.b2b;
    delete old.spun;
    expect(parse({ ...old, v: 2 })).toBeNull();
    expect(SNAPSHOT_VERSION).toBe(3);
  });
});

describe('snapshot with pentominoes (QX-033)', () => {
  /** A free Classic game on `level` with a P and an L5 locked and some of the bag used. */
  function bigPieces(level = 11, seed = 5): Game {
    const lines = (level - 1) * 10;
    const fresh = new Game(MODES.classic!, seed);
    const empty = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
    const g = new Game(MODES.classic!, {
      ...fresh.save(),
      board: empty,
      lines,
      level,
      // As if every cleared cell came from a tetromino.
      pieces: (lines * COLS) / 4,
      bag: { rng: seed, bag: [] },
    });
    g.state.piece = { kind: 'P', rot: 0, x: 0, y: 0 };
    g.hardDrop();
    g.state.piece = { kind: 'L5', rot: 0, x: 5, y: 0 };
    g.hardDrop();
    g.hardDrop();
    return g;
  }
  const big = () => JSON.parse(toSnapshot(bigPieces())) as Record<string, unknown>;

  it('resumes with the same level, speed and piece set, and deals the same', () => {
    for (const seed of [1, 5, 42]) {
      const g = bigPieces(11, seed);
      const r = fromSnapshot(toSnapshot(g))!;
      expect(r).not.toBeNull();
      expect(r.save()).toEqual(g.save());
      expect(r.kinds).toEqual(g.kinds);
      expect(r.state.mode.gravityMs(r.state.level)).toBe(MODES.classic!.gravityMs(11));
      expect(playOut(r, 30)).toEqual(playOut(g, 30));
    }
  });

  it('accepts a bag holding new pieces', () => {
    const s = big();
    expect((s.bag as string[]).length).toBeGreaterThan(0);
    expect(parse({ ...s, bag: ['P', 'J5', 'I'] })).not.toBeNull();
  });

  it('rejects pieces not dealt yet at the level', () => {
    const s = big();
    for (const k of ['Y', 'I5', 'X']) {
      expect(parse({ ...s, next: k })).toBeNull();
      expect(parse({ ...s, bag: [k] })).toBeNull();
    }
    const low = { ...s, level: 5, lines: 40 };
    expect(parse({ ...low, bag: [] })).toBeNull(); // the board holds 5-cell pieces
    expect(parse({ ...low, piece: { kind: 'P', rot: 0, x: 3, y: 0 } })).toBeNull();
  });

  it('rejects a bag as big as the pool, with repeats, or with unknown kinds', () => {
    const s = big();
    const pool = MODES.classic!.kindsAt(11);
    expect(parse({ ...s, bag: [...pool] })).toBeNull();
    expect(parse({ ...s, bag: ['P', 'P'] })).toBeNull();
    for (const k of ['__proto__', 'constructor', 'p', 'P ', 'I6', '', 7, null]) {
      expect(parse({ ...s, bag: [k] })).toBeNull();
      expect(parse({ ...s, next: k })).toBeNull();
      expect(parse({ ...s, piece: { ...(s.piece as object), kind: k } })).toBeNull();
    }
  });

  it('needs 4 to 5 cells per locked piece, counting cleared lines', () => {
    const s = big();
    const cells = (s.board as number[][]).flat().filter((c) => c !== 0).length;
    const placed = cells + COLS * (s.lines as number);
    const fewest = Math.ceil(placed / 5);
    const most = Math.floor(placed / 4);
    expect(parse({ ...s, pieces: fewest })).not.toBeNull();
    expect(parse({ ...s, pieces: most })).not.toBeNull();
    expect(parse({ ...s, pieces: fewest - 1 })).toBeNull();
    expect(parse({ ...s, pieces: most + 1 })).toBeNull();
  });

  it('accepts board cells of every kind but nothing past them', () => {
    const s = JSON.parse(toSnapshot(bigPieces(46))) as Record<string, unknown>;
    const board = (s.board as number[][]).map((row) => [...row]);
    const at = board[ROWS - 1]!.findIndex((c) => c !== 0);
    board[ROWS - 1]![at] = 25;
    expect(parse({ ...s, board })).not.toBeNull();
    board[ROWS - 1]![at] = 26;
    expect(parse({ ...s, board })).toBeNull();
  });

  it('rejects a pentomino in a ladder rung save, at any level', () => {
    const g = startRung(rung(64));
    const s = JSON.parse(toSnapshot(g)) as Record<string, unknown>;
    expect(parse(s)).not.toBeNull();
    expect(parse({ ...s, next: 'P' })).toBeNull();
    expect(parse({ ...s, bag: ['P'] })).toBeNull();
    expect(parse({ ...s, piece: { kind: 'P', rot: 0, x: 3, y: 0 } })).toBeNull();
    const board = (s.board as number[][]).map((row) => [...row]);
    const at = board[ROWS - 1]!.findIndex((c) => c !== 0);
    board[ROWS - 1]![at] = 7;
    expect(parse({ ...s, board })).not.toBeNull();
    board[ROWS - 1]![at] = 8;
    expect(parse({ ...s, board })).toBeNull();
  });

  it('rejects a board cell coloured as a kind not dealt yet at the level', () => {
    const s = big(); // level 11: the tetrominoes and the first 4 pentominoes
    const board = (s.board as number[][]).map((row) => [...row]);
    const at = board[ROWS - 1]!.findIndex((c) => c !== 0);
    board[ROWS - 1]![at] = 11;
    expect(parse({ ...s, board })).not.toBeNull();
    board[ROWS - 1]![at] = 12;
    expect(parse({ ...s, board })).toBeNull();
  });

  it('a pre-QX-033 save (tetrominoes only) still resumes', () => {
    expect(parse(valid())).not.toBeNull();
    expect(SNAPSHOT_VERSION).toBe(3);
  });
});
