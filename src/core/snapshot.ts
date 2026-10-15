import { COLS, Game, ROWS, type Piece } from './game.ts';
import { MODES } from './modes/index.ts';
import { KINDS, type Kind } from './pieces.ts';

/** Bump when the format changes; older snapshots are then discarded, not migrated. */
export const SNAPSHOT_VERSION = 1;

/** Longest snapshot text accepted. A real one is well under 1 KB. */
export const MAX_SNAPSHOT_CHARS = 4096;

/** Highest score or line count accepted: far beyond play, with room to add to it exactly. */
export const MAX_COUNT = 2 ** 40;

/** A game in progress as plain JSON data. */
export interface Snapshot {
  v: number;
  mode: string;
  board: number[][];
  piece: Piece;
  next: Kind;
  score: number;
  lines: number;
  level: number;
  rng: number;
  bag: Kind[];
}

/** The snapshot of a game in progress, as JSON text. */
export function toSnapshot(game: Game): string {
  const { bag, ...saved } = game.save();
  const snap: Snapshot = { v: SNAPSHOT_VERSION, mode: game.state.mode.id, ...saved, ...bag };
  return JSON.stringify(snap);
}

/**
 * The game a snapshot describes, or null if the text is not a valid current-version
 * snapshot. Everything read is untrusted: exact key sets, types, ranges and board size
 * are checked, and the piece must fit the board.
 */
export function fromSnapshot(text: string): Game | null {
  if (text.length > MAX_SNAPSHOT_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const s = record(data, SNAPSHOT_KEYS);
  if (!s || s.v !== SNAPSHOT_VERSION) return null;
  const mode = typeof s.mode === 'string' && Object.hasOwn(MODES, s.mode) ? MODES[s.mode]! : null;
  const piece = record(s.piece, PIECE_KEYS);
  if (
    !mode ||
    !piece ||
    !isBoard(s.board) ||
    !isKind(piece.kind) ||
    !isInt(piece.rot, 0, 3) ||
    !isInt(piece.x, -3, COLS) ||
    !isInt(piece.y, -3, ROWS) ||
    !isKind(s.next) ||
    !isInt(s.score, 0, MAX_COUNT) ||
    !isInt(s.lines, 0, MAX_COUNT) ||
    !isInt(s.level, 1, MAX_COUNT) ||
    s.level !== mode.levelForLines(s.lines) ||
    !isInt(s.rng, 0, 0xffffffff) ||
    !isBag(s.bag)
  ) {
    return null;
  }
  const game = new Game(mode, {
    board: s.board,
    piece: { kind: piece.kind, rot: piece.rot, x: piece.x, y: piece.y },
    next: s.next,
    score: s.score,
    lines: s.lines,
    level: s.level,
    bag: { rng: s.rng, bag: s.bag },
  });
  return game.fits(game.state.piece) ? game : null;
}

const SNAPSHOT_KEYS = [
  'v',
  'mode',
  'board',
  'piece',
  'next',
  'score',
  'lines',
  'level',
  'rng',
  'bag',
] as const;
const PIECE_KEYS = ['kind', 'rot', 'x', 'y'] as const;

/**
 * `v` as a plain object with exactly `keys`, or null. Other keys, including an own
 * `__proto__` from JSON.parse, are rejected rather than ignored.
 */
function record<K extends string>(v: unknown, keys: readonly K[]): Record<K, unknown> | null {
  if (typeof v !== 'object' || v === null || Object.getPrototypeOf(v) !== Object.prototype) {
    return null;
  }
  const own = Object.keys(v);
  if (own.length !== keys.length || !own.every((k) => (keys as readonly string[]).includes(k))) {
    return null;
  }
  return v as Record<K, unknown>;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
}

function isKind(v: unknown): v is Kind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

function isBoard(v: unknown): v is number[][] {
  return (
    Array.isArray(v) &&
    v.length === ROWS &&
    v.every(
      (row) =>
        Array.isArray(row) && row.length === COLS && row.every((c) => isInt(c, 0, KINDS.length)),
    )
  );
}

/** The kinds left in a 7-bag: fewer than 7, no repeats (an empty bag refills on draw). */
function isBag(v: unknown): v is Kind[] {
  return (
    Array.isArray(v) && v.length < KINDS.length && v.every(isKind) && new Set(v).size === v.length
  );
}
