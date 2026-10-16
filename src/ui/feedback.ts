import type { Cell } from '../core/events.ts';
import { COLS, ROWS, type Game } from '../core/game.ts';
import { MAX_FRAME_MS, type Effect, type EffectSource, type EffectsLevel } from './effects.ts';
import { Tween, easeOut, linear } from './tween.ts';

/** A locked piece's cells flash bright, then fade. */
export const FLASH_MS = 100;
export const FLASH_ALPHA = 0.7;
/** Score popups float up from the cleared rows and fade. */
export const POPUP_MS = 900;
export const POPUP_FLOAT = 1.5;
/** Text over the board covers the falling piece's column for this long at most. */
export const COVER_MS = 300;
/** It shows at full strength over the piece, fading out over the last of that time. */
export const COVER_FADE_MS = 100;
/** Level up: a light runs once round the frame, and a "Level N" banner shows. */
export const LEVEL_MS = 600;
/** Any locked cell in the top rows lights the danger glow. */
export const DANGER_ROWS = 4;
export const DANGER_PERIOD_MS = 1600;
export const DANGER_MIN = 0.25;
export const DANGER_MAX = 0.6;
/** The HUD score counts up to its new value. */
export const COUNT_MS = 400;
/** Popups for bigger plays are larger, up to this. */
export const MAX_POPUP_SCALE = 1.6;

/** Text sizes in cells: points, labels, the level banner. */
const POINTS_SIZE = 0.9;
const LABEL_SIZE = 0.6;
const BANNER_SIZE = 1.3;
/** A bold character's width at most, and the line height, in text sizes. */
const CHAR_WIDTH = 0.65;
const LINE_HEIGHT = 1.15;
/** The light round the frame: its square and how many cells of tail follow it. */
const LIGHT_SIZE = 0.3;
const LIGHT_TAIL = 4;
const LIGHT_STEPS = 12;
/** The danger glow: bands this thick, fading inwards from the edges. */
const GLOW_BANDS = 6;
const GLOW_BAND = 0.1;

/** Board columns from `[0]` up to, not including, `[1]`. */
export type Span = readonly [number, number];

/** The colours and font the feedback draws with, from page.css. */
export interface FeedbackLook {
  readonly font: string;
  readonly text: string;
  readonly outline: string;
  readonly flash: string;
  readonly light: string;
}

/** The canvas calls feedback needs. */
type Paint = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'globalAlpha'
  | 'font'
  | 'lineWidth'
  | 'lineJoin'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'fillText'
  | 'strokeText'
  | 'save'
  | 'restore'
>;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Where to centre text `width` cells wide, as near `near` as it can sit: beside the
 * falling piece's columns `span` when there is room there, else anywhere on the board.
 */
export function placeX(width: number, near: number, span: Span | null): number {
  const half = Math.min(width, COLS) / 2;
  const anywhere = clamp(near, half, COLS - half);
  if (!span) return anywhere;
  const beside = [
    [0, span[0]],
    [span[1], COLS],
  ]
    .filter(([lo, hi]) => hi! - lo! >= width)
    .map(([lo, hi]) => clamp(near, lo! + half, hi! - half));
  if (beside.length === 0) return anywhere;
  return beside.reduce((a, b) => (Math.abs(b - near) < Math.abs(a - near) ? b : a));
}

/** Whether text `width` cells wide centred on `x` is over any column of `span`. */
export function covers(x: number, width: number, span: Span | null): boolean {
  return span !== null && x - width / 2 < span[1] && x + width / 2 > span[0];
}

/** How much larger a popup shows for `points` scored on `level`: 1 for a single, more for more. */
export function popupScale(points: number, level: number): number {
  const perLevel = points / Math.max(1, level);
  return clamp(1 + 0.15 * Math.log2(Math.max(1, perLevel / 100)), 1, MAX_POPUP_SCALE);
}

/** Whether any locked cell is in the top DANGER_ROWS rows. */
export function inDanger(board: readonly (readonly number[])[]): boolean {
  return board.slice(0, DANGER_ROWS).some((row) => row.some((c) => c !== 0));
}

/** A line of text and its size in cells. */
interface Line {
  readonly text: string;
  readonly size: number;
}

/**
 * Text over the board that fades in, may float up, and fades out: a score popup or the
 * level banner. Once it has been over the falling piece's column for COVER_MS in all it
 * is gone, fading out over the last COVER_FADE_MS of that time.
 */
export class FloatText implements Effect {
  readonly layer = 'effects';
  readonly motion = false;
  readonly x: number;
  readonly width: number;
  private readonly lines: readonly Line[];
  private readonly y: number;
  private readonly rise: number;
  private readonly lifeMs: number;
  private readonly look: FeedbackLook;
  private readonly pieceSpan: () => Span | null;
  private age = 0;
  private coveredMs = 0;

  constructor(
    lines: readonly Line[],
    near: readonly [number, number],
    rise: number,
    lifeMs: number,
    look: FeedbackLook,
    pieceSpan: () => Span | null,
  ) {
    const wide = Math.max(...lines.map((l) => l.text.length * CHAR_WIDTH * l.size));
    // Too wide for the board: shrink it to fit.
    const fit = Math.min(1, (COLS - 0.5) / wide);
    this.lines = lines.map((l) => ({ text: l.text, size: l.size * fit }));
    this.width = wide * fit;
    const height = this.lines.reduce((h, l) => h + l.size * LINE_HEIGHT, 0);
    this.x = placeX(this.width, near[0], pieceSpan());
    // Top of the block, kept on the board from start to end of its rise.
    this.y = clamp(near[1] - height / 2, rise, ROWS - height);
    this.rise = rise;
    this.lifeMs = lifeMs;
    this.look = look;
    this.pieceSpan = pieceSpan;
  }

  /** Time over the falling piece's column so far. */
  get covered(): number {
    return this.coveredMs;
  }

  update(dt: number): boolean {
    this.age += dt;
    if (covers(this.x, this.width, this.pieceSpan())) this.coveredMs += dt;
    return this.age < this.lifeMs && this.coveredMs < COVER_MS;
  }

  /** Opacity now: in over the first sixth, out over the last half, or as its cover time runs out. */
  get alpha(): number {
    const t = this.age / this.lifeMs;
    const life = t < 1 / 6 ? t * 6 : t > 0.5 ? (1 - t) * 2 : 1;
    const cover = clamp((COVER_MS - this.coveredMs) / COVER_FADE_MS, 0, 1);
    return clamp(life, 0, 1) * cover;
  }

  draw(ctx: CanvasRenderingContext2D, cell: number): void {
    const p: Paint = ctx;
    p.save();
    p.globalAlpha = this.alpha;
    p.textAlign = 'center';
    p.textBaseline = 'middle';
    p.lineJoin = 'round';
    p.fillStyle = this.look.text;
    p.strokeStyle = this.look.outline;
    let y = this.y - this.rise * easeOut(Math.min(1, this.age / this.lifeMs));
    for (const line of this.lines) {
      const px = line.size * cell;
      p.font = `700 ${Math.round(px)}px ${this.look.font}`;
      p.lineWidth = Math.max(2, px / 6);
      const cy = (y + (line.size * LINE_HEIGHT) / 2) * cell;
      p.strokeText(line.text, this.x * cell, cy);
      p.fillText(line.text, this.x * cell, cy);
      y += line.size * LINE_HEIGHT;
    }
    p.restore();
  }
}

/** A just-locked piece's cells flash bright, then fade (a fade, so Reduced keeps it). */
export class LockFlash implements Effect {
  readonly layer = 'board';
  readonly motion = false;
  private readonly cells: readonly Cell[];
  private readonly color: string;
  private readonly fade = new Tween(FLASH_ALPHA, 0, FLASH_MS, linear);

  constructor(cells: readonly Cell[], color: string) {
    this.cells = cells.filter(([, y]) => y >= 0);
    this.color = color;
  }

  update(dt: number): boolean {
    return this.fade.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, cell: number): void {
    ctx.globalAlpha = this.fade.value;
    ctx.fillStyle = this.color;
    for (const [x, y] of this.cells) ctx.fillRect(x * cell, y * cell, cell, cell);
    ctx.globalAlpha = 1;
  }
}

/** The point `s` cells clockwise round the board's edge from its top left corner. */
export function edgePoint(s: number): readonly [number, number] {
  const around = 2 * (COLS + ROWS);
  const d = ((s % around) + around) % around;
  if (d < COLS) return [d, 0];
  if (d < COLS + ROWS) return [COLS, d - COLS];
  if (d < 2 * COLS + ROWS) return [COLS - (d - COLS - ROWS), ROWS];
  return [0, ROWS - (d - 2 * COLS - ROWS)];
}

/** A light with a fading tail runs once round the inside of the frame. Motion: Full only. */
export class FrameLight implements Effect {
  readonly layer = 'effects';
  readonly motion = true;
  private readonly color: string;
  private readonly run = new Tween(0, 2 * (COLS + ROWS), LEVEL_MS, linear);

  constructor(color: string) {
    this.color = color;
  }

  update(dt: number): boolean {
    return this.run.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, cell: number): void {
    ctx.fillStyle = this.color;
    const size = LIGHT_SIZE * cell;
    for (let i = 0; i < LIGHT_STEPS; i++) {
      const [x, y] = edgePoint(this.run.value - (i * LIGHT_TAIL) / LIGHT_STEPS);
      ctx.globalAlpha = 1 - i / LIGHT_STEPS;
      // Kept inside the board, so the corners and far edges show too.
      ctx.fillRect(
        clamp(x * cell - size / 2, 0, COLS * cell - size),
        clamp(y * cell - size / 2, 0, ROWS * cell - size),
        size,
        size,
      );
    }
    ctx.globalAlpha = 1;
  }
}

/** The centre of `cells` on the board, or null if none is on it. */
function centre(cells: readonly Cell[]): [number, number] | null {
  const on = cells.filter(([, y]) => y >= 0);
  if (on.length === 0) return null;
  const mean = (vs: number[]) => vs.reduce((a, b) => a + b, 0) / vs.length + 0.5;
  return [mean(on.map(([x]) => x)), mean(on.map(([, y]) => y))];
}

/**
 * The feedback effects as an effect source: a flash on every lock, a popup with the
 * points and labels of every award (from the rows it cleared, else from the piece), and
 * the frame light and banner on every level up. `pieceSpan` gives the falling piece's
 * columns now, or null with no piece in play.
 */
export function feedback(look: FeedbackLook, pieceSpan: () => Span | null): EffectSource {
  /** Where the last lock's popup starts. One action reports its lock before its award. */
  let from: [number, number] = [COLS / 2, ROWS / 2];
  return (event, fx) => {
    if (event.type === 'lock') {
      fx.add(new LockFlash(event.cells, look.flash));
      from = centre(event.cells) ?? [COLS / 2, ROWS / 2];
    } else if (event.type === 'clear' && event.rows.length > 0) {
      from = [from[0], event.rows.reduce((a, b) => a + b, 0) / event.rows.length + 0.5];
    } else if (event.type === 'award') {
      const scale = popupScale(event.points, event.level);
      const lines: Line[] = [];
      if (event.points > 0) lines.push({ text: `+${event.points}`, size: POINTS_SIZE * scale });
      for (const text of event.labels) lines.push({ text, size: LABEL_SIZE * scale });
      if (lines.length === 0) return;
      const rise = fx.level === 'full' ? POPUP_FLOAT : 0;
      fx.add(new FloatText(lines, from, rise, POPUP_MS, look, pieceSpan));
    } else if (event.type === 'levelUp') {
      fx.add(new FrameLight(look.light));
      const banner = [{ text: `Level ${event.level}`, size: BANNER_SIZE }];
      fx.add(new FloatText(banner, [COLS / 2, ROWS * 0.3], 0, LEVEL_MS, look, pieceSpan));
    }
  };
}

/**
 * The danger glow round the board's edges: on while any locked cell is in the top
 * DANGER_ROWS rows, off as soon as none is. Full pulses it slowly, Reduced holds it
 * steady, Off never shows it. Its pulse runs on the effects clock, so pausing freezes it.
 */
export class Danger {
  level: EffectsLevel;
  private on = false;
  private ms = 0;

  constructor(level: EffectsLevel = 'full') {
    this.level = level;
  }

  /** Switch on or off; each switch on starts the pulse from its dimmest. */
  set(on: boolean): void {
    if (on && !this.on) this.ms = 0;
    this.on = on;
  }

  frame(dt: number, paused: boolean): void {
    if (!paused && this.on) this.ms += Math.min(MAX_FRAME_MS, Math.max(0, dt));
  }

  /** Opacity of the glow now; 0 when it is off. */
  get alpha(): number {
    if (!this.on || this.level === 'off') return 0;
    if (this.level === 'reduced') return DANGER_MAX;
    const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.ms) / DANGER_PERIOD_MS);
    return DANGER_MIN + (DANGER_MAX - DANGER_MIN) * wave;
  }
}

/** Draw the danger glow at `alpha`: bands of `color` fading inwards from every edge. */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  cell: number,
  alpha: number,
  color: string,
): void {
  if (alpha <= 0) return;
  const w = COLS * cell;
  const h = ROWS * cell;
  const t = Math.max(1, GLOW_BAND * cell);
  ctx.fillStyle = color;
  for (let i = 0; i < GLOW_BANDS; i++) {
    ctx.globalAlpha = alpha * (1 - i / GLOW_BANDS);
    const o = i * t;
    ctx.fillRect(o, o, w - 2 * o, t);
    ctx.fillRect(o, h - o - t, w - 2 * o, t);
    ctx.fillRect(o, o + t, t, h - 2 * o - 2 * t);
    ctx.fillRect(w - o - t, o + t, t, h - 2 * o - 2 * t);
  }
  ctx.globalAlpha = 1;
}

/** Which HUD numbers just changed, so their pulse plays. */
export interface HudChanges {
  readonly lines: boolean;
  readonly level: boolean;
}

const UNCHANGED: HudChanges = { lines: false, level: false };

/**
 * The HUD's numbers as shown: the score counts up to each new value and always ends on
 * it exactly; Lines and Level report each change once, for their pulse. With Effects
 * Off every number updates at once and nothing pulses. A new game shows its numbers at
 * once too.
 */
export class HudCount {
  private levelNow: EffectsLevel;
  private game: Game | null = null;
  private target = 0;
  private lines = 0;
  private levelShown = 0;
  private count: Tween | null = null;

  constructor(level: EffectsLevel = 'full') {
    this.levelNow = level;
  }

  get level(): EffectsLevel {
    return this.levelNow;
  }

  /** Change the level; Off ends a count-up now. */
  set level(level: EffectsLevel) {
    this.levelNow = level;
    if (level === 'off') this.count = null;
  }

  /** Catch up with `game`; returns what changed since the last call, once. */
  observe(game: Game): HudChanges {
    const s = game.state;
    if (game !== this.game) {
      this.game = game;
      this.target = s.score;
      this.lines = s.lines;
      this.levelShown = s.level;
      this.count = null;
      return UNCHANGED;
    }
    if (s.score !== this.target) {
      const from = this.score;
      this.target = s.score;
      this.count =
        this.levelNow === 'off' || s.score < from
          ? null
          : new Tween(from, s.score, COUNT_MS, easeOut);
    }
    const changes = { lines: s.lines !== this.lines, level: s.level !== this.levelShown };
    this.lines = s.lines;
    this.levelShown = s.level;
    return this.levelNow === 'off' ? UNCHANGED : changes;
  }

  /** Advance the count by `dt` ms, unless paused. */
  frame(dt: number, paused: boolean): void {
    if (paused || !this.count) return;
    if (!this.count.update(Math.min(MAX_FRAME_MS, Math.max(0, dt)))) this.count = null;
  }

  /** The score to show now. */
  get score(): number {
    return this.count ? Math.round(this.count.value) : this.target;
  }
}
