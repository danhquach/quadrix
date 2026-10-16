import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/events.ts';
import { COLS, Game, ROWS } from '../core/game.ts';
import { MODES } from '../core/modes/index.ts';
import { cellsOf } from '../core/pieces.ts';
import { Effects, type Effect, type EffectsLevel } from './effects.ts';
import {
  COUNT_MS,
  COVER_FADE_MS,
  COVER_MS,
  DANGER_MAX,
  DANGER_MIN,
  DANGER_PERIOD_MS,
  DANGER_ROWS,
  FLASH_MS,
  FloatText,
  FrameLight,
  HudCount,
  LEVEL_MS,
  LockFlash,
  MAX_POPUP_SCALE,
  POPUP_MS,
  Danger,
  covers,
  drawGlow,
  edgePoint,
  feedback,
  inDanger,
  placeX,
  popupScale,
  type FeedbackLook,
  type Span,
} from './feedback.ts';

const LOOK: FeedbackLook = {
  font: 'sans-serif',
  text: '#ff0',
  outline: '#000',
  flash: '#fff',
  light: '#ff0',
};

/** A canvas stand-in recording the rectangles filled and the text written, with their opacity. */
function stubCtx() {
  const rects: { x: number; y: number; w: number; h: number; alpha: number }[] = [];
  const texts: { text: string; x: number; y: number; alpha: number }[] = [];
  const ctx = {
    rects,
    texts,
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    font: '',
    lineWidth: 1,
    lineJoin: 'miter',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save() {},
    restore() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, alpha: ctx.globalAlpha });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, alpha: ctx.globalAlpha });
    },
    strokeText() {},
  };
  return ctx as unknown as CanvasRenderingContext2D & typeof ctx;
}

const emptyBoard = () => Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));

/** Put the piece on the floor with the rows it covers full bar its cells: a drop clears them. */
function setUpClear(g: Game): number[] {
  g.state.board = emptyBoard();
  const land = g.ghost();
  g.state.piece = land;
  const cells = cellsOf(land.kind, land.rot).map(([cx, cy]) => [land.x + cx, land.y + cy]);
  const rows = [...new Set(cells.map(([, y]) => y!))].sort((a, b) => a - b);
  for (const y of rows) {
    g.state.board[y] = Array.from({ length: COLS }, (_, x) =>
      cells.some(([cx, cy]) => cx === x && cy === y) ? 0 : 1,
    );
  }
  return rows;
}

/** The falling piece's columns. */
function spanOf(g: Game): Span | null {
  if (g.state.over) return null;
  const p = g.state.piece;
  const xs = cellsOf(p.kind, p.rot).map(([x]) => p.x + x);
  return [Math.min(...xs), Math.max(...xs) + 1];
}

/**
 * Effects at `level` running the feedback for `g`, recording every effect it starts and
 * which of them drew since `drawn` was last cleared.
 */
function watch(g: Game, level: EffectsLevel = 'full') {
  const fx = new Effects(level);
  const started: Effect[] = [];
  const drawn = new Set<Effect>();
  fx.use(feedback(LOOK, () => spanOf(g)));
  const add = fx.add.bind(fx);
  fx.add = (e) => {
    const ok = add(e);
    if (ok) {
      started.push(e);
      const draw = e.draw.bind(e);
      e.draw = (ctx, cell) => {
        drawn.add(e);
        draw(ctx, cell);
      };
    }
    return ok;
  };
  return { fx, started, drawn };
}

const kinds = (effects: Effect[]) => effects.map((e) => e.constructor.name);

describe('placeX and covers', () => {
  it('sits beside the piece when there is room, as near the start as it can', () => {
    // Piece in columns 3–6: room for 3 cells either side.
    expect(placeX(2, 5.5, [3, 7])).toBe(8);
    expect(placeX(2, 4, [3, 7])).toBe(2);
    expect(covers(placeX(3, 5, [3, 7]), 3, [3, 7])).toBe(false);
    expect(covers(placeX(3, 0, [3, 7]), 3, [3, 7])).toBe(false);
  });

  it('with no room beside the piece, or no piece, stays on the board near the start', () => {
    expect(placeX(5, 5, [3, 7])).toBe(5);
    expect(placeX(4, 0, null)).toBe(2);
    expect(placeX(4, COLS, null)).toBe(COLS - 2);
    expect(placeX(20, 3, null)).toBe(COLS / 2);
  });

  it('covers only when the text and the columns overlap', () => {
    expect(covers(1.5, 3, [3, 7])).toBe(false);
    expect(covers(1.6, 3, [3, 7])).toBe(true);
    expect(covers(8.5, 3, [3, 7])).toBe(false);
    expect(covers(8.4, 3, [3, 7])).toBe(true);
    expect(covers(5, 3, null)).toBe(false);
  });
});

describe('popupScale', () => {
  it('is 1 for a single and grows with the play, capped', () => {
    for (const level of [1, 5, 15]) {
      expect(popupScale(100 * level, level)).toBe(1);
      expect(popupScale(0, level)).toBe(1);
      const sizes = [100, 300, 500, 800, 1200, 2800].map((p) => popupScale(p * level, level));
      for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!);
      expect(popupScale(1e9, level)).toBe(MAX_POPUP_SCALE);
    }
  });
});

describe('feedback source: each event its effect, once', () => {
  it('a clear that levels up: one flash, one popup, one frame light, one banner', () => {
    const g = new Game(MODES.classic!, 3);
    g.state.lines = 9;
    setUpClear(g);
    const { fx, started } = watch(g);
    g.hardDrop();
    fx.handle(g.takeEvents());
    expect(kinds(started)).toEqual(['LockFlash', 'FloatText', 'FrameLight', 'FloatText']);
    // Nothing more on later frames or an empty batch.
    fx.frame(16, false);
    fx.handle(g.takeEvents());
    expect(started).toHaveLength(4);
  });

  it('a lock that scores nothing only flashes', () => {
    const g = new Game(MODES.classic!, 3);
    const { fx, started } = watch(g);
    g.hardDrop();
    fx.handle(g.takeEvents());
    expect(kinds(started)).toEqual(['LockFlash']);
  });

  it('the popup shows the points, then the labels, larger for bigger plays', () => {
    const g = new Game(MODES.classic!, 3);
    const { fx, started } = watch(g);
    setUpClear(g);
    g.hardDrop();
    const events = g.takeEvents();
    fx.handle(events);
    const award = events.find((e) => e.type === 'award')!;
    if (award.type !== 'award') throw new Error('no award');
    const popup = started[1]!;
    const ctx = stubCtx();
    fx.frame(POPUP_MS / 3, false);
    popup.draw(ctx, 10);
    expect(ctx.texts.map((t) => t.text)).toEqual([`+${award.points}`, ...award.labels]);
    expect(ctx.font).toMatch(/^700 \d+px sans-serif$/);
  });

  it('the popup starts at the cleared rows and floats up on Full only', () => {
    for (const level of ['full', 'reduced'] as const) {
      const g = new Game(MODES.classic!, 3);
      const { fx, started } = watch(g, level);
      const rows = setUpClear(g);
      g.hardDrop();
      fx.handle(g.takeEvents());
      const popup = started.find((e) => e instanceof FloatText)!;
      const at = (ms: number) => {
        for (let t = 0; t < ms; t += 10) fx.frame(10, false);
        const ctx = stubCtx();
        popup.draw(ctx, 1);
        return ctx.texts[0]!.y;
      };
      const start = at(0);
      const mid = rows.reduce((a, b) => a + b, 0) / rows.length + 0.5;
      expect(Math.abs(start - mid)).toBeLessThan(2);
      const later = at(POPUP_MS / 2);
      if (level === 'full') expect(later).toBeLessThan(start - 1);
      else expect(later).toBe(start);
    }
  });

  it('Reduced keeps the flash, popup and banner but not the running light', () => {
    const g = new Game(MODES.classic!, 3);
    g.state.lines = 9;
    setUpClear(g);
    const { fx, started } = watch(g, 'reduced');
    g.hardDrop();
    fx.handle(g.takeEvents());
    expect(kinds(started)).toEqual(['LockFlash', 'FloatText', 'FloatText']);
  });

  it('Off starts nothing at all', () => {
    const g = new Game(MODES.classic!, 3);
    g.state.lines = 9;
    setUpClear(g);
    const { fx, started } = watch(g, 'off');
    g.hardDrop();
    fx.handle(g.takeEvents());
    expect(started).toEqual([]);
  });

  it('the banner names the new level', () => {
    const fx = new Effects();
    const started: Effect[] = [];
    fx.use(feedback(LOOK, () => null));
    const add = fx.add.bind(fx);
    fx.add = (e) => (started.push(e), add(e));
    const up: GameEvent = { type: 'levelUp', from: 4, level: 5 };
    fx.handle([up]);
    const banner = started.find((e) => e instanceof FloatText)!;
    fx.frame(LEVEL_MS / 2, false);
    const ctx = stubCtx();
    banner.draw(ctx, 10);
    expect(ctx.texts.map((t) => t.text)).toEqual(['Level 5']);
  });
});

describe('popups never cover the falling piece for more than COVER_MS', () => {
  const lines = [{ text: '+800', size: 1 }];

  it('away from the piece it lives its whole life', () => {
    const t = new FloatText(lines, [1, 10], 1, POPUP_MS, LOOK, () => [5, 9]);
    let ms = 0;
    while (t.update(10)) ms += 10;
    expect(ms + 10).toBe(POPUP_MS);
    expect(t.covered).toBe(0);
  });

  it('over the piece the whole time, it is gone within COVER_MS, fading as it goes', () => {
    const t = new FloatText(lines, [5, 10], 1, POPUP_MS, LOOK, () => [0, COLS]);
    let ms = 0;
    while (t.update(16)) {
      ms += 16;
      expect(t.alpha).toBeLessThanOrEqual(Math.min(1, (COVER_MS - t.covered) / COVER_FADE_MS));
    }
    expect(ms).toBeLessThan(COVER_MS);
    expect(t.covered).toBeGreaterThanOrEqual(COVER_MS);
  });

  it('over the piece it holds full strength, then fades over the last COVER_FADE_MS', () => {
    let over = false;
    const t = new FloatText(lines, [5, 10], 0, 10_000, LOOK, () => (over ? [0, COLS] : null));
    // Past its fade-in first.
    t.update(2000);
    expect(t.alpha).toBe(1);
    over = true;
    while (t.covered < COVER_MS - COVER_FADE_MS) {
      expect(t.alpha).toBe(1);
      t.update(10);
    }
    let last = t.alpha;
    while (t.update(10)) {
      expect(t.alpha).toBeLessThan(last);
      last = t.alpha;
    }
    expect(last).toBeLessThan(0.15);
  });

  it('time over the piece adds up across separate passes', () => {
    let over = false;
    const t = new FloatText(lines, [5, 10], 0, 10_000, LOOK, () => (over ? [4, 6] : null));
    for (let i = 0; i < 10; i++) {
      over = !over;
      t.update(50);
    }
    expect(t.covered).toBe(250);
    over = true;
    expect(t.update(40)).toBe(true);
    expect(t.update(10)).toBe(false);
  });

  it('in play, chasing every popup with the piece: visible over its column 300 ms at most', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = new Game(MODES.classic!, seed);
      g.state.lines = 9;
      const { fx, started, drawn } = watch(g);
      const coveredMs = new Map<Effect, number>();
      for (let round = 0; round < 3; round++) {
        setUpClear(g);
        g.hardDrop();
        fx.handle(g.takeEvents());
        for (let frame = 0; frame < 120; frame++) {
          // Steer the piece under the newest text, frame by frame.
          const texts = started.filter((e): e is FloatText => e instanceof FloatText);
          const target = texts.at(-1)!;
          const span = spanOf(g)!;
          const mid = (span[0] + span[1]) / 2;
          if (Math.abs(mid - target.x) >= 1) g.move(mid < target.x ? 1 : -1);
          fx.handle(g.takeEvents());
          fx.frame(16, false);
          // What is drawn this frame, and whether it is over the piece now.
          drawn.clear();
          fx.draw(stubCtx(), 'effects', 10);
          for (const t of texts) {
            if (drawn.has(t) && t.alpha > 0 && covers(t.x, t.width, spanOf(g))) {
              coveredMs.set(t, (coveredMs.get(t) ?? 0) + 16);
            }
          }
        }
      }
      // The chase does reach the texts: some are cut short by the cap.
      expect(Math.max(...coveredMs.values())).toBeGreaterThan(COVER_MS - 32);
      for (const ms of coveredMs.values()) expect(ms).toBeLessThanOrEqual(COVER_MS);
    }
  });
});

describe('LockFlash', () => {
  it('flashes the cells on the board for FLASH_MS, then ends', () => {
    const f = new LockFlash(
      [
        [4, -1],
        [4, 0],
        [5, 0],
      ],
      '#fff',
    );
    const ctx = stubCtx();
    f.draw(ctx, 10);
    expect(ctx.rects.map((r) => [r.x, r.y])).toEqual([
      [40, 0],
      [50, 0],
    ]);
    expect(ctx.rects[0]!.alpha).toBeGreaterThan(0.5);
    expect(f.update(FLASH_MS - 1)).toBe(true);
    expect(f.update(1)).toBe(false);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe('FrameLight', () => {
  it('runs once round the edge in LEVEL_MS, inside the board', () => {
    const light = new FrameLight('#ff0');
    let ms = 0;
    do {
      const ctx = stubCtx();
      light.draw(ctx, 10);
      for (const r of ctx.rects) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(COLS * 10);
        expect(r.y + r.h).toBeLessThanOrEqual(ROWS * 10);
      }
      ms += 10;
    } while (light.update(10));
    expect(ms).toBe(LEVEL_MS);
  });

  it('edgePoint walks the edge clockwise from the top left', () => {
    expect(edgePoint(0)).toEqual([0, 0]);
    expect(edgePoint(COLS)).toEqual([COLS, 0]);
    expect(edgePoint(COLS + ROWS)).toEqual([COLS, ROWS]);
    expect(edgePoint(2 * COLS + ROWS)).toEqual([0, ROWS]);
    expect(edgePoint(2 * (COLS + ROWS))).toEqual([0, 0]);
    expect(edgePoint(-1)).toEqual([0, 1]);
  });
});

describe('danger', () => {
  it('switches at exactly the DANGER_ROWS line', () => {
    const board = emptyBoard();
    expect(inDanger(board)).toBe(false);
    board[DANGER_ROWS]![0] = 1;
    expect(inDanger(board)).toBe(false);
    board[DANGER_ROWS - 1]![9] = 1;
    expect(inDanger(board)).toBe(true);
    board[DANGER_ROWS - 1]![9] = 0;
    expect(inDanger(board)).toBe(false);
    board[0]![5] = 1;
    expect(inDanger(board)).toBe(true);
  });

  it('in play: a clear that drops the stack below the line turns it off', () => {
    const g = new Game(MODES.classic!, 2);
    const rows = setUpClear(g);
    // One block on the line's last row, clear of the piece's rows.
    g.state.board[DANGER_ROWS - 1]![0] = 1;
    expect(rows.every((y) => y > DANGER_ROWS)).toBe(true);
    expect(inDanger(g.state.board)).toBe(true);
    g.hardDrop();
    expect(g.state.board[DANGER_ROWS - 1 + rows.length]![0]).toBe(1);
    expect(inDanger(g.state.board)).toBe(false);
  });

  it('Full pulses slowly between its dimmest and brightest; pausing freezes it', () => {
    const d = new Danger('full');
    expect(d.alpha).toBe(0);
    d.set(true);
    expect(d.alpha).toBeCloseTo(DANGER_MIN);
    for (let i = 0; i < 10; i++) d.frame(DANGER_PERIOD_MS / 20, false);
    expect(d.alpha).toBeCloseTo(DANGER_MAX);
    d.frame(DANGER_PERIOD_MS / 4, true);
    expect(d.alpha).toBeCloseTo(DANGER_MAX);
    d.set(false);
    expect(d.alpha).toBe(0);
    // On again: from its dimmest.
    d.set(true);
    expect(d.alpha).toBeCloseTo(DANGER_MIN);
  });

  it('Reduced holds steady; Off never shows', () => {
    const r = new Danger('reduced');
    r.set(true);
    for (let i = 0; i < 5; i++) {
      r.frame(97, false);
      expect(r.alpha).toBe(DANGER_MAX);
    }
    const o = new Danger('off');
    o.set(true);
    o.frame(400, false);
    expect(o.alpha).toBe(0);
  });

  it('the glow draws inside the board, and nothing at alpha 0', () => {
    const ctx = stubCtx();
    drawGlow(ctx, 10, 0, '#f00');
    expect(ctx.rects).toEqual([]);
    drawGlow(ctx, 10, 0.5, '#f00');
    expect(ctx.rects.length).toBeGreaterThan(0);
    for (const r of ctx.rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(COLS * 10);
      expect(r.y + r.h).toBeLessThanOrEqual(ROWS * 10);
      expect(r.alpha).toBeLessThanOrEqual(0.5);
    }
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe('HudCount', () => {
  it('counts up and always ends on the exact score, whatever the frames', () => {
    const g = new Game(MODES.classic!, 1);
    const hud = new HudCount('full');
    hud.observe(g);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 100;
    for (let i = 0; i < 50; i++) {
      g.state.score += Math.floor(rand() * 37) + 1;
      hud.observe(g);
      let shown = hud.score;
      // A new value can arrive mid-count, at any frame length, sometimes a clamped one.
      for (let ms = 0; ms < COUNT_MS * (i % 3 === 0 ? 0.5 : 1.2);) {
        const dt = i % 5 === 0 ? 250 : 1 + rand() / 5;
        hud.frame(dt, false);
        ms += dt;
        expect(hud.score).toBeGreaterThanOrEqual(shown);
        expect(hud.score).toBeLessThanOrEqual(g.state.score);
        shown = hud.score;
      }
    }
    for (let ms = 0; ms < COUNT_MS; ms += 16) hud.frame(16, false);
    expect(hud.score).toBe(g.state.score);
  });

  it('counts from where it shows to the new value', () => {
    const g = new Game(MODES.classic!, 1);
    const hud = new HudCount('full');
    hud.observe(g);
    g.state.score = 1000;
    hud.observe(g);
    expect(hud.score).toBe(0);
    hud.frame(COUNT_MS / 4, false);
    const part = hud.score;
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(1000);
    hud.frame(COUNT_MS, true);
    expect(hud.score).toBe(part);
    for (let ms = 0; ms < COUNT_MS; ms += 50) hud.frame(50, false);
    expect(hud.score).toBe(1000);
  });

  it('pulses Lines and Level once per change', () => {
    const g = new Game(MODES.classic!, 1);
    const hud = new HudCount('full');
    expect(hud.observe(g)).toEqual({ lines: false, level: false });
    g.state.lines = 9;
    setUpClear(g);
    g.hardDrop();
    expect(hud.observe(g)).toEqual({ lines: true, level: true });
    expect(hud.observe(g)).toEqual({ lines: false, level: false });
    setUpClear(g);
    g.hardDrop();
    expect(hud.observe(g)).toEqual({ lines: true, level: false });
  });

  it('Off: the numbers update at once and nothing pulses', () => {
    const g = new Game(MODES.classic!, 1);
    const hud = new HudCount('off');
    hud.observe(g);
    setUpClear(g);
    g.hardDrop();
    expect(hud.observe(g)).toEqual({ lines: false, level: false });
    expect(hud.score).toBe(g.state.score);
    // Switching to Off mid-count lands on the score at once.
    const h = new HudCount('full');
    h.observe(g);
    g.state.score += 500;
    h.observe(g);
    expect(h.score).toBeLessThan(g.state.score);
    h.level = 'off';
    expect(h.score).toBe(g.state.score);
  });

  it('a new game shows its numbers at once, with no pulse', () => {
    const g = new Game(MODES.classic!, 1);
    const hud = new HudCount('full');
    hud.observe(g);
    g.state.score = 5000;
    hud.observe(g);
    const next = new Game(MODES.classic!, 2);
    next.state.lines = 3;
    expect(hud.observe(next)).toEqual({ lines: false, level: false });
    expect(hud.score).toBe(0);
    g.state.score = 777;
    hud.observe(g);
    expect(hud.score).toBe(777);
  });
});
