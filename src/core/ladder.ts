import { COLS, Game, ROWS, spawn, type GameState, type SavedGame } from './game.ts';
import { classic } from './modes/classic.ts';
import { KINDS, PieceBag, mulberry32 } from './pieces.ts';

/** Fixed seed of the one ladder every player climbs. Changing it changes every rung. */
export const LADDER_SEED = 0x51a3d0c6;

/** Most garbage rows a rung starts with; leaves the top of the board free to spawn and play. */
export const MAX_GARBAGE_ROWS = 8;

/** A ladder rung: everything about it follows from its number. */
export interface Rung {
  /** 1-based rung number. */
  index: number;
  /** Lines to clear to pass. */
  goalLines: number;
  /** Starting level (sets gravity). */
  startLevel: number;
  /** Starting board, [row][col] like the game board: garbage rows at the bottom. */
  board: number[][];
  /** Seed of the rung's piece sequence. */
  pieceSeed: number;
  /** Most pieces locked for 3 and for 2 stars. */
  stars: { three: number; two: number };
}

export type RungOutcome = 'playing' | 'passed' | 'failed';

/**
 * Rung `index` (a positive safe integer). Difficulty grows with each doubling of the
 * index and never stops: goal and starting level rise forever, garbage up to its cap.
 */
export function rung(index: number): Rung {
  if (!Number.isSafeInteger(index) || index < 1) {
    throw new RangeError(`rung index must be a positive safe integer, got ${index}`);
  }
  const k = floorLog2(index);
  const goalLines = 4 + 2 * k;
  const garbage = Math.min(MAX_GARBAGE_ROWS, Math.floor(k / 2));

  let rng = seedFor(index);
  const random = (): number => {
    const [value, next] = mulberry32(rng);
    rng = next;
    return value;
  };

  const board = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  for (let y = ROWS - garbage; y < ROWS; y++) {
    const hole = Math.floor(random() * COLS);
    for (let x = 0; x < COLS; x++) {
      if (x !== hole) board[y]![x] = 1 + Math.floor(random() * KINDS.length);
    }
  }

  // Par: pieces to fill the goal's rows from empty (10 cells a row, 4 a piece).
  const par = Math.ceil((goalLines * COLS) / 4);
  return {
    index,
    goalLines,
    startLevel: 1 + k,
    board,
    pieceSeed: Math.floor(random() * 2 ** 32),
    stars: { three: Math.ceil(par * 1.25), two: Math.ceil(par * 1.6) },
  };
}

/** A new Classic game set up at the start of `r`. */
export function startRung(r: Rung): Game {
  const bag = new PieceBag(r.pieceSeed);
  const first = bag.next();
  const next = bag.next();
  const start: SavedGame = {
    board: r.board.map((row) => [...row]),
    piece: spawn(first),
    next,
    score: 0,
    lines: 0,
    level: r.startLevel,
    bag: bag.save(),
  };
  return new Game(classic, start);
}

/** Passed once the goal is met (even if that lock then tops out); failed on top-out before it. */
export function rungOutcome(r: Rung, s: Pick<GameState, 'lines' | 'over'>): RungOutcome {
  if (s.lines >= r.goalLines) return 'passed';
  return s.over ? 'failed' : 'playing';
}

/** Stars for a passed rung from the pieces locked: 3, 2 or 1. */
export function rungStars(r: Rung, pieces: number): 1 | 2 | 3 {
  if (pieces <= r.stars.three) return 3;
  if (pieces <= r.stars.two) return 2;
  return 1;
}

/** floor(log2(n)) for n >= 1, exact for every safe integer. */
function floorLog2(n: number): number {
  let k = 0;
  while (n >= 2) {
    n = Math.floor(n / 2);
    k++;
  }
  return k;
}

/** Mix the ladder seed with the rung index (both 32-bit halves) into a PRNG word. */
function seedFor(index: number): number {
  const lo = index >>> 0;
  const hi = Math.floor(index / 2 ** 32) >>> 0;
  return fmix32(fmix32(LADDER_SEED ^ lo) ^ hi);
}

/** MurmurHash3 finaliser: spreads every input bit across the word. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
