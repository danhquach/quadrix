import type { Action } from './gestures.ts';

const KEYS: Readonly<Record<string, Action>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'rotate',
  ArrowDown: 'softDrop',
  ' ': 'hardDrop',
  p: 'pause',
  P: 'pause',
};

/** The action a key (KeyboardEvent.key) triggers, or null. Own keys only, so '__proto__' and friends are not actions. */
export function actionForKey(key: string): Action | null {
  return Object.hasOwn(KEYS, key) ? KEYS[key]! : null;
}
