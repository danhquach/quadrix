import { describe, expect, it } from 'vitest';
import { Tween, easeIn, easeInOut, easeOut, linear } from './tween.ts';

describe('easing', () => {
  it.each([
    ['linear', linear],
    ['easeOut', easeOut],
    ['easeIn', easeIn],
    ['easeInOut', easeInOut],
  ])('%s runs 0 to 1 without going back', (_, ease) => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const v = ease(i / 100);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('easeOut starts fast, easeIn starts slow', () => {
    expect(easeOut(0.25)).toBeGreaterThan(0.25);
    expect(easeIn(0.25)).toBeLessThan(0.25);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });
});

describe('Tween', () => {
  it('moves from its start to its end over its duration', () => {
    const t = new Tween(10, 20, 100, linear);
    expect(t.value).toBe(10);
    expect(t.update(50)).toBe(true);
    expect(t.value).toBe(15);
    expect(t.update(50)).toBe(false);
    expect(t.done).toBe(true);
    expect(t.value).toBe(20);
  });

  it('ends exactly on its end value and stays there', () => {
    const t = new Tween(0, 1, 120);
    for (let i = 0; i < 7; i++) t.update(16.7);
    t.update(1000);
    expect(t.value).toBe(1);
    expect(t.progress).toBe(1);
  });

  it('runs downwards too (a fade out)', () => {
    const t = new Tween(1, 0, 100, linear);
    t.update(25);
    expect(t.value).toBe(0.75);
  });

  it('only moves on the time it is given: no time, no change', () => {
    const t = new Tween(0, 100, 100, linear);
    t.update(30);
    const held = t.value;
    t.update(0);
    t.update(-50);
    expect(t.value).toBe(held);
    t.update(20);
    expect(t.value).toBe(50);
  });

  it('a zero-length tween is done at once', () => {
    const t = new Tween(0, 5, 0);
    expect(t.done).toBe(true);
    expect(t.value).toBe(5);
  });
});
