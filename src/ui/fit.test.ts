import { describe, expect, it } from 'vitest';
import { fitBoard } from './fit.ts';

describe('fitBoard', () => {
  // Board areas at phone and tablet sizes, portrait and landscape.
  const boxes: [number, number][] = [
    [359, 550],
    [374, 728],
    [414, 816],
    [752, 900],
    [1008, 1240],
    [440, 359],
    [600, 374],
    [700, 414],
  ];

  for (const dpr of [1, 2, 3, 2.625]) {
    for (const [w, h] of boxes) {
      it(`fits ${w}×${h} at DPR ${dpr} with whole device-pixel cells`, () => {
        const f = fitBoard(w, h, 10, 20, dpr);
        expect(Number.isInteger(f.deviceCell)).toBe(true);
        expect(f.pxWidth).toBe(f.deviceCell * 10);
        expect(f.pxHeight).toBe(f.deviceCell * 20);
        // Epsilon: pxWidth / dpr is a float division.
        expect(f.cssWidth).toBeLessThanOrEqual(w + 1e-9);
        expect(f.cssHeight).toBeLessThanOrEqual(h + 1e-9);
        expect(f.cssWidth * dpr).toBeCloseTo(f.pxWidth, 9);
        // Largest fit: one more device pixel per cell would overflow.
        const bigger = f.deviceCell + 1;
        expect((bigger * 10) / dpr > w || (bigger * 20) / dpr > h).toBe(true);
      });
    }
  }

  it('is limited by the shorter side', () => {
    expect(fitBoard(1000, 400, 10, 20, 1).deviceCell).toBe(20);
    expect(fitBoard(200, 1000, 10, 20, 1).deviceCell).toBe(20);
  });

  it('scales the backing store by the pixel ratio', () => {
    const f = fitBoard(300, 600, 10, 20, 3);
    expect(f).toMatchObject({ deviceCell: 90, pxWidth: 900, pxHeight: 1800 });
    expect(f).toMatchObject({ cssWidth: 300, cssHeight: 600 });
  });

  it('falls back to a 1-pixel cell for an empty or invalid box', () => {
    for (const [w, h] of [
      [0, 0],
      [-5, 100],
      [NaN, 100],
      [Infinity, Infinity],
    ]) {
      expect(fitBoard(w!, h!, 10, 20, 2).deviceCell).toBe(1);
    }
  });

  it('treats an invalid pixel ratio as 1', () => {
    for (const dpr of [0, -2, NaN, Infinity]) {
      expect(fitBoard(300, 600, 10, 20, dpr)).toMatchObject({ deviceCell: 30, cssWidth: 300 });
    }
  });
});
