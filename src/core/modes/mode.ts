import type { Kind } from '../pieces.ts';

/**
 * A game mode plugs rule variations into the engine. Classic is the baseline;
 * other modes override only the hooks they change.
 */
export interface Mode {
  readonly id: string;
  readonly name: string;
  /** Milliseconds per gravity step at `level` (1-based). */
  gravityMs(level: number): number;
  /** Points for clearing `lines` rows at once on `level`. */
  scoreForLines(lines: number, level: number): number;
  /** Level for a running total of cleared lines. */
  levelForLines(totalLines: number): number;
  /**
   * The pieces dealt at `level`: a prefix of KINDS, at least the tetrominoes, that only
   * grows with the level (ladder rungs deal the tetrominoes alone; saves are checked
   * against it).
   */
  kindsAt(level: number): readonly Kind[];
}
