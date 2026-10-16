import { COLS, Game, ROWS, kindsFor, type Piece } from './game.ts';
import { MAX_RUNGS, rung } from './ladder.ts';
import { MODES } from './modes/index.ts';
import { classic } from './modes/classic.ts';
import { KINDS, cellsOf, type Kind } from './pieces.ts';

/** Bump when the format changes; older snapshots are then discarded, not migrated. */
export const SNAPSHOT_VERSION = 3;

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
  pieces: number;
  rung: number | null;
  streak: number;
  b2b: boolean;
  spun: boolean;
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
 * are checked, the piece must fit the board, and the board must hold exactly the cells its
 * pieces and lines leave. A ladder rung must be a Classic game
 * short of its goal, on the rung's start level or the one its lines give if higher.
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
    !isInt(s.rng, 0, 0xffffffff) ||
    !Array.isArray(s.bag) ||
    !isInt(s.pieces, 0, MAX_COUNT) ||
    !(s.rung === null || isInt(s.rung, 1, MAX_RUNGS)) ||
    // Every drop in a streak cleared a line, and back-to-back needs a clear behind it.
    !isInt(s.streak, 0, Math.min(s.pieces, s.lines)) ||
    !(s.b2b === false || (s.b2b === true && s.lines > 0)) ||
    !(s.spun === false || (s.spun === true && piece.kind === 'T'))
  ) {
    return null;
  }
  let startCells = 0;
  if (s.rung === null) {
    if (s.level !== mode.levelForLines(s.lines)) return null;
  } else {
    const r = rung(s.rung);
    if (mode !== classic || s.lines >= r.goalLines) return null;
    if (s.level !== Math.max(r.startLevel, mode.levelForLines(s.lines))) return null;
    startCells = filled(r.board);
  }
  // The falling piece, the next one and the bag come from the pieces dealt at this level
  // (the set only grows with the level, so nothing dealt earlier falls outside it).
  const kinds = kindsFor(mode, s.level, s.rung);
  if (!kinds.includes(piece.kind) || !kinds.includes(s.next) || !isBag(s.bag, kinds)) {
    return null;
  }
  // The pool is a prefix of KINDS, so a board cell can't hold the colour of a kind not dealt.
  if (s.board.some((row) => row.some((c) => c > kinds.length))) return null;
  // Every lock adds 4 or 5 cells and every cleared line takes 10, so the board, piece count
  // and lines must agree. With tetrominoes alone (every rung) that is exact: a save can't
  // claim fewer pieces (more stars) than it used.
  const minCell = Math.min(...kinds.map((k) => cellsOf(k, 0).length));
  const maxCell = Math.max(...kinds.map((k) => cellsOf(k, 0).length));
  const placed = filled(s.board) - startCells + COLS * s.lines;
  if (placed < minCell * s.pieces || placed > maxCell * s.pieces) return null;
  const game = new Game(mode, {
    board: s.board,
    piece: { kind: piece.kind, rot: piece.rot, x: piece.x, y: piece.y },
    next: s.next,
    score: s.score,
    lines: s.lines,
    level: s.level,
    bag: { rng: s.rng, bag: s.bag },
    pieces: s.pieces,
    rung: s.rung,
    streak: s.streak,
    b2b: s.b2b,
    spun: s.spun,
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
  'pieces',
  'rung',
  'streak',
  'b2b',
  'spun',
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

function filled(board: number[][]): number {
  return board.reduce((n, row) => n + row.filter((c) => c !== 0).length, 0);
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

/** The kinds left in a bag of `kinds`: fewer than all, no repeats (an empty bag refills on draw). */
function isBag(v: unknown, kinds: readonly Kind[]): v is Kind[] {
  return (
    Array.isArray(v) &&
    v.length < kinds.length &&
    v.every((k) => isKind(k) && kinds.includes(k)) &&
    new Set(v).size === v.length
  );
}
