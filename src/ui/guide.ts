import type { Action } from './gestures.ts';

/** The parts of Web Storage the guide uses; `localStorage` in the app, a stub in tests. */
export type GuideStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const GUIDE_KEY = 'quadrix.guide';
const CLOSED = 'closed';

/** One line of the controls guide: the keys shown, the KeyboardEvent.key each one sends, and what they do. */
export interface GuideRow {
  readonly keys: readonly { readonly label: string; readonly key: string }[];
  readonly action: Action | 'guide';
  readonly text: string;
}

/** The keyboard controls, in the order the guide lists them. Shown as text only. */
export const GUIDE_ROWS: readonly GuideRow[] = [
  {
    keys: [
      { label: '←', key: 'ArrowLeft' },
      { label: '→', key: 'ArrowRight' },
    ],
    action: 'left',
    text: 'Move',
  },
  { keys: [{ label: '↑', key: 'ArrowUp' }], action: 'rotate', text: 'Rotate' },
  { keys: [{ label: '↓', key: 'ArrowDown' }], action: 'softDrop', text: 'Soft drop' },
  { keys: [{ label: 'Space', key: ' ' }], action: 'hardDrop', text: 'Hard drop' },
  {
    keys: [
      { label: 'P', key: 'p' },
      { label: 'Esc', key: 'Escape' },
    ],
    action: 'pause',
    text: 'Pause',
  },
  { keys: [{ label: '?', key: '?' }], action: 'guide', text: 'Show or hide controls' },
];

/** Whether a keydown toggles the guide: `?` (Shift is part of typing it), without Ctrl, Cmd or Alt. */
export function isGuideKey(key: string, modified: boolean): boolean {
  return key === '?' && !modified;
}

/**
 * Whether the player closed the guide before. Only the exact stored marker counts:
 * missing, unreadable or unexpected values read as not closed, so the guide shows.
 */
export function loadGuideClosed(storage: () => GuideStorage | null): boolean {
  try {
    return storage()?.getItem(GUIDE_KEY) === CLOSED;
  } catch {
    return false;
  }
}

/** Remember that the guide was closed. Never throws: without storage it just shows again next time. */
export function writeGuideClosed(storage: () => GuideStorage | null): void {
  try {
    storage()?.setItem(GUIDE_KEY, CLOSED);
  } catch {
    // Full or unavailable storage.
  }
}

/**
 * When the controls guide shows. It opens on a Start until the player has closed it
 * once, and only shows to a player with a keyboard: a fine pointer suggests one, and
 * any key press proves it (an iPad with a keyboard but no trackpad).
 */
export class Guide {
  private open = false;
  private closed: boolean;
  private keyboard: boolean;

  /** `closed`: the player closed it before. `keyboard`: a keyboard is likely (fine pointer). */
  constructor(closed: boolean, keyboard: boolean) {
    this.closed = closed;
    this.keyboard = keyboard;
  }

  get visible(): boolean {
    return this.open && this.keyboard;
  }

  /** Whether the Controls link shows: to keyboard players only, like the guide. */
  get linkVisible(): boolean {
    return this.keyboard;
  }

  /** A game started. */
  start(): void {
    if (!this.closed) this.open = true;
  }

  /** The player has a keyboard after all. */
  keyboardSeen(): void {
    this.keyboard = true;
  }

  /** `?` or the Controls link: open it, or close it. Returns true when it closed, to be remembered. */
  toggle(): boolean {
    this.keyboard = true;
    if (this.visible) {
      this.close();
      return true;
    }
    this.open = true;
    return false;
  }

  /** Close it; later Starts leave it closed. */
  close(): void {
    this.open = false;
    this.closed = true;
  }
}
