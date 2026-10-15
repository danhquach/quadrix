import { classic } from './classic.ts';
import { override } from './override.ts';
import type { Mode } from './mode.ts';

export type { Mode } from './mode.ts';

export const MODES: Record<string, Mode> = { classic, override };
