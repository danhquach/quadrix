import { describe, expect, it } from 'vitest';
import { ACTIONS } from './gestures.ts';
import { DEFAULT_KEYS, actionForKey, isBindable, normalKey } from './keys.ts';
import { REPEAT_TIMING } from './repeat.ts';
import type { SaveStorage } from './save.ts';
import {
  ACTION_NAMES,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  bindKey,
  loadSettings,
  parseSettings,
  repeatTiming,
  writeSettings,
  type Settings,
} from './settings.ts';

function memory(initial: Record<string, string> = {}): SaveStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: SaveStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const custom: Settings = {
  ghost: false,
  delayMs: 120,
  intervalMs: 0,
  keys: { left: 'a', right: 'd', rotate: 'w', softDrop: 's', hardDrop: ' ', pause: 'p' },
};

describe('parseSettings', () => {
  it('reads back what was written', () => {
    expect(parseSettings(JSON.stringify(custom))).toEqual(custom);
    expect(parseSettings(JSON.stringify(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the edges of each range and refuses one past them', () => {
    const at = (delayMs: number, intervalMs: number) =>
      parseSettings(JSON.stringify({ delayMs, intervalMs }));
    expect(at(50, 0)).toMatchObject({ delayMs: 50, intervalMs: 0 });
    expect(at(300, 100)).toMatchObject({ delayMs: 300, intervalMs: 100 });
    expect(at(49, -1)).toMatchObject({
      delayMs: DEFAULT_SETTINGS.delayMs,
      intervalMs: DEFAULT_SETTINGS.intervalMs,
    });
    expect(at(301, 101)).toMatchObject({
      delayMs: DEFAULT_SETTINGS.delayMs,
      intervalMs: DEFAULT_SETTINGS.intervalMs,
    });
  });

  it('loads the defaults for missing, corrupt or oversized text, without throwing', () => {
    for (const text of [
      null,
      '',
      '{',
      'null',
      'true',
      '42',
      '"settings"',
      '[]',
      '[1,2,3]',
      '{"ghost":',
      `{"ghost":false,"pad":"${'x'.repeat(2000)}"}`,
      '\u0000\u202e{}',
    ]) {
      expect(parseSettings(text)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('replaces each invalid value with its default and keeps the valid ones', () => {
    const s = parseSettings(
      JSON.stringify({ ghost: 'no', delayMs: 100, intervalMs: '20', keys: custom.keys }),
    );
    expect(s).toEqual({ ...custom, ghost: true, delayMs: 100, intervalMs: 33 });
  });

  it('refuses numbers that are not whole, finite numbers', () => {
    for (const v of [100.5, null, true, [100], { v: 100 }, '100', -0.5]) {
      const text = `{"delayMs":${JSON.stringify(v) ?? 'null'}}`;
      expect(parseSettings(text).delayMs).toBe(DEFAULT_SETTINGS.delayMs);
    }
    // 1e400 is Infinity once parsed; JSON can't write NaN at all.
    expect(parseSettings('{"delayMs":1e400}').delayMs).toBe(DEFAULT_SETTINGS.delayMs);
    expect(parseSettings('{"delayMs":NaN}')).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses keys outside the bindable list, one by one', () => {
    for (const key of [
      'Escape',
      '?',
      'Tab',
      'Enter',
      'Shift',
      'F5',
      'A',
      'ab',
      '',
      '<',
      '__proto__',
      '\u202e',
      '\u200b',
      'а', // Cyrillic, a look-alike of a
      '<img src=x onerror=alert(1)>',
      'x'.repeat(500),
    ]) {
      const s = parseSettings(JSON.stringify({ keys: { ...custom.keys, left: key } }));
      expect(s.keys).toEqual({ ...custom.keys, left: DEFAULT_KEYS.left });
    }
    for (const key of [1, null, true, ['a'], { k: 'a' }]) {
      const s = parseSettings(JSON.stringify({ keys: { ...custom.keys, left: key } }));
      expect(s.keys.left).toBe(DEFAULT_KEYS.left);
    }
  });

  it('loads the default keys when two actions would share one', () => {
    const dupes = { ...custom.keys, right: 'a' };
    expect(parseSettings(JSON.stringify({ keys: dupes })).keys).toEqual(DEFAULT_KEYS);
    // A missing key's default may clash with a stored one: still no shared key.
    const clash = { left: 'ArrowRight', rotate: 'w' };
    expect(parseSettings(JSON.stringify({ keys: clash })).keys).toEqual(DEFAULT_KEYS);
  });

  it('ignores inherited and extra fields, and never pollutes Object.prototype', () => {
    const text =
      '{"__proto__":{"ghost":false,"polluted":1},"constructor":{"prototype":{"polluted":1}},' +
      '"keys":{"__proto__":{"left":"a"},"extra":"q"},"extra":1}';
    const s = parseSettings(text);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(s.keys).sort()).toEqual([...ACTIONS].sort());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
  });

  it('loads defaults for keys that are not an object', () => {
    for (const keys of [null, 'a', 1, ['a', 'd', 'w', 's', ' ', 'p']]) {
      expect(parseSettings(JSON.stringify({ keys })).keys).toEqual(DEFAULT_KEYS);
    }
  });

  it('every default key is one the loader accepts', () => {
    for (const key of Object.values(DEFAULT_KEYS)) {
      expect(isBindable(key)).toBe(true);
      expect(normalKey(key)).toBe(key);
    }
  });

  it('every action has a name and a distinct default key', () => {
    for (const a of ACTIONS) expect(ACTION_NAMES[a]).toMatch(/^[A-Za-z ]+$/);
    expect(new Set(Object.values(DEFAULT_KEYS)).size).toBe(ACTIONS.length);
  });
});

describe('loadSettings and writeSettings', () => {
  it('round-trips through storage', () => {
    const store = memory();
    writeSettings(() => store, custom);
    expect(loadSettings(() => store)).toEqual(custom);
  });

  it('loads the defaults with no storage, blocked storage or a hostile record', () => {
    expect(loadSettings(() => null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(() => throwing)).toEqual(DEFAULT_SETTINGS);
    expect(
      loadSettings(() => {
        throw new Error('SecurityError');
      }),
    ).toEqual(DEFAULT_SETTINGS);
    const store = memory({ [SETTINGS_KEY]: '{"keys":{"left":"<script>"}}' + ' '.repeat(5000) });
    expect(loadSettings(() => store)).toEqual(DEFAULT_SETTINGS);
  });

  it('never throws when storage is full or missing', () => {
    expect(() => writeSettings(() => throwing, custom)).not.toThrow();
    expect(() => writeSettings(() => null, custom)).not.toThrow();
  });
});

describe('repeatTiming', () => {
  it('takes delay and interval from settings and keeps the soft-drop pace', () => {
    expect(repeatTiming(custom)).toEqual({
      delayMs: 120,
      intervalMs: 0,
      softDropMs: REPEAT_TIMING.softDropMs,
    });
  });
});

describe('bindKey', () => {
  it('binds a free key, stored lower case, and the key then does that action', () => {
    const r = bindKey(DEFAULT_SETTINGS, 'left', 'A');
    expect(r).toEqual({ settings: { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS, left: 'a' } } });
    if (!('settings' in r)) throw new Error('refused');
    expect(actionForKey('a', r.settings.keys)).toBe('left');
    expect(actionForKey('A', r.settings.keys)).toBe('left');
    expect(actionForKey('ArrowLeft', r.settings.keys)).toBeNull();
  });

  it('refuses a key bound to another action, with a clear message', () => {
    expect(bindKey(DEFAULT_SETTINGS, 'left', 'ArrowRight')).toEqual({
      error: '→ is already used for Move right.',
    });
    expect(bindKey(DEFAULT_SETTINGS, 'rotate', ' ')).toEqual({
      error: 'Space is already used for Hard drop.',
    });
    expect(bindKey(DEFAULT_SETTINGS, 'left', 'P')).toEqual({
      error: 'P is already used for Pause.',
    });
  });

  it('allows binding an action to the key it already has', () => {
    expect(bindKey(DEFAULT_SETTINGS, 'left', 'ArrowLeft')).toEqual({ settings: DEFAULT_SETTINGS });
  });

  it('refuses keys that keep their own job or are not on the list, without echoing them', () => {
    for (const key of ['Escape', '?', 'Tab', 'Enter', 'Shift', 'F1', '<b>', '\u202e', 'é']) {
      const r = bindKey(DEFAULT_SETTINGS, 'left', key);
      expect(r).toEqual({ error: "That key can't be used. Try a letter, number or arrow." });
    }
  });
});
