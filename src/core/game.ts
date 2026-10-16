import { MAX_EVENTS, type Cell, type GameEvent } from './events.ts';
import { PieceBag, cellsOf, colorIndex, type BagState, type Kind } from './pieces.ts';
import type { Mode } from './modes/index.ts';
import { scoreLock, type Award, type Chain, type Spin } from './scoring.ts';

export const COLS = 10;
export const ROWS = 20;

export interface Piece {
  kind: Kind;
  rot: number;
  x: number;
  y: number;
}

export interface GameState {
  mode: Mode;
  board: number[][]; // [row][col], 0 = empty
  piece: Piece;
  next: Kind;
  score: number;
  lines: number;
  level: number;
  over: boolean;
}

/** Everything needed to continue a game exactly, bar its mode (see snapshot.ts). */
export interface SavedGame {
  board: number[][];
  piece: Piece;
  next: Kind;
  score: number;
  lines: number;
  level: number;
  bag: BagState;
  /** Pieces locked so far. */
  pieces: number;
  /** The ladder rung this game plays, or null for a free game. */
  rung: number | null;
  /** Drops in a row that cleared lines. */
  streak: number;
  /** Whether the last clear was a quad or a spin clear. */
  b2b: boolean;
  /** Whether the falling piece's last move was a rotation. */
  spun: boolean;
}

/** Pure engine: every action takes a state and mutates only that state. No DOM, no timers. */
export class Game {
  readonly state: GameState;
  /** The ladder rung this game plays, or null for a free game. */
  readonly rung: number | null = null;
  private readonly bag: PieceBag;
  private lockCount = 0;
  private streak = 0;
  private b2b = false;
  /** The falling piece's last successful move was a rotation (for spin detection). */
  private spun = false;
  private lastAward: Award | null = null;
  /** Events since the last takeEvents(); never part of the state or a save. */
  private events: GameEvent[] = [];

  /** A new game from `seed`, or one continued from a save (trusted: validate it first). */
  constructor(mode: Mode, from: number | SavedGame = Date.now()) {
    if (typeof from !== 'number') {
      this.bag = new PieceBag(from.bag);
      this.state = {
        mode,
        board: from.board.map((row) => [...row]),
        piece: { ...from.piece },
        next: from.next,
        score: from.score,
        lines: from.lines,
        level: from.level,
        over: false,
      };
      this.lockCount = from.pieces;
      this.rung = from.rung;
      this.streak = from.streak;
      this.b2b = from.b2b;
      this.spun = from.spun;
      return;
    }
    this.bag = new PieceBag(from);
    const first = this.bag.next();
    this.state = {
      mode,
      board: Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0)),
      piece: spawn(first),
      next: this.bag.next(),
      score: 0,
      lines: 0,
      level: 1,
      over: false,
    };
  }

  /** Pieces locked in this game, a save's included; lets the UI save after each lock. */
  get locks(): number {
    return this.lockCount;
  }

  private chain(): Chain {
    return { streak: this.streak, b2b: this.b2b };
  }

  /** What the last lock scored and why, or null before the first lock. */
  get award(): Award | null {
    return this.lastAward;
  }

  /** The events reported since the last call, oldest first; the game forgets them. */
  takeEvents(): GameEvent[] {
    const taken = this.events;
    this.events = [];
    return taken;
  }

  private emit(event: GameEvent): void {
    if (this.events.push(event) > MAX_EVENTS) this.events.shift();
  }

  /** A copy of the state to continue this game later. Meaningless once the game is over. */
  save(): SavedGame {
    const s = this.state;
    return {
      board: s.board.map((row) => [...row]),
      piece: { ...s.piece },
      next: s.next,
      score: s.score,
      lines: s.lines,
      level: s.level,
      bag: this.bag.save(),
      pieces: this.lockCount,
      rung: this.rung,
      streak: this.streak,
      b2b: this.b2b,
      spun: this.spun,
    };
  }

  move(dx: number): boolean {
    return this.shift({ ...this.state.piece, x: this.state.piece.x + dx });
  }

  /** Rotate clockwise with a simple wall kick (try 0, -1, +1, -2, +2). */
  rotate(): boolean {
    const p = this.state.piece;
    for (const kick of [0, -1, 1, -2, 2]) {
      if (this.tryPlace({ ...p, rot: (p.rot + 1) % 4, x: p.x + kick })) {
        this.spun = true;
        return true;
      }
    }
    return false;
  }

  /** One gravity step. Returns false when the piece rests on the stack; it never locks. */
  step(): boolean {
    return this.shift({ ...this.state.piece, y: this.state.piece.y + 1 });
  }

  /** Whether the piece rests on the floor or the stack (one row down would not fit). */
  grounded(): boolean {
    const p = this.state.piece;
    return !this.fits({ ...p, y: p.y + 1 });
  }

  hardDrop(): void {
    if (this.state.over) return;
    const landing = this.ghost();
    const distance = landing.y - this.state.piece.y;
    this.state.score += 2 * distance;
    if (distance !== 0) this.spun = false;
    this.emit({
      type: 'hardDrop',
      kind: landing.kind,
      fromY: this.state.piece.y,
      distance,
      cells: cellsAt(landing),
    });
    this.state.piece = landing;
    this.lock();
  }

  /** Where the falling piece would land if hard-dropped now (the piece itself when resting). */
  ghost(): Piece {
    let p = this.state.piece;
    for (let below = { ...p, y: p.y + 1 }; this.fits(below); below = { ...below, y: below.y + 1 }) {
      p = below;
    }
    return p;
  }

  fits(p: Piece): boolean {
    return cellsOf(p.kind, p.rot).every(([cx, cy]) => {
      const x = p.x + cx;
      const y = p.y + cy;
      return x >= 0 && x < COLS && y < ROWS && (y < 0 || this.state.board[y]![x] === 0);
    });
  }

  /** Move without rotating: a successful one ends any spin. */
  private shift(p: Piece): boolean {
    if (!this.tryPlace(p)) return false;
    this.spun = false;
    return true;
  }

  private tryPlace(p: Piece): boolean {
    if (this.state.over || !this.fits(p)) return false;
    this.state.piece = p;
    return true;
  }

  /** Fix the piece to the board where it is, clear lines and spawn the next. */
  lock(): void {
    const s = this.state;
    if (s.over) return;
    this.lockCount++;
    // A lock-out scores nothing: don't leave the previous lock's award in place.
    this.lastAward = null;
    const spin = this.spun ? tSpin(s.board, s.piece) : 'none';
    this.spun = false;
    const color = colorIndex(s.piece.kind);
    for (const [cx, cy] of cellsOf(s.piece.kind, s.piece.rot)) {
      const y = s.piece.y + cy;
      if (y < 0) {
        this.end();
        return;
      }
      s.board[y]![s.piece.x + cx] = color;
    }
    this.emit({ type: 'lock', kind: s.piece.kind, cells: cellsAt(s.piece) });
    const cleared = this.clearLines();
    const fullClear = cleared > 0 && s.board.every((row) => row.every((c) => c === 0));
    const award = scoreLock(s.mode, s.level, cleared, spin, this.chain(), fullClear);
    this.lastAward = award;
    this.streak = award.streak;
    this.b2b = award.b2b;
    s.score += award.points;
    if (award.points > 0 || award.labels.length > 0) {
      const { points, labels, streak } = award;
      const combo = Math.max(0, streak - 1);
      this.emit({ type: 'award', points, labels: [...labels], level: s.level, combo, fullClear });
    }
    if (cleared > 0) {
      s.lines += cleared;
      // Never below the level the game started on (a ladder rung can start above 1).
      const from = s.level;
      s.level = Math.max(s.level, s.mode.levelForLines(s.lines));
      if (s.level > from) this.emit({ type: 'levelUp', from, level: s.level });
    }
    s.piece = spawn(s.next);
    s.next = this.bag.next();
    if (!this.fits(s.piece)) this.end();
  }

  private end(): void {
    this.state.over = true;
    this.emit({ type: 'over' });
  }

  private clearLines(): number {
    const rows: number[] = [];
    const colors: number[][] = [];
    this.state.board.forEach((row, y) => {
      if (row.some((c) => c === 0)) return;
      rows.push(y);
      colors.push([...row]);
    });
    if (rows.length > 0) this.emit({ type: 'clear', rows, colors });
    const kept = this.state.board.filter((row) => row.some((c) => c === 0));
    const cleared = ROWS - kept.length;
    for (let i = 0; i < cleared; i++) kept.unshift(Array<number>(COLS).fill(0));
    this.state.board = kept;
    return cleared;
  }
}

/** The T piece's corners in its 3x3 box, clockwise from top left. */
const CORNERS = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
] as const;

/**
 * How a T piece at `p` sits in `board`: a spin when 3 of the 4 corners around its centre
 * are filled (walls and floor count), full when both corners it points at are, else mini.
 */
export function tSpin(board: number[][], p: Piece): Spin {
  if (p.kind !== 'T') return 'none';
  const filled = CORNERS.map(([cx, cy]) => {
    const x = p.x + cx;
    const y = p.y + cy;
    return x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y]![x] !== 0);
  });
  if (filled.filter(Boolean).length < 3) return 'none';
  // Rotation r points at corners r and r + 1 (0 points up: top left and top right).
  return filled[p.rot]! && filled[(p.rot + 1) % 4]! ? 'full' : 'mini';
}

/** The board cells piece `p` covers. */
function cellsAt(p: Piece): Cell[] {
  return cellsOf(p.kind, p.rot).map(([cx, cy]) => [p.x + cx, p.y + cy] as const);
}

/** A new piece of `kind` at the spawn position. */
export function spawn(kind: Kind): Piece {
  return { kind, rot: 0, x: 3, y: 0 };
}
