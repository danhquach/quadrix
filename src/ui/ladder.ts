import { MAX_RUNGS, type Rung } from '../core/ladder.ts';

/** Rungs listed at once; Higher and Lower page by this many. */
export const PAGE = 50;

/** Locked rungs shown above the highest unlocked one. */
export const LOCKED_SHOWN = 3;

export interface RungRow {
  index: number;
  /** current: the highest unlocked rung, the one to climb next. */
  state: 'passed' | 'current' | 'locked';
  /** Best stars so far, 0 if never passed. */
  stars: number;
}

export interface LadderPage {
  /** Highest first, like a ladder. */
  rows: RungRow[];
  /** The top row's rung, after clamping. */
  top: number;
  /** Whether there are rungs above or below this page. */
  higher: boolean;
  lower: boolean;
}

/** The top of the list (and of the page holding the current rung) for `highest` unlocked. */
export function ladderTop(highest: number): number {
  return Math.min(highest + LOCKED_SHOWN, MAX_RUNGS);
}

/**
 * The page of the ladder whose top row is `top` (clamped to the list), for a profile's
 * `stars` string and highest unlocked rung. Only a page is built, so a ladder thousands
 * of rungs tall costs the same as a short one.
 */
export function ladderPage(stars: string, highest: number, top: number): LadderPage {
  const max = ladderTop(highest);
  const t = Number.isSafeInteger(top) ? Math.max(Math.min(PAGE, max), Math.min(max, top)) : max;
  const bottom = Math.max(1, t - PAGE + 1);
  const rows: RungRow[] = [];
  for (let i = t; i >= bottom; i--) {
    const state = i < highest ? 'passed' : i === highest ? 'current' : 'locked';
    rows.push({ index: i, state, stars: Number(stars[i - 1] ?? 0) });
  }
  return { rows, top: t, higher: t < max, lower: bottom > 1 };
}

/** Stars as text: filled then empty, three in all (`n` clamped to 0..3). */
export function starText(n: number): string {
  const k = Number.isInteger(n) ? Math.min(3, Math.max(0, n)) : 0;
  return '★'.repeat(k) + '☆'.repeat(3 - k);
}

export interface ObjectiveView {
  /** Lines cleared toward the goal, e.g. "3 / 4" (capped at the goal). */
  lines: string;
  /** Pieces locked so far. */
  pieces: string;
  three: string;
  two: string;
  /** A star target is lost once more pieces than it allows are locked. */
  threeLost: boolean;
  twoLost: boolean;
}

/** The rung's objective and live tracker, as plain text, for `lines` cleared and `pieces` locked. */
export function objectiveView(
  r: Pick<Rung, 'goalLines' | 'stars'>,
  lines: number,
  pieces: number,
): ObjectiveView {
  return {
    lines: `${Math.min(lines, r.goalLines)} / ${r.goalLines}`,
    pieces: String(pieces),
    three: `★★★ ≤ ${r.stars.three}`,
    two: `★★ ≤ ${r.stars.two}`,
    threeLost: pieces > r.stars.three,
    twoLost: pieces > r.stars.two,
  };
}
