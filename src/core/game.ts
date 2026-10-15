import { PieceBag, cellsOf, colorIndex, type BagState, type Kind } from './pieces.ts';
import type { Mode } from './modes/index.ts';

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
}

/** Pure engine: every action takes a state and mutates only that state. No DOM, no timers. */
export class Game {
  readonly state: GameState;
  /** The ladder rung this game plays, or null for a free game. */
  readonly rung: number | null = null;
  private readonly bag: PieceBag;
  private lockCount = 0;

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
    };
  }

  move(dx: number): boolean {
    return this.tryPlace({ ...this.state.piece, x: this.state.piece.x + dx });
  }

  /** Rotate clockwise with a simple wall kick (try 0, -1, +1, -2, +2). */
  rotate(): boolean {
    const p = this.state.piece;
    for (const kick of [0, -1, 1, -2, 2]) {
      if (this.tryPlace({ ...p, rot: (p.rot + 1) % 4, x: p.x + kick })) return true;
    }
    return false;
  }

  /** One gravity step. Returns false when the piece rests on the stack; it never locks. */
  step(): boolean {
    return this.tryPlace({ ...this.state.piece, y: this.state.piece.y + 1 });
  }

  /** Whether the piece rests on the floor or the stack (one row down would not fit). */
  grounded(): boolean {
    const p = this.state.piece;
    return !this.fits({ ...p, y: p.y + 1 });
  }

  hardDrop(): void {
    if (this.state.over) return;
    const landing = this.ghost();
    this.state.score += 2 * (landing.y - this.state.piece.y);
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
    const color = colorIndex(s.piece.kind);
    for (const [cx, cy] of cellsOf(s.piece.kind, s.piece.rot)) {
      const y = s.piece.y + cy;
      if (y < 0) {
        s.over = true;
        return;
      }
      s.board[y]![s.piece.x + cx] = color;
    }
    const cleared = this.clearLines();
    if (cleared > 0) {
      s.score += s.mode.scoreForLines(cleared, s.level);
      s.lines += cleared;
      // Never below the level the game started on (a ladder rung can start above 1).
      s.level = Math.max(s.level, s.mode.levelForLines(s.lines));
    }
    s.piece = spawn(s.next);
    s.next = this.bag.next();
    if (!this.fits(s.piece)) s.over = true;
  }

  private clearLines(): number {
    const kept = this.state.board.filter((row) => row.some((c) => c === 0));
    const cleared = ROWS - kept.length;
    for (let i = 0; i < cleared; i++) kept.unshift(Array<number>(COLS).fill(0));
    this.state.board = kept;
    return cleared;
  }
}

/** A new piece of `kind` at the spawn position. */
export function spawn(kind: Kind): Piece {
  return { kind, rot: 0, x: 3, y: 0 };
}
