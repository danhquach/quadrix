import type { Kind } from './pieces.ts';

/** A board cell as [x, y]. */
export type Cell = readonly [number, number];

/**
 * Something that happened in a game, with what an effect needs to show it. The game
 * only reports these; it knows nothing about who listens. One action reports its
 * events in this order: hardDrop, lock, clear, award, levelUp, newPieces,
 * over.
 */
export type GameEvent =
  /**
   * The piece fell `distance` rows straight down, from row `fromY` to its landing in
   * `cells`. Before a lock-out some of those cells are above the board (y < 0).
   */
  | {
      readonly type: 'hardDrop';
      readonly kind: Kind;
      readonly fromY: number;
      readonly distance: number;
      readonly cells: readonly Cell[];
    }
  /** The piece was fixed to the board in `cells`. A lock-out reports only `over`. */
  | { readonly type: 'lock'; readonly kind: Kind; readonly cells: readonly Cell[] }
  /** Rows cleared, top to bottom as they stood before clearing, with their cells' colours. */
  | {
      readonly type: 'clear';
      readonly rows: readonly number[];
      readonly colors: readonly (readonly number[])[];
    }
  /**
   * What the lock scored on `level` and why ("Quad", "Combo 2"); only when it scored
   * anything. `combo` is the combo count (0 for none); `fullClear` that it emptied the board.
   */
  | {
      readonly type: 'award';
      readonly points: number;
      readonly labels: readonly string[];
      readonly level: number;
      readonly combo: number;
      readonly fullClear: boolean;
    }
  | { readonly type: 'levelUp'; readonly from: number; readonly level: number }
  /** The level up added `kinds` to the pieces dealt; they arrive from the next bag. */
  | { readonly type: 'newPieces'; readonly kinds: readonly Kind[] }
  | { readonly type: 'over' };

/** Events kept for the reader at most; past this the oldest go. A frame makes a handful. */
export const MAX_EVENTS = 64;
