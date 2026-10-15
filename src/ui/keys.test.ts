import { describe, expect, it } from 'vitest';
import { actionForKey, keyAction } from './keys.ts';

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
