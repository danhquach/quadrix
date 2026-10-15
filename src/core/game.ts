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
}

/** Pure engine: every action takes a state and mutates only that state. No DOM, no timers. */
export class Game {
  readonly state: GameState;
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

  /** Pieces locked since this object was made; lets the UI save after each lock. */
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

  /** One gravity step. Returns false when the piece locked instead of falling. */
  step(): boolean {
    if (this.state.over) return false;
    if (this.tryPlace({ ...this.state.piece, y: this.state.piece.y + 1 })) return true;
    this.lock();
    return false;
  }

  hardDrop(): void {
    if (this.state.over) return;
    while (this.tryPlace({ ...this.state.piece, y: this.state.piece.y + 1 })) {
      this.state.score += 2;
    }
    this.lock();
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

  private lock(): void {
    const s = this.state;
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
      s.level = s.mode.levelForLines(s.lines);
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

function spawn(kind: Kind): Piece {
  return { kind, rot: 0, x: 3, y: 0 };
}
