import { describe, expect, it } from 'vitest';
import { KINDS } from '../core/pieces.ts';
import {
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

  it('pieces use the vibrant palette', () => {
    expect(PIECE_VARS.slice(0, 7).map(v)).toEqual([
      '#00e5ff',
      '#ffd600',
      '#b84dff',
      '#2ee86a',
      '#ff2d55',
      '#2f6bff',
      '#ff8a00',
    ]);
  });

  it('the game-over grey is neutral, far from every saturated piece color', () => {
    const chroma = (hex: string) => {
      const rgb = parseHex(hex)!;
      return (Math.max(...rgb) - Math.min(...rgb)) / 255;
    };
    const grey = v('--stack-over');
    expect(chroma(grey)).toBeLessThan(0.15);
    for (const name of PIECE_VARS) {
      expect(chroma(v(name))).toBeGreaterThan(0.6);
      const [a, b] = [parseHex(v(name))!, parseHex(grey)!];
      expect(Math.hypot(...a.map((c, i) => c - b[i]!))).toBeGreaterThan(120);
    }
  });

  it('every piece color is different', () => {
    expect(new Set(PIECE_VARS.map((n) => v(n).toLowerCase())).size).toBe(KINDS.length);
  });

  it('every piece color is far from every other (CIE76 ΔE ≥ 20), so no two kinds look alike', () => {
    const lab = (hex: string) => {
      const [r, g, b] = parseHex(hex)!.map((c) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
      const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
      const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const colors = PIECE_VARS.map((n) => lab(v(n)));
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const d = Math.hypot(...colors[i]!.map((c, k) => c - colors[j]![k]!));
        expect(d, `${PIECE_VARS[i]} vs ${PIECE_VARS[j]}`).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('the grid is faint: visible on the well but far below the blocks', () => {
    const grid = contrast(v('--grid'), v('--well-bg'));
    expect(grid).toBeGreaterThan(1.05);
    expect(grid).toBeLessThan(1.5);
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
    expect(luminance(shade('#2f6bff', 0.35))).toBeGreaterThan(luminance('#2f6bff'));
    expect(luminance(shade('#2f6bff', -0.35))).toBeLessThan(luminance('#2f6bff'));
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
      for (const name of PIECE_VARS) {
        const { rects, paths, ctx } = recorder();
        drawBlock(ctx, 100, 200, size, blockColors(v(name)), style);
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

  it('bevel draws only its edges and face: no inner marks', () => {
    const { rects, paths, ctx } = recorder();
    drawBlock(ctx, 0, 0, 32, blockColors('#2f6bff'));
    expect(rects).toHaveLength(3);
    expect(paths).toHaveLength(0);
  });

  it('gem draws its rim, face and gloss as rounded shapes: no inner marks', () => {
    const { rects, paths, ctx } = recorder();
    drawBlock(ctx, 0, 0, 32, blockColors('#2f6bff'), 'gem');
    expect(rects).toHaveLength(0);
    expect(paths).toHaveLength(3);
  });

  it('neon draws its face and outline as rounded shapes: no inner marks', () => {
    const { rects, paths, ctx } = recorder();
    drawBlock(ctx, 0, 0, 32, blockColors('#2f6bff'), 'neon');
    expect(rects).toHaveLength(0);
    expect(paths).toHaveLength(2);
  });

  it("neon's outline stands out from its dark face", () => {
    for (const name of PIECE_VARS) {
      const c = blockColors(v(name));
      expect(contrast(c.base, c.deep)).toBeGreaterThanOrEqual(3);
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
