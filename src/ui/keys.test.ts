import { describe, expect, it } from 'vitest';
import { actionForKey } from './keys.ts';

describe('actionForKey', () => {
  it('maps the control keys', () => {
    expect(actionForKey('ArrowLeft')).toBe('left');
    expect(actionForKey('ArrowRight')).toBe('right');
    expect(actionForKey('ArrowUp')).toBe('rotate');
    expect(actionForKey('ArrowDown')).toBe('softDrop');
    expect(actionForKey(' ')).toBe('hardDrop');
    expect(actionForKey('p')).toBe('pause');
    expect(actionForKey('P')).toBe('pause');
  });

  it('ignores every other key, including inherited property names', () => {
    for (const key of [
      'a',
      'Enter',
      'Tab',
      'Escape',
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
