import { EFFECTS_LEVELS, type EffectsLevel } from './effects.ts';
import { ACTIONS, type Action } from './gestures.ts';
import { DEFAULT_KEYS, MUTE_KEY, isBindable, keyLabel, normalKey, type KeyMap } from './keys.ts';
import { REPEAT_TIMING, type RepeatTiming } from './repeat.ts';
import type { SaveStorage } from './save.ts';
import { isPieceStyle, type PieceStyle } from './skin.ts';

export const SETTINGS_KEY = 'quadrix.settings';

export interface Settings {
  readonly ghost: boolean;
  /** Ghost piece opacity in percent: 10–60 in steps of 10. */
  readonly ghostOpacity: number;
  /** Held-key auto-repeat: delay before the first repeat, then the interval (0 is instant). */
  readonly delayMs: number;
  readonly intervalMs: number;
  readonly keys: KeyMap;
  /** Every sound off (the HUD's Mute button and M). Muted by default; a saved preference wins. */
  readonly muted: boolean;
  /** Effects and music volume, 0–100. */
  readonly sfxVolume: number;
  readonly musicVolume: number;
  /** How much animation plays over the board. */
  readonly effects: EffectsLevel;
  /** How blocks are drawn (the Styles tab). */
  readonly pieceStyle: PieceStyle;
}

export const DELAY_RANGE = { min: 50, max: 300 } as const;
export const INTERVAL_RANGE = { min: 0, max: 100 } as const;
export const VOLUME_RANGE = { min: 0, max: 100 } as const;
export const GHOST_OPACITY_RANGE = { min: 10, max: 60 } as const;
export const GHOST_OPACITY_STEP = 10;

export const DEFAULT_SETTINGS: Settings = {
  ghost: true,
  ghostOpacity: 20,
  delayMs: REPEAT_TIMING.delayMs,
  intervalMs: REPEAT_TIMING.intervalMs,
  keys: DEFAULT_KEYS,
  muted: true,
  sfxVolume: 70,
  musicVolume: 50,
  effects: 'full',
  pieceStyle: 'bevel',
};

/** The defaults here: Effects start Reduced when the system asks for reduced motion. */
export function defaultSettings(reducedMotion: boolean): Settings {
  return reducedMotion ? { ...DEFAULT_SETTINGS, effects: 'reduced' } : DEFAULT_SETTINGS;
}

/** Names of the bindable actions, in the order Settings lists them. Plain text. */
export const ACTION_NAMES: Readonly<Record<Action, string>> = {
  left: 'Move left',
  right: 'Move right',
  rotate: 'Rotate',
  softDrop: 'Soft drop',
  hardDrop: 'Hard drop',
  pause: 'Pause',
};

/** Far more than a full settings record needs; anything longer is not ours. */
const MAX_TEXT = 1024;

/** A whole number within `range`, or null. */
export function inRange(value: unknown, range: { min: number; max: number }): number | null {
  return Number.isSafeInteger(value) &&
    (value as number) >= range.min &&
    (value as number) <= range.max
    ? (value as number)
    : null;
}

/** A ghost opacity on the 10% steps, or null. */
export function ghostOpacityIn(value: unknown): number | null {
  const v = inRange(value, GHOST_OPACITY_RANGE);
  return v !== null && v % GHOST_OPACITY_STEP === 0 ? v : null;
}

/** The value at an own property of `o`, so inherited names ('__proto__') read as missing. */
function own(o: object, key: string): unknown {
  return Object.hasOwn(o, key) ? (o as Record<string, unknown>)[key] : undefined;
}

/**
 * Bindings from stored data. Each valid, bindable key is kept and a missing or invalid one
 * takes its default; if that leaves two actions on one key, every binding is the default.
 */
function parseKeys(raw: unknown): KeyMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_KEYS;
  const keys = {} as Record<Action, string>;
  for (const action of ACTIONS) {
    const key = own(raw, action);
    keys[action] =
      typeof key === 'string' && key === normalKey(key) && isBindable(key)
        ? key
        : DEFAULT_KEYS[action];
  }
  return new Set(Object.values(keys)).size === ACTIONS.length ? keys : DEFAULT_KEYS;
}

/**
 * Settings from stored text. Each value is checked against its range, the bindable keys
 * or its options; anything missing or invalid takes its default (see defaultSettings).
 * Never throws: unreadable, oversized or hostile text is all defaults.
 */
export function parseSettings(text: string | null, reducedMotion = false): Settings {
  const defaults = defaultSettings(reducedMotion);
  if (typeof text !== 'string' || text.length > MAX_TEXT) return defaults;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaults;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaults;
  const ghost = own(raw, 'ghost');
  const muted = own(raw, 'muted');
  const effects = own(raw, 'effects');
  const pieceStyle = own(raw, 'pieceStyle');
  return {
    ghost: typeof ghost === 'boolean' ? ghost : DEFAULT_SETTINGS.ghost,
    ghostOpacity: ghostOpacityIn(own(raw, 'ghostOpacity')) ?? DEFAULT_SETTINGS.ghostOpacity,
    delayMs: inRange(own(raw, 'delayMs'), DELAY_RANGE) ?? DEFAULT_SETTINGS.delayMs,
    intervalMs: inRange(own(raw, 'intervalMs'), INTERVAL_RANGE) ?? DEFAULT_SETTINGS.intervalMs,
    keys: parseKeys(own(raw, 'keys')),
    muted: typeof muted === 'boolean' ? muted : DEFAULT_SETTINGS.muted,
    sfxVolume: inRange(own(raw, 'sfxVolume'), VOLUME_RANGE) ?? DEFAULT_SETTINGS.sfxVolume,
    musicVolume: inRange(own(raw, 'musicVolume'), VOLUME_RANGE) ?? DEFAULT_SETTINGS.musicVolume,
    effects: isEffectsLevel(effects) ? effects : defaults.effects,
    pieceStyle: isPieceStyle(pieceStyle) ? pieceStyle : DEFAULT_SETTINGS.pieceStyle,
  };
}

export function isEffectsLevel(value: unknown): value is EffectsLevel {
  return EFFECTS_LEVELS.includes(value as EffectsLevel);
}

/** The stored settings, or the defaults. Storage that is missing or throws reads as defaults. */
export function loadSettings(storage: () => SaveStorage | null, reducedMotion = false): Settings {
  try {
    return parseSettings(storage()?.getItem(SETTINGS_KEY) ?? null, reducedMotion);
  } catch {
    return defaultSettings(reducedMotion);
  }
}

/** Store `s`. Never throws: without storage the settings last until a reload. */
export function writeSettings(storage: () => SaveStorage | null, s: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Full or unavailable storage.
  }
}

/** The repeat timing `s` sets; soft drop keeps its own pace. */
export function repeatTiming(s: Settings): RepeatTiming {
  return { ...REPEAT_TIMING, delayMs: s.delayMs, intervalMs: s.intervalMs };
}

/**
 * Bind `key` (a KeyboardEvent.key) to `action`: the new settings, or why it can't be
 * bound. A key already bound to another action is refused, never swapped.
 */
export function bindKey(
  s: Settings,
  action: Action,
  key: string,
): { settings: Settings } | { error: string } {
  const k = normalKey(key);
  if (k === MUTE_KEY) return { error: "M turns the sound on and off, so it can't be bound." };
  if (!isBindable(k)) return { error: "That key can't be used. Try a letter, number or arrow." };
  const taken = ACTIONS.find((a) => a !== action && s.keys[a] === k);
  if (taken) return { error: `${keyLabel(k)} is already used for ${ACTION_NAMES[taken]}.` };
  return { settings: { ...s, keys: { ...s.keys, [action]: k } } };
}
