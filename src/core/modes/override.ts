import { TETROMINOES } from '../pieces.ts';
import type { Mode } from './mode.ts';
import { classic } from './classic.ts';

/**
 * Override mode. Rules are not defined yet: it starts as Classic and replaces
 * hooks as the design lands. Add new hooks to `Mode` when a rule needs one. It keeps
 * Classic's original speed and the tetrominoes only (QX-033 changed Classic's).
 */
export const override: Mode = {
  ...classic,
  id: 'override',
  name: 'Override',
  gravityMs: (level) => Math.max(80, 800 - (level - 1) * 70),
  kindsAt: () => TETROMINOES,
};
