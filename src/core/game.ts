import { cellsOf, colorIndex, makeBag, makeRng, type Kind } from './pieces.ts';
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

/** Pure engine: every action takes a state and mutates only that state. No DOM, no timers. */
export class Game {
  readonly state: GameState;
  private readonly draw: () => Kind;

  constructor(mode: Mode, seed = Date.now()) {
    this.draw = makeBag(makeRng(seed));
    const first = this.draw();
    this.state = {
      mode,
      board: Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0)),
      piece: spawn(first),
      next: this.draw(),
      score: 0,
      lines: 0,
      level: 1,
      over: false,
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
    s.next = this.draw();
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
