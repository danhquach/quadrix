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

/** Deterministic PRNG (mulberry32) so games and tests are reproducible from a seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 7-bag randomizer: every kind appears once per 7 pieces. */
export function makeBag(rng: () => number): () => Kind {
  let bag: Kind[] = [];
  return () => {
    if (bag.length === 0) {
      bag = [...KINDS];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
    }
    return bag.pop()!;
  };
}
