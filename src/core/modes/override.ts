import type { Mode } from './mode.ts';
import { classic } from './classic.ts';

/**
 * Override mode. Rules are not defined yet: it starts as Classic and replaces
 * hooks as the design lands. Add new hooks to `Mode` when a rule needs one.
 */
export const override: Mode = {
  ...classic,
  id: 'override',
  name: 'Override',
};
