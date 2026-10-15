import type { Mode } from './modes/index.ts';

/** How a locked T piece was twisted in: no spin, a mini spin or a full spin. */
export type Spin = 'none' | 'mini' | 'full';

/** Points per level for a full spin clearing 0..3 lines. */
const SPIN_POINTS = [400, 800, 1200, 1600];
/** Points per level for a mini spin clearing 0..1 lines (more lines count as a full spin). */
const MINI_POINTS = [100, 200];
/** Points per level per combo step (clearing drops in a row after the first). */
const COMBO_POINTS = 50;
/** Points per level for a clear that leaves the board empty. */
const FULL_CLEAR_POINTS = 2000;
/** Multiplier on a quad or spin clear that follows another one. */
const BACK_TO_BACK = 1.5;

const LINE_NAMES = ['', 'single', 'double', 'triple', 'quad'];

/** The chain a lock carries forward to the next one. */
export interface Chain {
  /** Drops in a row that cleared lines (0 after a drop that cleared none). */
  streak: number;
  /** Whether the last clear was a quad or a spin clear. */
  b2b: boolean;
}

/** What one lock scored, and the labels that say why. */
export interface Award extends Chain {
  points: number;
  labels: string[];
}

/** Score a lock that cleared `lines` (0 allowed) on `level`, given the chain before it. */
export function scoreLock(
  mode: Mode,
  level: number,
  lines: number,
  spin: Spin,
  chain: Chain,
  fullClear: boolean,
): Award {
  // A mini spin that clears two or more lines can only be a full spin.
  const kind: Spin = spin === 'mini' && lines >= 2 ? 'full' : spin;
  const labels: string[] = [];
  let points =
    kind === 'full'
      ? SPIN_POINTS[lines]! * level
      : kind === 'mini'
        ? MINI_POINTS[lines]! * level
        : mode.scoreForLines(lines, level);
  const hard = lines > 0 && (lines === 4 || kind !== 'none');
  if (hard && chain.b2b) {
    points = Math.floor(points * BACK_TO_BACK);
    labels.push('Back-to-back');
  }
  if (kind !== 'none') {
    const name = kind === 'mini' ? 'Mini spin' : 'Spin';
    labels.push(lines > 0 ? `${name} ${LINE_NAMES[lines]}` : name);
  } else if (lines === 4) {
    labels.push('Quad');
  }
  const streak = lines > 0 ? chain.streak + 1 : 0;
  if (streak >= 2) {
    points += COMBO_POINTS * (streak - 1) * level;
    labels.push(`Combo ${streak - 1}`);
  }
  if (fullClear) {
    points += FULL_CLEAR_POINTS * level;
    labels.push('Full clear');
  }
  // Only a plain clear breaks back-to-back; a drop that clears nothing keeps it.
  return { points, labels, streak, b2b: lines > 0 ? hard : chain.b2b };
}
