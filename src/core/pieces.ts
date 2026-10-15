/** Tetromino kinds. Cell value on the board = index + 1 (0 = empty). */
export const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type Kind = (typeof KINDS)[number];

/** Spawn-orientation shapes as [x, y] cell offsets. */
// prettier-ignore
const SHAPES: Record<Kind, readonly (readonly [number, number])[]> = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

/** Bounding-box size used for rotation (I uses 4x4, O never rotates, rest 3x3). */
const BOX: Record<Kind, number> = { I: 4, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 };

/** Cells of `kind` at rotation `rot` (0..3, clockwise). */
export function cellsOf(kind: Kind, rot: number): [number, number][] {
  const n = BOX[kind];
  let cells = SHAPES[kind].map(([x, y]) => [x, y] as [number, number]);
  if (kind === 'O') return cells;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    cells = cells.map(([x, y]) => [n - 1 - y, x]);
  }
  return cells;
}

export function colorIndex(kind: Kind): number {
  return KINDS.indexOf(kind) + 1;
}

/** A 7-bag's full state: the PRNG's internal word and the kinds left in the bag. */
export interface BagState {
  rng: number;
  bag: Kind[];
}

/**
 * 7-bag randomizer: every kind appears once per 7 pieces. Seeded (mulberry32 PRNG) so
 * games and tests are reproducible, and its state can be saved and restored exactly.
 */
export class PieceBag {
  private a: number;
  private bag: Kind[];

  /** A fresh bag from `seed`, or one continued from a saved state. */
  constructor(from: number | BagState) {
    if (typeof from === 'number') {
      this.a = from >>> 0;
      this.bag = [];
    } else {
      this.a = from.rng >>> 0;
      this.bag = [...from.bag];
    }
  }

  next(): Kind {
    if (this.bag.length === 0) {
      this.bag = [...KINDS];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j]!, this.bag[i]!];
      }
    }
    return this.bag.pop()!;
  }

  save(): BagState {
    return { rng: this.a, bag: [...this.bag] };
  }

  /** mulberry32: a float in [0, 1). */
  private random(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
