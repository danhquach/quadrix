import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYS,
  actionForKey,
  buttonRoute,
  isBindable,
  isMuteKey,
  keyAction,
  keyLabel,
  normalKey,
} from './keys.ts';

describe('actionForKey', () => {
  it('maps the control keys', () => {
    expect(actionForKey('ArrowLeft')).toBe('left');
    expect(actionForKey('ArrowRight')).toBe('right');
    expect(actionForKey('ArrowUp')).toBe('rotate');
    expect(actionForKey('ArrowDown')).toBe('softDrop');
    expect(actionForKey(' ')).toBe('hardDrop');
    expect(actionForKey('p')).toBe('pause');
    expect(actionForKey('P')).toBe('pause');
    expect(actionForKey('Escape')).toBe('pause');
  });

  it('ignores every other key, including inherited property names', () => {
    for (const key of [
      'a',
      'Enter',
      'Tab',
      'Esc',
      '',
      'Spacebar',
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
    ]) {
      expect(actionForKey(key)).toBeNull();
    }
  });
});

describe('keyAction', () => {
  it('acts on every game key while running', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p', 'Escape']) {
      expect(keyAction(key, 'running', false)).toEqual({
        action: actionForKey(key),
        preventDefault: true,
      });
    }
  });

  it('ignores the computer’s auto-repeat for every move, but still swallows it', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']) {
      expect(keyAction(key, 'running', true)).toEqual({ action: null, preventDefault: true });
    }
  });

  it('ignores every move while paused or counting down', () => {
    for (const phase of ['paused', 'countdown'] as const) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ']) {
        expect(keyAction(key, phase, false).action).toBeNull();
      }
    }
  });

  it('lets Space through to the menu while paused, but still swallows arrows', () => {
    expect(keyAction(' ', 'paused', false).preventDefault).toBe(false);
    expect(keyAction('ArrowDown', 'paused', false).preventDefault).toBe(true);
  });

  it('toggles pause from any phase, but never on auto-repeat', () => {
    for (const phase of ['running', 'paused', 'countdown'] as const) {
      expect(keyAction('Escape', phase, false).action).toBe('pause');
      expect(keyAction('p', phase, true)).toEqual({ action: null, preventDefault: true });
    }
  });

  it('leaves browser shortcuts alone (Cmd+P, Ctrl+Arrow, Alt+Space)', () => {
    for (const key of ['p', 'P', 'Escape', 'ArrowLeft', ' ']) {
      for (const phase of ['running', 'paused'] as const) {
        expect(keyAction(key, phase, false, true)).toEqual({ action: null, preventDefault: false });
      }
    }
  });

  it('leaves other keys alone', () => {
    expect(keyAction('Enter', 'paused', false)).toEqual({ action: null, preventDefault: false });
    expect(keyAction('__proto__', 'running', false)).toEqual({
      action: null,
      preventDefault: false,
    });
  });
});

describe('buttonRoute', () => {
  it('acts on every button with Settings closed', () => {
    for (const a of ['left', 'right', 'rotate', 'softDrop', 'hardDrop', 'pause'] as const)
      expect(buttonRoute(a, false)).toBe('act');
  });

  it('closes Settings first for Resume, so the countdown starts', () => {
    expect(buttonRoute('pause', true)).toBe('close-then-act');
  });

  it('ignores the pad under Settings, so the game stays paused', () => {
    for (const a of ['left', 'right', 'rotate', 'softDrop', 'hardDrop'] as const)
      expect(buttonRoute(a, true)).toBe('ignore');
  });
});

describe('rebound keys', () => {
  const wasd = { ...DEFAULT_KEYS, left: 'a', right: 'd', rotate: 'w', softDrop: 's' };

  it('maps the bound keys, in either case, and drops the old ones', () => {
    expect(actionForKey('a', wasd)).toBe('left');
    expect(actionForKey('A', wasd)).toBe('left');
    expect(actionForKey('w', wasd)).toBe('rotate');
    expect(actionForKey('ArrowLeft', wasd)).toBeNull();
    expect(actionForKey('ArrowUp', wasd)).toBeNull();
  });

  it('keeps Esc as a pause key whatever pause is bound to', () => {
    const k = { ...DEFAULT_KEYS, pause: 'q' };
    expect(actionForKey('Escape', k)).toBe('pause');
    expect(actionForKey('q', k)).toBe('pause');
    expect(actionForKey('p', k)).toBeNull();
  });

  it('acts on a rebound key while running', () => {
    expect(keyAction('d', 'running', false, false, wasd)).toEqual({
      action: 'right',
      preventDefault: true,
    });
  });

  it('lets Space through while paused even when it is bound to a move', () => {
    const k = { ...DEFAULT_KEYS, hardDrop: 'x', rotate: ' ' };
    expect(keyAction(' ', 'paused', false, false, k)).toEqual({
      action: null,
      preventDefault: false,
    });
    expect(keyAction('x', 'paused', false, false, k).preventDefault).toBe(true);
  });
});

describe('isMuteKey', () => {
  it('is M in either case, without Ctrl, Cmd or Alt', () => {
    expect(isMuteKey('m', false)).toBe(true);
    expect(isMuteKey('M', false)).toBe(true);
    expect(isMuteKey('m', true)).toBe(false);
    for (const key of ['n', 'Meta', 'ArrowDown', 'Escape', 'ｍ', 'м', '__proto__', '']) {
      expect(isMuteKey(key, false)).toBe(false);
    }
  });

  it('is no action, whatever is bound', () => {
    expect(actionForKey('m')).toBeNull();
  });
});

describe('isBindable, normalKey and keyLabel', () => {
  it('allows arrows, Space, letters, digits and plain punctuation', () => {
    for (const key of ['ArrowLeft', 'ArrowDown', ' ', 'a', 'z', '0', '9', ',', '.', '/', ';']) {
      expect(isBindable(key)).toBe(true);
    }
  });

  it('refuses keys with their own job, upper case, and anything else', () => {
    for (const key of [
      'Escape',
      '?',
      'm',
      'Tab',
      'Enter',
      'Shift',
      'F1',
      'A',
      'ab',
      '',
      '<',
      '\u200b',
      'а',
    ]) {
      expect(isBindable(key)).toBe(false);
    }
  });

  it('stores letters lower case and leaves named keys alone', () => {
    expect(normalKey('Q')).toBe('q');
    // The Kelvin sign lowercases to ASCII k: only the ASCII key is ever stored or shown.
    expect(normalKey('\u212a')).toBe('k');
    expect(isBindable(normalKey('\u0130'))).toBe(false);
    expect(normalKey('ArrowUp')).toBe('ArrowUp');
  });

  it('labels keys as plain text', () => {
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('p')).toBe('P');
    expect(keyLabel(';')).toBe(';');
  });
});
