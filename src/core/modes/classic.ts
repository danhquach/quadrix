import type { Mode } from './mode.ts';

const LINE_POINTS = [0, 100, 300, 500, 800];

export const classic: Mode = {
  id: 'classic',
  name: 'Classic',
  gravityMs: (level) => Math.max(80, 800 - (level - 1) * 70),
  scoreForLines: (lines, level) => (LINE_POINTS[lines] ?? 0) * level,
  levelForLines: (total) => Math.floor(total / 10) + 1,
};
