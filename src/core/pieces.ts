/** The 7 tetrominoes: every game deals these. */
export const TETROMINOES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

/**
 * The 18 one-sided pentominoes, easiest first; a mirror image ends in `m` and joins with
 * its pair. Classic adds them two at a time as the level rises (see modes/classic.ts).
 */
// prettier-ignore
export const PENTOMINOES = [
  'P', 'Pm', 'L5', 'J5', 'Y', 'Ym', 'N', 'Nm', 'T5',
  'U', 'V', 'W', 'F', 'Fm', 'S5', 'Z5', 'X', 'I5',
] as const;

/** Every piece kind. Cell value on the board = index + 1 (0 = empty). */
export const KINDS = [...TETROMINOES, ...PENTOMINOES] as const;
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
  P: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]],
  Pm: [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  L5: [[3, 0], [0, 1], [1, 1], [2, 1], [3, 1]],
  J5: [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1]],
  Y: [[1, 0], [0, 1], [1, 1], [2, 1], [3, 1]],
  Ym: [[2, 0], [0, 1], [1, 1], [2, 1], [3, 1]],
  N: [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1]],
  Nm: [[2, 0], [3, 0], [0, 1], [1, 1], [2, 1]],
  T5: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  U: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  V: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  W: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
  F: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  Fm: [[0, 0], [1, 0], [1, 1], [2, 1], [1, 2]],
  S5: [[1, 0], [2, 0], [1, 1], [0, 2], [1, 2]],
  Z5: [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]],
  X: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  I5: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]],
};

/** Bounding-box size used for rotation (O never rotates). */
// prettier-ignore
const BOX: Record<Kind, number> = {
  I: 4, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3,
  P: 3, Pm: 3, L5: 4, J5: 4, Y: 4, Ym: 4, N: 4, Nm: 4, T5: 3,
  U: 3, V: 3, W: 3, F: 3, Fm: 3, S5: 3, Z5: 3, X: 3, I5: 5,
};

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

/** A bag's full state: the PRNG's internal word and the kinds left in the bag. */
export interface BagState {
  rng: number;
  bag: Kind[];
}

/**
 * Bag randomizer: every kind in the pool appears once per bag (7 pieces for the
 * tetrominoes). Seeded (mulberry32 PRNG) so games and tests are reproducible, and its
 * state can be saved and restored exactly.
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

  /** The next piece. An empty bag refills with `pool`, so a new pool shows from the next bag. */
  next(pool: readonly Kind[] = TETROMINOES): Kind {
    if (this.bag.length === 0) {
      this.bag = [...pool];
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

  private random(): number {
    const [value, next] = mulberry32(this.a);
    this.a = next;
    return value;
  }
}

/** One mulberry32 step: a float in [0, 1) and the PRNG's next internal word. */
export function mulberry32(a: number): [number, number] {
  const next = (a + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}
