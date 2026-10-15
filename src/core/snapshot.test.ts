import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS } from './game.ts';
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
