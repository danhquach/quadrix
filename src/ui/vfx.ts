import type { Cell } from '../core/events.ts';
import { COLS, ROWS } from '../core/game.ts';
import { mulberry32 } from '../core/pieces.ts';
import {
  MAX_FRAME_MS,
  type Effect,
  type EffectSource,
  type Effects,
  type EffectsLevel,
} from './effects.ts';
import { HOLD_MS } from './motion.ts';
import { Tween, easeOut, linear } from './tween.ts';

/** Cleared rows flash while they hold (motion.ts), then break into particles. */
export const ROW_FLASH_MS = HOLD_MS;
/** A quad or full clear shakes the board this far at most, easing out. */
export const SHAKE_PX = 4;
export const SHAKE_MS = 150;
/** The shockwave ring from the cleared rows: how long and how far, in cells. */
export const RING_MS = 400;
export const RING_RADIUS = 6;
/** The streak of light down a hard drop's path. */
export const STREAK_MS = 150;
export const STREAK_ALPHA = 0.35;
/** The dust puff where a hard-dropped piece lands. */
export const DUST_MIN = 6;
export const DUST_MAX = 10;
/** Combo sparks: this many per combo step, up to the most. */
export const SPARKS_PER_COMBO = 6;
export const MAX_SPARKS = 40;
/** The soft glow round locked cells: how far it spreads, in cells, and how strong. */
export const GLOW_SPREAD = 0.15;
export const GLOW_ALPHA = 0.14;
/** The ambient background: motes drifting up, a pulse on clears, a colour shift per level. */
export const MOTES = 16;
export const MOTE_ALPHA = 0.3;
export const PULSE_MS = 500;
export const PULSE_ALPHA = 0.4;
export const SHIFT_MS = 1500;
/** The band of light in the ambient gradient moves this slowly. */
const DRIFT_PERIOD_MS = 20000;
const MOTE_SPEED = 0.3;
const MOTE_SIZE = 0.12;
/** The freeze tint for Override's time freeze: how blue it washes the board. */
export const FREEZE_ALPHA = 0.3;

/** How a clear of `lines` rows looks: more lines, more and faster particles, a brighter flash. */
export interface ClearLook {
  readonly perCell: number;
  /** Particle speed, cells per second. */
  readonly speed: number;
  readonly flash: number;
  readonly life: number;
}

/** The look of a clear of 1 to 4 lines (other counts are held to that range). */
export function clearLook(lines: number): ClearLook {
  const n = Math.max(1, Math.min(4, Math.round(lines)));
  return { perCell: n, speed: 2 + 2 * n, flash: 0.35 + 0.15 * n, life: 400 + 50 * n };
}

/** A random source in [0, 1): seeded, so effects never touch Math.random. */
export type Rand = () => number;

/** A seeded random source for effects. */
export function rng(seed: number): Rand {
  let state = seed >>> 0;
  return () => {
    const [v, next] = mulberry32(state);
    state = next;
    return v;
  };
}

/** The colours the visual effects draw with, from page.css. */
export interface VfxLook {
  /** Base colour by board cell value (1 for the first kind); index 0 is value 1. */
  readonly pieces: readonly string[];
  /** Flashes and the drop streak. */
  readonly flash: string;
  /** The shockwave ring and combo sparks. */
  readonly light: string;
  /** The dust puff under a hard drop. */
  readonly dust: string;
}

/** The canvas calls the effects here need. */
type Paint = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'globalAlpha'
  | 'lineWidth'
  | 'fillRect'
  | 'beginPath'
  | 'arc'
  | 'stroke'
>;

/**
 * Cleared rows flash white, brighter for more lines, then break into particles in each
 * cell's colour. Full only: the flash lies over the rows motion.ts holds, and only Full
 * holds them (elsewhere the stack has already dropped into their place).
 */
export class RowBreak implements Effect {
  readonly layer = 'effects';
  readonly motion = true;
  private readonly rows: readonly number[];
  private readonly colors: readonly (readonly number[])[];
  private readonly look: ClearLook;
  private readonly flashColor: string;
  private readonly pieces: readonly string[];
  private readonly fx: Effects;
  private readonly rand: Rand;
  private readonly fade: Tween;

  constructor(
    rows: readonly number[],
    colors: readonly (readonly number[])[],
    look: VfxLook,
    fx: Effects,
    rand: Rand,
  ) {
    this.rows = rows;
    this.colors = colors;
    this.look = clearLook(rows.length);
    this.flashColor = look.flash;
    this.pieces = look.pieces;
    this.fx = fx;
    this.rand = rand;
    this.fade = new Tween(this.look.flash, 0, ROW_FLASH_MS, linear);
  }

  /** Flash opacity now. */
  get alpha(): number {
    return this.fade.value;
  }

  update(dt: number): boolean {
    if (this.fade.update(dt)) return true;
    this.break();
    return false;
  }

  draw(ctx: CanvasRenderingContext2D, cell: number): void {
    const p: Paint = ctx;
    p.globalAlpha = this.alpha;
    p.fillStyle = this.flashColor;
    for (const y of this.rows) p.fillRect(0, y * cell, COLS * cell, cell);
    p.globalAlpha = 1;
  }

  /** Each cell of each row bursts into particles of its own colour. */
  private break(): void {
    const { perCell, speed, life } = this.look;
    this.rows.forEach((y, i) => {
      (this.colors[i] ?? []).forEach((c, x) => {
        const color = this.pieces[c - 1];
        if (!color) return;
        for (let k = 0; k < perCell; k++) {
          const a = this.rand() * 2 * Math.PI;
          const v = speed * (0.5 + 0.5 * this.rand());
          this.fx.spawn({
            x: x + 0.5,
            y: y + 0.5,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v - speed / 2,
            gravity: 12,
            size: 0.15 + 0.1 * this.rand(),
            color,
            life: life * (0.7 + 0.3 * this.rand()),
          });
        }
      });
    });
  }
}

/** A ring that grows out from a point and fades: a quad or full clear. Motion: Full only. */
export class Shockwave implements Effect {
  readonly layer = 'effects';
  readonly motion = true;
  private readonly x: number;
  private readonly y: number;
  private readonly color: string;
  private readonly grow = new Tween(0, 1, RING_MS, linear);

  constructor(x: number, y: number, color: string) {
    this.x = x;
    this.y = y;
    this.color = color;
  }

  /** Radius now, in cells. */
  get radius(): number {
    return RING_RADIUS * easeOut(this.grow.progress);
  }

  update(dt: number): boolean {
    return this.grow.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, cell: number): void {
    const p: Paint = ctx;
    const t = this.grow.progress;
    p.globalAlpha = 1 - t;
    p.strokeStyle = this.color;
    p.lineWidth = Math.max(1, (0.3 - 0.2 * t) * cell);
    p.beginPath();
    p.arc(this.x * cell, this.y * cell, this.radius * cell, 0, 2 * Math.PI);
    p.stroke();
    p.globalAlpha = 1;
  }
}

/**
 * A streak of light down a hard drop's path, brightest where the piece landed, fading
 * out. A fade, so Reduced keeps it.
 */
export class DropStreak implements Effect {
  readonly layer = 'board';
  readonly motion = false;
  /** Per column: the top and bottom of the streak, in rows. */
  private readonly columns: readonly (readonly [number, number, number])[];
  private readonly color: string;
  private readonly fade = new Tween(STREAK_ALPHA, 0, STREAK_MS, linear);

  constructor(cells: readonly Cell[], distance: number, color: string) {
    const tops = new Map<number, number>();
    for (const [x, y] of cells) tops.set(x, Math.min(tops.get(x) ?? y, y));
    this.columns = [...tops].map(([x, top]) => [x, Math.max(0, top - distance), Math.max(0, top)]);
    this.color = color;
  }

  update(dt: number): boolean {
    return this.fade.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, cell: number): void {
    const p: Paint = ctx;
    p.fillStyle = this.color;
    const steps = 6;
    for (const [x, from, to] of this.columns) {
      const h = (to - from) / steps;
      if (h <= 0) continue;
      for (let i = 0; i < steps; i++) {
        // Fainter towards where the drop started.
        p.globalAlpha = this.fade.value * ((i + 1) / steps);
        p.fillRect(x * cell + cell * 0.2, (from + i * h) * cell, cell * 0.6, h * cell);
      }
    }
    p.globalAlpha = 1;
  }
}

/**
 * The board shake of a quad or full clear: at most SHAKE_PX CSS pixels, gone in
 * SHAKE_MS, easing out. Full only; Reduced and Off never shake. It runs on the effects
 * clock, so pausing freezes it.
 */
export class Shake {
  private levelNow: EffectsLevel;
  private t: Tween | null = null;

  constructor(level: EffectsLevel = 'full') {
    this.levelNow = level;
  }

  get level(): EffectsLevel {
    return this.levelNow;
  }

  /** Change the level; anything but Full stops a shake now. */
  set level(level: EffectsLevel) {
    this.levelNow = level;
    if (level !== 'full') this.t = null;
  }

  /** Start a shake (Full only). */
  kick(): void {
    if (this.levelNow === 'full') this.t = new Tween(0, 1, SHAKE_MS, linear);
  }

  frame(dt: number, paused: boolean): void {
    if (paused || !this.t) return;
    if (!this.t.update(Math.min(MAX_FRAME_MS, Math.max(0, dt)))) this.t = null;
  }

  /** Stop: a new game starts still. */
  clear(): void {
    this.t = null;
  }

  /** How far to move the board now, in CSS pixels: [x, y], never further than SHAKE_PX. */
  offset(): readonly [number, number] {
    if (!this.t) return [0, 0];
    const t = this.t.progress;
    const amp = SHAKE_PX * (1 - easeOut(t));
    // Changes direction a few times over the shake.
    const a = t * 7 * Math.PI;
    return [amp * Math.cos(a), amp * Math.sin(a * 1.3)];
  }
}

/** The centre of `rows` on the board, in cells. */
function rowsCentre(rows: readonly number[]): [number, number] {
  return [COLS / 2, rows.reduce((a, b) => a + b, 0) / rows.length + 0.5];
}

/**
 * The visual effects as an effect source: cleared rows flash and break; a quad or full
 * clear shakes the board (`shake`), sends out a shockwave and pulses the ambient
 * background (any clear pulses it); a hard drop leaves a streak and a dust puff; a combo
 * throws sparks along its rows, more for a longer combo.
 */
export function vfx(look: VfxLook, shake: Shake, ambient: Ambient, rand: Rand): EffectSource {
  /** The rows the last clear took. One action reports its clear before its award. */
  let cleared: readonly number[] = [];
  return (event, fx) => {
    if (event.type === 'hardDrop') {
      if (event.distance <= 0) return;
      fx.add(new DropStreak(event.cells, event.distance, look.flash));
      dust(fx, event.cells, look.dust, rand);
    } else if (event.type === 'lock') {
      cleared = [];
    } else if (event.type === 'clear' && event.rows.length > 0) {
      cleared = event.rows;
      fx.add(new RowBreak(event.rows, event.colors, look, fx, rand));
      ambient.pulse(event.rows.length);
    } else if (event.type === 'award' && cleared.length > 0) {
      const [cx, cy] = rowsCentre(cleared);
      if (cleared.length >= 4 || event.fullClear) {
        shake.kick();
        fx.add(new Shockwave(cx, cy, look.light));
      }
      if (event.combo > 0) sparks(fx, cleared, event.combo, look.light, rand);
    }
  };
}

/** A puff of DUST_MIN to DUST_MAX particles under where a hard-dropped piece landed. */
function dust(fx: Effects, cells: readonly Cell[], color: string, rand: Rand): void {
  const on = cells.filter(([, y]) => y >= 0);
  if (on.length === 0) return;
  const bottom = Math.max(...on.map(([, y]) => y)) + 1;
  const xs = on.filter(([, y]) => y === bottom - 1).map(([x]) => x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs) + 1;
  const count = DUST_MIN + Math.floor(rand() * (DUST_MAX - DUST_MIN + 1));
  for (let i = 0; i < count; i++) {
    const x = lo + rand() * (hi - lo);
    // Out to either side, away from the piece's centre.
    const side = x < (lo + hi) / 2 ? -1 : 1;
    fx.spawn({
      x,
      y: bottom - 0.05,
      vx: side * (1 + 2 * rand()),
      vy: -(1 + 1.5 * rand()),
      gravity: 6,
      size: 0.12 + 0.08 * rand(),
      color,
      life: 300 + 150 * rand(),
    });
  }
}

/** How many sparks a combo of `combo` throws: more for a longer combo, up to MAX_SPARKS. */
export function sparkCount(combo: number): number {
  return Math.min(MAX_SPARKS, SPARKS_PER_COMBO * (Math.max(1, combo) + 1));
}

/** Sparks along the cleared rows, racing sideways and fading: the combo trail. */
function sparks(
  fx: Effects,
  rows: readonly number[],
  combo: number,
  color: string,
  rand: Rand,
): void {
  const n = sparkCount(combo);
  for (let i = 0; i < n; i++) {
    const y = rows[i % rows.length]! + 0.2 + 0.6 * rand();
    const dir = i % 2 === 0 ? 1 : -1;
    fx.spawn({
      x: dir > 0 ? rand() * COLS * 0.3 : COLS - rand() * COLS * 0.3,
      y,
      vx: dir * (8 + 6 * rand()),
      vy: (rand() - 0.5) * 2,
      size: 0.1 + 0.05 * rand(),
      color,
      life: 300 + 200 * rand(),
    });
  }
}

/**
 * The soft glow round every locked cell: a faint wider square of its colour, drawn
 * before the blocks so only the rim shows. Cheap: one rectangle per cell. `shift` gives
 * a row's drawn offset in canvas pixels; rows where `skip` holds get none.
 */
export function drawBlockGlow(
  ctx: CanvasRenderingContext2D,
  cell: number,
  board: readonly (readonly number[])[],
  pieces: readonly string[],
  shift: (y: number) => number,
  skip: (y: number) => boolean,
): void {
  const g = GLOW_SPREAD * cell;
  ctx.globalAlpha = GLOW_ALPHA;
  board.forEach((row, y) => {
    if (skip(y)) return;
    const oy = shift(y);
    row.forEach((c, x) => {
      const color = c > 0 ? pieces[c - 1] : undefined;
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x * cell - g, y * cell - g + oy, cell + 2 * g, cell + 2 * g);
    });
  });
  ctx.globalAlpha = 1;
}

/** [r, g, b] 0–255 as #rrggbb. */
function hex([r, g, b]: readonly [number, number, number]): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Hue (degrees), saturation and lightness (0–1) as #rrggbb. */
export function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/** The ambient background's colours on one level. */
export interface AmbientColors {
  /** The gradient's lit band and its dark ends. */
  readonly band: string;
  readonly base: string;
  /** Drifting motes, drawn at MOTE_ALPHA at most. */
  readonly mote: string;
  /** The pulse on a clear, drawn at PULSE_ALPHA at most. */
  readonly pulse: string;
}

/**
 * The ambient colours on game level `level`: the hue turns each level; always dim. Dim
 * enough that the darkest piece (J's blue) still reads 3:1 on a mote over a pulse
 * (src/ui/vfx.test.ts).
 */
export function ambientColors(level: number): AmbientColors {
  const hue = (230 + (Math.max(1, Math.floor(level)) - 1) * 47) % 360;
  return {
    band: hsl(hue, 0.45, 0.08),
    base: hsl(hue, 0.4, 0.04),
    mote: hsl(hue, 0.5, 0.2),
    pulse: hsl(hue, 0.5, 0.12),
  };
}

/** `top` drawn at `alpha` over `under`, both #rrggbb: the colour you see. */
export function over(top: string, alpha: number, under: string): string {
  const parse = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const t = parse(top);
  const u = parse(under);
  return hex([0, 1, 2].map((i) => t[i]! * alpha + u[i]! * (1 - alpha)) as [number, number, number]);
}

/** The brightest colour the ambient background ever shows on `level`. */
export function brightestAmbient(level: number): string {
  const c = ambientColors(level);
  return over(c.mote, MOTE_ALPHA, over(c.pulse, PULSE_ALPHA, c.band));
}

/** The canvas calls the ambient background needs. */
type AmbientPaint = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'globalAlpha' | 'fillRect' | 'createLinearGradient'
>;

/**
 * The living background in the well: a dim gradient whose lit band drifts slowly, motes
 * drifting up, a gentle pulse on line clears (stronger for more lines), and a colour
 * that shifts to a new hue each level. Full plays it all; Reduced keeps a still gradient
 * that still shifts colour and pulses (fades only); Off draws nothing, leaving the
 * plain well. It runs on the effects clock, so pausing freezes it.
 */
export class Ambient {
  level: EffectsLevel;
  private ms = 0;
  private gameLevel = 1;
  private from: AmbientColors = ambientColors(1);
  private shift: Tween | null = null;
  private glow: Tween | null = null;
  private readonly motes: { x: number; y: number; speed: number; phase: number }[];

  constructor(level: EffectsLevel = 'full', seed = 7) {
    this.level = level;
    const rand = rng(seed);
    this.motes = Array.from({ length: MOTES }, () => ({
      x: rand() * COLS,
      y: rand() * ROWS,
      speed: MOTE_SPEED * (0.5 + rand()),
      phase: rand() * 2 * Math.PI,
    }));
  }

  /** Follow the game's level: a change cross-fades to the new level's colour. */
  setLevel(level: number): void {
    if (level === this.gameLevel) return;
    this.from = this.colors;
    this.gameLevel = level;
    this.shift = new Tween(0, 1, SHIFT_MS, linear);
  }

  /** Back to level 1 with no pulse or shift running: a new game starts plain. */
  clear(): void {
    this.gameLevel = 1;
    this.from = ambientColors(1);
    this.shift = this.glow = null;
  }

  /** Pulse for a clear of `lines` rows: brighter for more. */
  pulse(lines: number): void {
    const strength = Math.max(1, Math.min(4, lines)) / 4;
    this.glow = new Tween(PULSE_ALPHA * strength, 0, PULSE_MS, easeOut);
  }

  frame(dt: number, paused: boolean): void {
    if (paused) return;
    const step = Math.min(MAX_FRAME_MS, Math.max(0, dt));
    this.ms += step;
    if (this.shift && !this.shift.update(step)) this.shift = null;
    if (this.glow && !this.glow.update(step)) this.glow = null;
    if (this.level !== 'full') return;
    for (const m of this.motes) {
      m.y -= (m.speed * step) / 1000;
      if (m.y < 0) m.y += ROWS;
    }
  }

  /** The colours now, partway to the new level's while a shift runs. */
  get colors(): AmbientColors {
    const to = ambientColors(this.gameLevel);
    if (!this.shift) return to;
    const t = this.shift.value;
    return {
      band: over(to.band, t, this.from.band),
      base: over(to.base, t, this.from.base),
      mote: over(to.mote, t, this.from.mote),
      pulse: over(to.pulse, t, this.from.pulse),
    };
  }

  /** The pulse's opacity now. */
  get pulsing(): number {
    return this.glow?.value ?? 0;
  }

  /** Draw over the whole well; Off draws nothing. */
  draw(ctx: CanvasRenderingContext2D, cell: number): void {
    if (this.level === 'off') return;
    const p: AmbientPaint = ctx;
    const c = this.colors;
    const w = COLS * cell;
    const h = ROWS * cell;
    const full = this.level === 'full';
    const band = full ? 0.35 + 0.15 * Math.sin((2 * Math.PI * this.ms) / DRIFT_PERIOD_MS) : 0.35;
    const g = p.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, c.base);
    g.addColorStop(band, c.band);
    g.addColorStop(1, c.base);
    p.fillStyle = g;
    p.fillRect(0, 0, w, h);
    if (this.pulsing > 0) {
      p.globalAlpha = this.pulsing;
      p.fillStyle = c.pulse;
      p.fillRect(0, 0, w, h);
    }
    if (full) {
      p.fillStyle = c.mote;
      const size = MOTE_SIZE * cell;
      for (const m of this.motes) {
        p.globalAlpha = MOTE_ALPHA * (0.5 + 0.5 * Math.sin(this.ms / 900 + m.phase));
        p.fillRect(m.x * cell, m.y * cell, size, size);
      }
    }
    p.globalAlpha = 1;
  }
}

/**
 * Override's time freeze (#27) drawn over the board: desaturated and washed blue, by
 * `amount` 0–1 (fade it in and out with a Tween). A wash, not motion: Reduced keeps it.
 */
export function drawFreeze(
  ctx: CanvasRenderingContext2D,
  cell: number,
  amount: number,
  tint: string,
): void {
  if (amount <= 0) return;
  const w = COLS * cell;
  const h = ROWS * cell;
  const a = Math.min(1, amount);
  ctx.save();
  ctx.globalCompositeOperation = 'saturation';
  ctx.globalAlpha = a;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = FREEZE_ALPHA * a;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * The all-at-once shatter at the end of Override's freeze (#27): every locked cell of
 * `board` bursts outwards in its colour. Full only, and within the particle cap: past
 * it, the rest are dropped. Returns how many particles started.
 */
export function shatter(
  fx: Effects,
  board: readonly (readonly number[])[],
  pieces: readonly string[],
  rand: Rand,
): number {
  let started = 0;
  board.forEach((row, y) =>
    row.forEach((c, x) => {
      const color = pieces[c - 1];
      if (!color) return;
      const a = rand() * 2 * Math.PI;
      const v = 4 + 6 * rand();
      const ok = fx.spawn({
        x: x + 0.5,
        y: y + 0.5,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 3,
        gravity: 14,
        size: 0.3 + 0.2 * rand(),
        color,
        life: 600 + 300 * rand(),
      });
      if (ok) started++;
    }),
  );
  return started;
}
