import { describe, expect, it } from 'vitest';
import { KINDS } from '../core/pieces.ts';
import {
  MARKS,
  PIECE_VARS,
  blockColors,
  contrast,
  drawBlock,
  luminance,
  parseHex,
  shade,
} from './skin.ts';
import css from '../page.css?raw';

/** The custom properties set in page.css's `:root` block. */
const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!;
const vars = new Map([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
const v = (name: string) => {
  const value = vars.get(name);
  if (!value) throw new Error(`${name} is not set in page.css :root`);
  return value;
};

describe('page palette', () => {
  const backgrounds = ['--bg-top', '--bg-bottom', '--surface', '--well-bg'];

  it.each(['--text', '--muted', '--accent'])(
    '%s meets WCAG AA (4.5:1) on every background',
    (t) => {
      for (const bg of backgrounds) expect(contrast(v(t), v(bg))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('every piece has a color, and each reads (3:1) against the well', () => {
    for (const name of PIECE_VARS) {
      expect(parseHex(v(name))).not.toBeNull();
      expect(contrast(v(name), v('--well-bg'))).toBeGreaterThanOrEqual(3);
    }
  });

  it('every piece color is different', () => {
    expect(new Set(PIECE_VARS.map((n) => v(n).toLowerCase())).size).toBe(KINDS.length);
  });

  it('the grid is faint: visible on the well but far below the blocks', () => {
    const grid = contrast(v('--grid'), v('--well-bg'));
    expect(grid).toBeGreaterThan(1.05);
    expect(grid).toBeLessThan(1.5);
  });
});

describe('marks', () => {
  it('give every kind its own mark, so kinds differ by more than hue', () => {
    const keys = KINDS.map((k) => JSON.stringify(MARKS[k]));
    expect(new Set(keys).size).toBe(KINDS.length);
  });

  it('stay inside the block', () => {
    for (const k of KINDS) {
      for (const [x, y, w, h] of MARKS[k]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(1);
        expect(y + h).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stand out from the block face', () => {
    for (const name of PIECE_VARS) {
      const c = blockColors(v(name));
      expect(contrast(c.mark, c.base)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('color helpers', () => {
  it('parse #rgb and #rrggbb only', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex(' #0a0B0c ')).toEqual([10, 11, 12]);
    for (const bad of ['', 'red', '#ff', '#fffff', '#ggg', 'rgb(0 0 0)', '#fff;x']) {
      expect(parseHex(bad)).toBeNull();
    }
  });

  it('shade mixes toward white or black', () => {
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 0)).toBe('#808080');
    expect(luminance(shade('#4f80ea', 0.35))).toBeGreaterThan(luminance('#4f80ea'));
    expect(luminance(shade('#4f80ea', -0.35))).toBeLessThan(luminance('#4f80ea'));
  });

  it('contrast matches WCAG for black on white', () => {
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrast('#fff', '#000')).toBeCloseTo(21, 5);
  });

  it('a missing or malformed color falls back to grey instead of breaking the canvas', () => {
    expect(blockColors('').base).toBe('#808080');
    expect(blockColors('url(x)').base).toBe('#808080');
  });
});

describe('drawBlock', () => {
  /** Records each rectangle drawn. */
  const recorder = () => {
    const rects: [number, number, number, number][] = [];
    return {
      rects,
      ctx: {
        fillStyle: '' as string | CanvasGradient | CanvasPattern,
        fillRect: (x: number, y: number, w: number, h: number) => void rects.push([x, y, w, h]),
      },
    };
  };

  it.each([1, 2, 5, 8, 24, 31, 64])('stays inside its cell at %ipx', (size) => {
    for (const k of KINDS) {
      const { rects, ctx } = recorder();
      drawBlock(ctx, 100, 200, size, blockColors('#4f80ea'), MARKS[k]);
      for (const [x, y, w, h] of rects) {
        expect(w).toBeGreaterThan(0);
        expect(h).toBeGreaterThan(0);
        expect(x).toBeGreaterThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(200);
        expect(x + w).toBeLessThanOrEqual(100 + size);
        expect(y + h).toBeLessThanOrEqual(200 + size);
      }
    }
  });

  it('draws bevel, face and the mark', () => {
    const { rects, ctx } = recorder();
    drawBlock(ctx, 0, 0, 32, blockColors('#4f80ea'), MARKS.S);
    expect(rects).toHaveLength(3 + MARKS.S.length);
  });
});
