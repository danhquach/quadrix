import { KINDS, type Kind } from '../core/pieces.ts';

/** A rectangle as fractions of a cell's edge: [x, y, width, height]. */
export type Rect = readonly [number, number, number, number];

/** The CSS variable (page.css) holding each kind's color, in KINDS order. */
export const PIECE_VARS = KINDS.map((k) => `--piece-${k.toLowerCase()}`);

/**
 * A mark drawn inside every block of a kind, so kinds differ by more than hue. Each
 * kind's set of rectangles is unique (src/ui/skin.test.ts).
 */
// prettier-ignore
export const MARKS: Record<Kind, readonly Rect[]> = {
  I: [[0.25, 0.44, 0.5, 0.12]],
  O: [[0.36, 0.36, 0.28, 0.28]],
  T: [[0.44, 0.25, 0.12, 0.5]],
  S: [[0.58, 0.26, 0.16, 0.16], [0.26, 0.58, 0.16, 0.16]],
  Z: [[0.26, 0.26, 0.16, 0.16], [0.58, 0.58, 0.16, 0.16]],
  J: [[0.26, 0.42, 0.16, 0.16], [0.58, 0.42, 0.16, 0.16]],
  L: [[0.42, 0.26, 0.16, 0.16], [0.42, 0.58, 0.16, 0.16]],
};

/** `#rgb` or `#rrggbb` as [r, g, b] in 0..255, or null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** `hex` mixed toward white (amount > 0) or black (amount < 0), by |amount| in 0..1. */
export function shade(hex: string, amount: number): string {
  const rgb = parseHex(hex) ?? [128, 128, 128];
  const to = amount > 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  return `#${rgb
    .map((c) =>
      Math.round(c + (to - c) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** WCAG relative luminance of `hex`. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** One kind's block colors, worked out once from its base color. */
export interface BlockColors {
  base: string;
  light: string;
  dark: string;
  mark: string;
}

export function blockColors(base: string): BlockColors {
  const b = parseHex(base) ? base : '#808080';
  return { base: b, light: shade(b, 0.35), dark: shade(b, -0.35), mark: shade(b, -0.5) };
}

type Fill = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;

/**
 * A shaded block filling the cell at (px, py) of edge `size` (device pixels): a lit
 * top-left bevel, a shadowed bottom-right one, and the kind's mark. A 1px gap keeps
 * neighbouring blocks apart.
 */
export function drawBlock(
  c: Fill,
  px: number,
  py: number,
  size: number,
  colors: BlockColors,
  marks: readonly Rect[],
): void {
  const gap = Math.max(1, Math.round(size / 30));
  const x = px + gap;
  const y = py + gap;
  const s = size - 2 * gap;
  if (s <= 0) return;
  const bevel = Math.max(1, Math.round(s / 8));
  c.fillStyle = colors.dark;
  c.fillRect(x, y, s, s);
  c.fillStyle = colors.light;
  c.fillRect(x, y, s - bevel, s - bevel);
  c.fillStyle = colors.base;
  c.fillRect(x + bevel, y + bevel, s - 2 * bevel, s - 2 * bevel);
  c.fillStyle = colors.mark;
  for (const [mx, my, mw, mh] of marks) {
    c.fillRect(
      x + Math.round(mx * s),
      y + Math.round(my * s),
      Math.max(1, Math.round(mw * s)),
      Math.max(1, Math.round(mh * s)),
    );
  }
}
