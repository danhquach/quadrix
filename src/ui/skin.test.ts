import { describe, expect, it } from 'vitest';
import { KINDS } from '../core/pieces.ts';
import {
  MARKS,
  PIECE_VARS,
  blockColors,
  contrast,
  PIECE_STYLES,
  PIECE_STYLE_NAMES,
  drawBlock,
  isPieceStyle,
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
  const backgrounds = ['--bg-top', '--bg-bottom', '--surface', '--card', '--button', '--well-bg'];

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
  type Box = [number, number, number, number];
  /**
   * Records what each style paints: filled rectangles and rounded paths, each path with
   * the widest line stroked along it (0 when only filled).
   */
  const recorder = () => {
    const rects: Box[] = [];
    const paths: { box: Box; line: number }[] = [];
    const ctx = {
      fillStyle: '' as string | CanvasGradient | CanvasPattern,
      strokeStyle: '' as string | CanvasGradient | CanvasPattern,
      lineWidth: 1,
      fillRect: (x: number, y: number, w: number, h: number) => void rects.push([x, y, w, h]),
      beginPath: () => {},
      roundRect: (x: number, y: number, w: number, h: number) =>
        void paths.push({ box: [x, y, w, h], line: 0 }),
      fill: () => {},
      stroke: () => {
        const p = paths.at(-1)!;
        p.line = Math.max(p.line, ctx.lineWidth);
      },
      createLinearGradient: () => ({ addColorStop: () => {} }) as unknown as CanvasGradient,
    };
    return { rects, paths, ctx };
  };

  it.each(PIECE_STYLES.flatMap((st) => [1, 2, 5, 8, 24, 31, 64].map((n) => [st, n] as const)))(
    '%s stays inside its cell at %ipx',
    (style, size) => {
      for (const k of KINDS) {
        const { rects, paths, ctx } = recorder();
        drawBlock(ctx, 100, 200, size, blockColors('#4f80ea'), MARKS[k], style);
        const boxes = [...rects.map((r) => ({ box: r, line: 0 })), ...paths];
        // Too small for a block once its gap is taken: nothing at all.
        if (size > 2) expect(boxes.length).toBeGreaterThan(0);
        for (const { box, line } of boxes) {
          const [x, y, w, h] = box;
          const half = line / 2;
          expect(w).toBeGreaterThanOrEqual(0);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(x - half).toBeGreaterThanOrEqual(100);
          expect(y - half).toBeGreaterThanOrEqual(200);
          expect(x + w + half).toBeLessThanOrEqual(100 + size);
          expect(y + h + half).toBeLessThanOrEqual(200 + size);
        }
      }
    },
  );

  it('bevel draws bevel, face and the mark', () => {
    const { rects, paths, ctx } = recorder();
    drawBlock(ctx, 0, 0, 32, blockColors('#4f80ea'), MARKS.S);
    expect(rects).toHaveLength(3 + MARKS.S.length);
    expect(paths).toHaveLength(0);
  });

  it.each(['gem', 'neon'] as const)('%s draws rounded shapes and still the mark', (style) => {
    const { rects, paths, ctx } = recorder();
    drawBlock(ctx, 0, 0, 32, blockColors('#4f80ea'), MARKS.S, style);
    expect(rects).toHaveLength(MARKS.S.length);
    expect(paths.length).toBeGreaterThan(0);
  });

  it("neon's lit mark stands out from its dark face", () => {
    for (const name of PIECE_VARS) {
      const c = blockColors(v(name));
      expect(contrast(c.light, c.deep)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('piece styles', () => {
  it('are bevel, gem and neon, each with a name', () => {
    expect(PIECE_STYLES).toEqual(['bevel', 'gem', 'neon']);
    for (const st of PIECE_STYLES) expect(PIECE_STYLE_NAMES[st]).toBeTruthy();
  });

  it('accepts only the listed styles', () => {
    for (const st of PIECE_STYLES) expect(isPieceStyle(st)).toBe(true);
    for (const bad of ['', 'Bevel', 'glass', '__proto__', 'toString', null, 1, {}, ['gem']])
      expect(isPieceStyle(bad)).toBe(false);
  });
});
