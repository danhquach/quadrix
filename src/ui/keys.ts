import type { Phase } from '../core/session.ts';
import type { Action } from './gestures.ts';

/** The KeyboardEvent.key bound to each action. Letters are stored lower case. */
export type KeyMap = Readonly<Record<Action, string>>;

export const DEFAULT_KEYS: KeyMap = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  rotate: 'ArrowUp',
  softDrop: 'ArrowDown',
  hardDrop: ' ',
  pause: 'p',
};

/** Esc always pauses, besides the bound key, and can't be bound: it also closes Settings. */
const PAUSE_ALWAYS = 'Escape';

/** M mutes and unmutes at any time, so it can't be bound. */
export const MUTE_KEY = 'm';

const NAMED: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ' ': 'Space',
};

/**
 * Whether a key may be bound: arrows, Space, a–z, 0–9 and plain punctuation. Esc, `?`,
 * M, Tab, Enter and the rest keep their own jobs. Pass a key through normalKey first.
 */
export function isBindable(key: string): boolean {
  if (key === MUTE_KEY) return false;
  return Object.hasOwn(NAMED, key) || /^[a-z0-9`\-=[\]\\;',./]$/.test(key);
}

/** Whether a keydown mutes or unmutes: M (either case), without Ctrl, Cmd or Alt. */
export function isMuteKey(key: string, modified: boolean): boolean {
  return !modified && key.length === 1 && normalKey(key) === MUTE_KEY;
}

/** A key as bindings store it: one letter in lower case (Shift or Caps Lock still match). */
export function normalKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** How a bindable key is shown: ←, Space, P. Plain text. */
export function keyLabel(key: string): string {
  return Object.hasOwn(NAMED, key) ? NAMED[key]! : key.toUpperCase();
}

/** The action a key (KeyboardEvent.key) triggers, or null. Own keys only, so '__proto__' and friends are not actions. */
export function actionForKey(key: string, keys: KeyMap = DEFAULT_KEYS): Action | null {
  if (key === PAUSE_ALWAYS) return 'pause';
  const k = normalKey(key);
  for (const action of Object.keys(keys) as Action[]) {
    if (Object.hasOwn(keys, action) && keys[action] === k) return action;
  }
  return null;
}

/**
 * What a keydown does in a game that is in play: the action to apply (or null) and
 * whether to swallow the key. Keys held with Ctrl, Cmd or Alt are the browser's
 * (Cmd+P prints), so they are left alone. The computer's auto-repeat never acts: held
 * moves repeat on the game's own timing (repeat.ts). While paused only the pause keys act.
 * Space is left to the browser then, whatever it is bound to, so it presses the focused
 * menu button; other game keys are still swallowed so arrows can't scroll the page.
 */
export function keyAction(
  key: string,
  phase: Phase,
  repeat: boolean,
  modified = false,
  keys: KeyMap = DEFAULT_KEYS,
): { action: Action | null; preventDefault: boolean } {
  const action = actionForKey(key, keys);
  if (!action || modified) return { action: null, preventDefault: false };
  if (action === 'pause') return { action: repeat ? null : action, preventDefault: true };
  if (phase === 'running') return { action: repeat ? null : action, preventDefault: true };
  return { action: null, preventDefault: key !== ' ' };
}
