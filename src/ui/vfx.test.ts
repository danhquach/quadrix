import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/events.ts';
import { COLS, Game, ROWS } from '../core/game.ts';
import { MODES } from '../core/modes/index.ts';
import { cellsOf, type Kind } from '../core/pieces.ts';
import { Effects, type Effect, type EffectsLevel } from './effects.ts';
import { MAX_PARTICLES } from './particles.ts';
import { contrast } from './skin.ts';
import {
  Ambient,
  DUST_MAX,
  DUST_MIN,
  DropStreak,
  MAX_SPARKS,
  MOTES,
  PULSE_ALPHA,
  ROW_FLASH_MS,
  RING_MS,
  RING_RADIUS,
  RowBreak,
  SHAKE_MS,
  SHAKE_PX,
  SHIFT_MS,
  Shake,
  Shockwave,
  ambientColors,
  brightestAmbient,
  clearLook,
  drawBlockGlow,
  drawFreeze,
  hsl,
  over,
  rng,
  shatter,
  sparkCount,
  vfx,
  type VfxLook,
} from './vfx.ts';
import css from '../page.css?raw';

const PIECES = ['#00e5ff', '#ffd600', '#b84dff', '#2ee86a', '#ff2d55', '#2f6bff', '#ff8a00'];
const LOOK: VfxLook = { pieces: PIECES, flash: '#fff', light: '#ff0', dust: '#999' };

/** The custom properties set in page.css's `:root` block. */
const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!;
const vars = new Map([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]));
const v = (name: string) => vars.get(name)!;

/** A canvas stand-in recording rectangles, arcs and gradients with their opacity and colour. */
function stubCtx() {
  const rects: { x: number; y: number; w: number; h: number; alpha: number; color: unknown }[] = [];
  const arcs: { x: number; y: number; r: number; alpha: number }[] = [];
  const stops: [number, string][] = [];
  const ops: string[] = [];
  const ctx = {
    rects,
    arcs,
    stops,
    ops,
    fillStyle: '' as unknown,
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    globalCompositeOperation: 'source-over',
    save() {},
    restore() {},
    beginPath() {},
    stroke() {},
    arc(x: number, y: number, r: number) {
      arcs.push({ x, y, r, alpha: ctx.globalAlpha });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push(ctx.globalCompositeOperation);
      rects.push({ x, y, w, h, alpha: ctx.globalAlpha, color: ctx.fillStyle });
    },
    createLinearGradient() {
      return { addColorStop: (o: number, c: string) => stops.push([o, c]) };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D & typeof ctx;
}

const emptyBoard = () => Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));

/**
 * Set up a `kind` piece at rotation `rot` whose hard drop fills the rows it lands in:
 * those rows are full bar its cells. An I falls from the top (its slot is open above);
 * anything else starts on the floor, as it could not reach an overhang. Returns the rows.
 */
function setUpClear(g: Game, kind: Kind = 'T', rot = 0): number[] {
  g.state.board = emptyBoard();
  g.state.piece = { kind, rot, x: 3, y: 0 };
  const land = g.ghost();
  if (kind !== 'I') g.state.piece = land;
  const cells = cellsOf(kind, rot).map(([cx, cy]) => [land.x + cx, land.y + cy]);
  const rows = [...new Set(cells.map(([, y]) => y!))].sort((a, b) => a - b);
  for (const y of rows) {
    g.state.board[y] = Array.from({ length: COLS }, (_, x) =>
      cells.some(([cx, cy]) => cx === x && cy === y) ? 0 : 1 + (x % 7),
    );
  }
  return rows;
}

/** Effects at `level` running the visual effects, recording each effect started. */
function rig(level: EffectsLevel = 'full', seed = 1) {
  const fx = new Effects(level);
  const shake = new Shake(level);
  const ambient = new Ambient(level);
  const started: Effect[] = [];
  const add = fx.add.bind(fx);
  fx.add = (e) => {
    const ok = add(e);
    if (ok) started.push(e);
    return ok;
  };
  fx.use(vfx(LOOK, shake, ambient, rng(seed)));
  return { fx, shake, ambient, started };
}

/** Run `fx` for `ms` in 16 ms frames, as the page does (a frame steps 100 ms at most). */
function run(fx: Effects, ms: number): void {
  for (let t = 0; t < ms; t += 16) fx.frame(Math.min(16, ms - t), false);
}

/** Drop a set-up clear of `kind` at `rot` and return the events it reported. */
function dropClear(kind: Kind, rot: number, g = new Game(MODES.classic!, 1)): GameEvent[] {
  setUpClear(g, kind, rot);
  g.hardDrop();
  return g.takeEvents();
}

describe('clearLook', () => {
  it('scales from 1 to 4 lines: more particles, faster, a brighter flash', () => {
    const looks = [1, 2, 3, 4].map(clearLook);
    for (let i = 1; i < 4; i++) {
      expect(looks[i]!.perCell).toBeGreaterThan(looks[i - 1]!.perCell);
      expect(looks[i]!.speed).toBeGreaterThan(looks[i - 1]!.speed);
      expect(looks[i]!.flash).toBeGreaterThan(looks[i - 1]!.flash);
    }
    expect(looks[3]!.flash).toBeLessThanOrEqual(1);
  });

  it('holds odd counts to the 1 to 4 range', () => {
    expect(clearLook(0)).toEqual(clearLook(1));
    expect(clearLook(9)).toEqual(clearLook(4));
  });
});

describe('line clear', () => {
  /** Particles and the brightest flash after one clear of `kind`. */
  function clearOf(kind: Kind, rot: number) {
    const { fx, started } = rig();
    const events = dropClear(kind, rot);
    fx.handle(events);
    const lines = events.find((e) => e.type === 'clear');
    if (lines?.type !== 'clear') throw new Error('no clear');
    const flash = (started.find((e) => e instanceof RowBreak) as RowBreak).alpha;
    // The dust from the drop is in the pool already; count what the break adds.
    const before = fx.particles.count;
    run(fx, ROW_FLASH_MS);
    return { lines: lines.rows.length, flash, particles: fx.particles.count - before };
  }

  it('a quad is plainly bigger than a single: 4x the particles per cell and a brighter flash', () => {
    const single = clearOf('I', 0);
    const quad = clearOf('I', 1);
    expect(single.lines).toBe(1);
    expect(quad.lines).toBe(4);
    // 10 cells a row: 10 x 1 against 40 x 4.
    expect(single.particles).toBe(COLS);
    expect(quad.particles).toBe(4 * COLS * 4);
    expect(quad.flash).toBeGreaterThan(single.flash + 0.4);
  });

  it('each cell breaks into particles of its own colour', () => {
    const fx = new Effects('full');
    const colors = [[1, 2, 3, 4, 5, 6, 7, 1, 2, 3]];
    fx.add(new RowBreak([19], colors, LOOK, fx, rng(1)));
    run(fx, ROW_FLASH_MS);
    const ctx = stubCtx();
    fx.draw(ctx, 'effects', 1);
    expect(new Set(ctx.rects.map((r) => r.color))).toEqual(new Set(PIECES));
  });

  it('flashes the cleared rows white, fading, then is gone', () => {
    const fx = new Effects('full');
    const flash = new RowBreak([18, 19], [[], []], LOOK, fx, rng(1));
    const ctx = stubCtx();
    flash.draw(ctx, 10);
    expect(ctx.rects.map((r) => [r.y, r.w, r.color])).toEqual([
      [180, 100, '#fff'],
      [190, 100, '#fff'],
    ]);
    expect(ctx.rects[0]!.alpha).toBeCloseTo(clearLook(2).flash);
    expect(flash.update(ROW_FLASH_MS / 2)).toBe(true);
    expect(flash.alpha).toBeCloseTo(clearLook(2).flash / 2);
    expect(flash.update(ROW_FLASH_MS / 2)).toBe(false);
  });

  it('Reduced: no row flash (the stack has already dropped there) and no particles', () => {
    const { fx, started, ambient } = rig('reduced');
    fx.handle(dropClear('I', 1));
    expect(started.some((e) => e instanceof RowBreak)).toBe(false);
    run(fx, ROW_FLASH_MS);
    expect(fx.particles.count).toBe(0);
    // The ambient pulse, a fade, is Reduced's cue for the clear.
    expect(ambient.pulsing).toBeGreaterThan(0);
  });

  it('Off shows nothing', () => {
    const { fx, started } = rig('off');
    fx.handle(dropClear('I', 1));
    run(fx, ROW_FLASH_MS);
    expect(started).toEqual([]);
    expect(fx.particles.count).toBe(0);
  });
});

describe('quad and full clear', () => {
  it('a quad shakes the board and sends a shockwave from the cleared rows', () => {
    const { fx, started, shake } = rig();
    const events = dropClear('I', 1);
    fx.handle(events);
    const ring = started.find((e) => e instanceof Shockwave) as Shockwave;
    expect(ring).toBeDefined();
    const ctx = stubCtx();
    ring.update(1);
    ring.draw(ctx, 10);
    // Centred on the board's middle column and the cleared rows' middle (16..19).
    expect(ctx.arcs[0]!.x).toBe((COLS / 2) * 10);
    expect(ctx.arcs[0]!.y).toBe(18 * 10);
    shake.frame(10, false);
    expect(shake.offset()).not.toEqual([0, 0]);
  });

  it('a full clear that is not a quad shakes too', () => {
    const { fx, started, shake } = rig();
    // setUpClear leaves nothing else on the board: a T single is a full clear.
    const events = dropClear('T', 0);
    expect(events.some((e) => e.type === 'award' && e.fullClear)).toBe(true);
    fx.handle(events);
    expect(started.some((e) => e instanceof Shockwave)).toBe(true);
    shake.frame(10, false);
    expect(shake.offset()).not.toEqual([0, 0]);
  });

  it('a single that leaves blocks behind neither shakes nor rings', () => {
    const { fx, started, shake } = rig();
    const g = new Game(MODES.classic!, 1);
    setUpClear(g, 'I', 0);
    g.state.board[0]![0] = 1;
    g.hardDrop();
    fx.handle(g.takeEvents());
    expect(started.some((e) => e instanceof Shockwave)).toBe(false);
    shake.frame(10, false);
    expect(shake.offset()).toEqual([0, 0]);
  });

  it('Reduced: no shake and no shockwave', () => {
    const { fx, started, shake } = rig('reduced');
    fx.handle(dropClear('I', 1));
    shake.frame(10, false);
    expect(shake.offset()).toEqual([0, 0]);
    expect(started.some((e) => e instanceof Shockwave)).toBe(false);
  });

  it('the ring grows out to its radius and fades', () => {
    const ring = new Shockwave(5, 10, '#ff0');
    expect(ring.radius).toBe(0);
    expect(ring.update(RING_MS / 2)).toBe(true);
    expect(ring.radius).toBeGreaterThan(RING_RADIUS / 2);
    expect(ring.update(RING_MS / 2)).toBe(false);
    expect(ring.radius).toBe(RING_RADIUS);
  });
});

describe('Shake', () => {
  it(`never moves the board more than ${SHAKE_PX} px, and is still after ${SHAKE_MS} ms`, () => {
    const s = new Shake('full');
    s.kick();
    let most = 0;
    for (let t = 0; t < SHAKE_MS; t++) {
      const [x, y] = s.offset();
      most = Math.max(most, Math.hypot(x, y), Math.abs(x), Math.abs(y));
      s.frame(1, false);
    }
    expect(most).toBeGreaterThan(SHAKE_PX * 0.9);
    expect(most).toBeLessThanOrEqual(SHAKE_PX);
    expect(s.offset()).toEqual([0, 0]);
  });

  it('eases out: smaller towards its end', () => {
    const s = new Shake('full');
    s.kick();
    s.frame(SHAKE_MS * 0.8, false);
    expect(Math.hypot(...s.offset())).toBeLessThan(SHAKE_PX * 0.1);
  });

  it.each(['reduced', 'off'] as const)('never shakes on %s', (level) => {
    const s = new Shake(level);
    s.kick();
    s.frame(10, false);
    expect(s.offset()).toEqual([0, 0]);
  });

  it('stops at once when the level drops from Full', () => {
    const s = new Shake('full');
    s.kick();
    s.frame(10, false);
    s.level = 'reduced';
    expect(s.offset()).toEqual([0, 0]);
  });

  it('freezes while paused and clears for a new game', () => {
    const s = new Shake('full');
    s.kick();
    s.frame(20, false);
    const at = s.offset();
    s.frame(1000, true);
    expect(s.offset()).toEqual(at);
    s.clear();
    expect(s.offset()).toEqual([0, 0]);
  });
});

describe('hard drop', () => {
  it(`leaves a streak and a puff of ${DUST_MIN} to ${DUST_MAX} dust particles`, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { fx, started } = rig('full', seed);
      const g = new Game(MODES.classic!, seed);
      g.hardDrop();
      fx.handle(g.takeEvents());
      expect(started.filter((e) => e instanceof DropStreak)).toHaveLength(1);
      expect(fx.particles.count).toBeGreaterThanOrEqual(DUST_MIN);
      expect(fx.particles.count).toBeLessThanOrEqual(DUST_MAX);
    }
  });

  it('the streak runs from where the piece fell to where it landed', () => {
    const s = new DropStreak(
      [
        [4, 18],
        [4, 19],
      ],
      10,
      '#fff',
    );
    const ctx = stubCtx();
    s.draw(ctx, 10);
    const ys = ctx.rects.map((r) => r.y);
    expect(Math.min(...ys)).toBeCloseTo(80);
    expect(Math.max(...ctx.rects.map((r) => r.y + r.h))).toBeCloseTo(180);
    // Brightest next to the piece.
    expect(ctx.rects.at(-1)!.alpha).toBeGreaterThan(ctx.rects[0]!.alpha);
  });

  it('a drop of no distance leaves nothing', () => {
    const { fx, started } = rig();
    fx.handle([{ type: 'hardDrop', kind: 'O', fromY: 18, distance: 0, cells: [[4, 19]] }]);
    expect(started).toEqual([]);
    expect(fx.particles.count).toBe(0);
  });

  it('a drop landing above the board makes no dust', () => {
    const { fx } = rig();
    fx.handle([{ type: 'hardDrop', kind: 'O', fromY: -4, distance: 2, cells: [[4, -1]] }]);
    expect(fx.particles.count).toBe(0);
  });
});

describe('combo sparks', () => {
  it('grow with the combo, up to a cap', () => {
    for (let c = 2; c < 10; c++) expect(sparkCount(c)).toBeGreaterThanOrEqual(sparkCount(c - 1));
    expect(sparkCount(2)).toBeGreaterThan(sparkCount(1));
    expect(sparkCount(100)).toBe(MAX_SPARKS);
  });

  it('a combo throws its sparks along the cleared rows', () => {
    const { fx } = rig();
    const g = new Game(MODES.classic!, 1);
    fx.handle(dropClear('T', 0, g));
    run(fx, ROW_FLASH_MS);
    fx.particles.clear();
    const events = dropClear('T', 0, g);
    const award = events.find((e) => e.type === 'award');
    if (award?.type !== 'award') throw new Error('no award');
    expect(award.combo).toBe(1);
    // Only the hardDrop's dust and the award's sparks spawn at once; the break waits.
    fx.handle(events.filter((e) => e.type !== 'hardDrop'));
    expect(fx.particles.count).toBe(sparkCount(1));
  });
});

describe('the particle cap', () => {
  it('a quad, its hard drop and the longest combo in one frame all fit under the cap', () => {
    const { fx } = rig();
    let asked = 0;
    let refused = 0;
    const spawn = fx.spawn.bind(fx);
    fx.spawn = (spec) => {
      asked++;
      const ok = spawn(spec);
      if (!ok) refused++;
      return ok;
    };
    const events = dropClear('I', 1).map((e) => (e.type === 'award' ? { ...e, combo: 99 } : e));
    expect(events.map((e) => e.type)).toEqual(['hardDrop', 'lock', 'clear', 'award']);
    fx.handle(events);
    run(fx, 1000);
    // Dust, the most sparks, and the quad's break: 4 particles a cell, 40 cells.
    expect(asked).toBeGreaterThanOrEqual(DUST_MIN + MAX_SPARKS + 4 * 4 * COLS);
    expect(asked).toBeLessThanOrEqual(DUST_MAX + MAX_SPARKS + 4 * 4 * COLS);
    expect(asked).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(refused).toBe(0);
  });

  it('with the pool full, new particles are dropped, never queued for later', () => {
    const { fx } = rig();
    while (fx.particles.spawn({ color: '#fff', life: 200 }));
    expect(fx.particles.count).toBe(MAX_PARTICLES);
    fx.handle(dropClear('I', 1));
    run(fx, 1000);
    expect(fx.particles.count).toBe(0);
  });
});

describe('block glow', () => {
  it('draws one wider square per locked cell in its colour, skipping the rows asked', () => {
    const board = emptyBoard();
    board[19]![0] = 1;
    board[19]![1] = 3;
    board[18]![5] = 2;
    const ctx = stubCtx();
    drawBlockGlow(
      ctx,
      10,
      board,
      PIECES,
      (y) => (y === 19 ? -5 : 0),
      (y) => y === 18,
    );
    expect(ctx.rects.map((r) => [r.x, r.y, r.color])).toEqual([
      [-1.5, 183.5, PIECES[0]],
      [8.5, 183.5, PIECES[2]],
    ]);
    expect(ctx.rects.every((r) => r.w === 13 && r.alpha < 0.3)).toBe(true);
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe('ambient background', () => {
  const levels = Array.from({ length: 40 }, (_, i) => i + 1);

  it.each(['--text', '--muted', '--accent'])(
    'keeps %s at WCAG AA (4.5:1) on its brightest, at every level',
    (name) => {
      for (const level of levels) {
        expect(contrast(v(name), brightestAmbient(level))).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('stays dim enough that every piece still reads (3:1) on it, at every level', () => {
    for (const level of levels) {
      for (const name of [...vars.keys()].filter((k) => k.startsWith('--piece-'))) {
        expect(contrast(v(name), brightestAmbient(level))).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('shifts colour each level', () => {
    for (let level = 2; level <= 12; level++) {
      expect(ambientColors(level).band).not.toBe(ambientColors(level - 1).band);
    }
  });

  it('cross-fades to the new level over its shift', () => {
    const a = new Ambient('full');
    a.setLevel(2);
    expect(a.colors.band).toBe(ambientColors(1).band);
    a.frame(SHIFT_MS / 2, false);
    expect(a.colors.band).not.toBe(ambientColors(1).band);
    expect(a.colors.band).not.toBe(ambientColors(2).band);
    for (let t = 0; t < SHIFT_MS; t += 100) a.frame(100, false);
    expect(a.colors).toEqual(ambientColors(2));
  });

  it('pulses on a clear, stronger for more lines, then settles', () => {
    const a = new Ambient('full');
    a.pulse(1);
    const one = a.pulsing;
    a.pulse(4);
    expect(a.pulsing).toBe(PULSE_ALPHA);
    expect(one).toBeLessThan(PULSE_ALPHA);
    for (let t = 0; t < 1000; t += 50) a.frame(50, false);
    expect(a.pulsing).toBe(0);
  });

  it('any clear pulses it', () => {
    const { fx, ambient } = rig();
    fx.handle(dropClear('T', 0));
    expect(ambient.pulsing).toBeGreaterThan(0);
  });

  it('Full draws the gradient and the motes', () => {
    const ctx = stubCtx();
    new Ambient('full').draw(ctx, 10);
    expect(ctx.stops.map(([, c]) => c)).toEqual([
      ambientColors(1).base,
      ambientColors(1).band,
      ambientColors(1).base,
    ]);
    expect(ctx.rects).toHaveLength(1 + MOTES);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('Reduced draws a still gradient with no motes; Off draws nothing', () => {
    const reduced = new Ambient('reduced');
    const ctx = stubCtx();
    reduced.draw(ctx, 10);
    expect(ctx.rects).toHaveLength(1);
    const before = ctx.stops.slice();
    reduced.frame(5000, false);
    reduced.draw(ctx, 10);
    expect(ctx.stops.slice(3)).toEqual(before);
    const off = stubCtx();
    new Ambient('off').draw(off, 10);
    expect(off.rects).toEqual([]);
  });

  it('clears back to level 1 with no pulse, for a new game', () => {
    const a = new Ambient('full');
    a.setLevel(5);
    a.pulse(4);
    a.clear();
    expect(a.pulsing).toBe(0);
    expect(a.colors).toEqual(ambientColors(1));
    a.setLevel(1);
    expect(a.colors).toEqual(ambientColors(1));
  });

  it('freezes while paused', () => {
    const a = new Ambient('full');
    a.pulse(4);
    a.frame(100, true);
    expect(a.pulsing).toBe(PULSE_ALPHA);
  });
});

describe('colour helpers', () => {
  it('hsl gives the expected hex', () => {
    expect(hsl(0, 1, 0.5)).toBe('#ff0000');
    expect(hsl(120, 1, 0.25)).toBe('#008000');
    expect(hsl(240, 0, 0)).toBe('#000000');
  });

  it('over blends a colour onto another', () => {
    expect(over('#ffffff', 0.5, '#000000')).toBe('#808080');
    expect(over('#ff0000', 1, '#00ff00')).toBe('#ff0000');
    expect(over('#ff0000', 0, '#00ff00')).toBe('#00ff00');
  });
});

describe('Override freeze (#27)', () => {
  it('desaturates then washes the board blue, by amount', () => {
    const ctx = stubCtx();
    drawFreeze(ctx, 10, 0.5, '#2f6bff');
    expect(ctx.ops).toEqual(['saturation', 'source-over']);
    expect(ctx.rects[1]!.color).toBe('#2f6bff');
    expect(ctx.rects[1]!.alpha).toBeLessThan(ctx.rects[0]!.alpha);
    const none = stubCtx();
    drawFreeze(none, 10, 0, '#2f6bff');
    expect(none.rects).toEqual([]);
  });

  it('shatters every locked cell at once, within the particle cap', () => {
    const fx = new Effects('full');
    const board = emptyBoard();
    board[19] = Array<number>(COLS).fill(3);
    expect(shatter(fx, board, PIECES, rng(1))).toBe(COLS);
    // Near the cap already: a full board's shatter fills it and drops the rest.
    while (fx.particles.count < MAX_PARTICLES - 50) fx.particles.spawn({ color: '#fff' });
    const full = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(1));
    expect(shatter(fx, full, PIECES, rng(1))).toBe(50);
    expect(fx.particles.count).toBe(MAX_PARTICLES);
  });

  it('a shatter is Full only', () => {
    const fx = new Effects('reduced');
    const board = emptyBoard();
    board[19] = Array<number>(COLS).fill(3);
    expect(shatter(fx, board, PIECES, rng(1))).toBe(0);
  });
});

describe('rng', () => {
  it('is seeded: the same seed gives the same run, in [0, 1)', () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
