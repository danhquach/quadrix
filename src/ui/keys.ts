import type { Phase } from '../core/session.ts';
import type { Action } from './gestures.ts';

const KEYS: Readonly<Record<string, Action>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'rotate',
  ArrowDown: 'softDrop',
  ' ': 'hardDrop',
  p: 'pause',
  P: 'pause',
  Escape: 'pause',
};

/** The action a key (KeyboardEvent.key) triggers, or null. Own keys only, so '__proto__' and friends are not actions. */
export function actionForKey(key: string): Action | null {
  return Object.hasOwn(KEYS, key) ? KEYS[key]! : null;
}

/**
 * What a keydown does in a game that is in play: the action to apply (or null) and
 * whether to swallow the key. Keys held with Ctrl, Cmd or Alt are the browser's
 * (Cmd+P prints), so they are left alone. While paused only the pause keys act, and auto-repeat
 * never toggles pause. Space is left to the browser then, so it presses the focused
 * menu button; other game keys are still swallowed so arrows can't scroll the page.
 */
export function keyAction(
  key: string,
  phase: Phase,
  repeat: boolean,
  modified = false,
): { action: Action | null; preventDefault: boolean } {
  const action = actionForKey(key);
  if (!action || modified) return { action: null, preventDefault: false };
  if (action === 'pause') return { action: repeat ? null : action, preventDefault: true };
  if (phase === 'running') return { action, preventDefault: true };
  return { action: null, preventDefault: action !== 'hardDrop' };
}
