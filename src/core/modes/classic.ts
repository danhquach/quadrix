import { PENTOMINOES, TETROMINOES, type Kind } from '../pieces.ts';
import type { Mode } from './mode.ts';

const LINE_POINTS = [0, 100, 300, 500, 800];

/**
 * Gravity at level 1, the floor it eases toward, and how much of the gap each level keeps.
 * Faster than the old linear curve at every level from 2 (players found that too easy).
 */
export const START_GRAVITY_MS = 800;
export const FLOOR_GRAVITY_MS = 50;
const DECAY = 0.74;
/** First level at the floor: every level before it is strictly faster than the last. */
export const FLOOR_LEVEL = 21;

/** Every this many levels (from level 6) two more pentominoes join the bag. */
export const LEVELS_PER_TIER = 5;
const PER_TIER = 2;

/** The pieces dealt at `level`: the tetrominoes, then pentominoes in pairs at 6, 11, 16 … 46. */
export function classicKinds(level: number): readonly Kind[] {
  const tiers = Math.max(0, Math.floor((level - 1) / LEVELS_PER_TIER));
  return [...TETROMINOES, ...PENTOMINOES.slice(0, tiers * PER_TIER)];
}

export const classic: Mode = {
  id: 'classic',
  name: 'Classic',
  gravityMs: (level) =>
    level >= FLOOR_LEVEL
      ? FLOOR_GRAVITY_MS
      : Math.round(FLOOR_GRAVITY_MS + (START_GRAVITY_MS - FLOOR_GRAVITY_MS) * DECAY ** (level - 1)),
  scoreForLines: (lines, level) => (LINE_POINTS[lines] ?? 0) * level,
  levelForLines: (total) => Math.floor(total / 10) + 1,
  kindsAt: classicKinds,
};
