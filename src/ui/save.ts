import type { Game } from '../core/game.ts';
import { fromSnapshot, toSnapshot } from '../core/snapshot.ts';

/** The parts of Web Storage the save uses; `localStorage` in the app, a stub in tests. */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const SAVE_KEY = 'quadrix.save';

/**
 * The unfinished game saved in `storage`, or null. An invalid save is removed, as is a
 * ladder rung above `highest`, the highest the player has unlocked: a locked rung can't
 * be started, so neither can its save. Storage that is missing or throws (private mode,
 * blocked site data) reads as no save.
 */
export function loadSave(storage: () => SaveStorage | null, highest: number): Game | null {
  try {
    const store = storage();
    const text = store?.getItem(SAVE_KEY);
    if (text == null) return null;
    const game = fromSnapshot(text);
    if (game && resumable(game, highest)) return game;
    store!.removeItem(SAVE_KEY);
    return null;
  } catch {
    return null;
  }
}

/** Whether `game` may be played with rungs up to `highest` unlocked. */
export function resumable(game: Game, highest: number): boolean {
  return game.rung === null || game.rung <= highest;
}

/** Save `game`, or clear the save once it is over. Never throws: play goes on without it. */
export function writeSave(storage: () => SaveStorage | null, game: Game): void {
  if (game.state.over) {
    clearSave(storage);
    return;
  }
  try {
    storage()?.setItem(SAVE_KEY, toSnapshot(game));
  } catch {
    // Full or unavailable storage: the game just won't survive a reload.
  }
}

export function clearSave(storage: () => SaveStorage | null): void {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
