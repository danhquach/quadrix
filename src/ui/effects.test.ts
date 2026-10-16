import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS } from '../core/game.ts';
import { MODES } from '../core/modes/index.ts';
import { cellsOf } from '../core/pieces.ts';
import { MAX_EFFECTS, MAX_FRAME_MS, Effects, type Effect, type Layer } from './effects.ts';
import { MAX_PARTICLES } from './particles.ts';
import { Tween, linear } from './tween.ts';

/** A canvas stand-in: every call the effects make is a cheap no-op. */
function stubCtx(): CanvasRenderingContext2D & { fills: number } {
  const ctx = {
    fills: 0,
    fillStyle: '',
    globalAlpha: 1,
    fillRect() {
      ctx.fills++;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D & { fills: number };
}

/** A fade (or, with `motion`, a move) driven by a tween, recording what it draws. */
function fade(layer: Layer = 'effects', motion = false, ms = 100) {
  const tween = new Tween(1, 0, ms, linear);
  const drawn: number[] = [];
  const effect: Effect = {
    layer,
    motion,
    update: (dt) => tween.update(dt),
    draw: () => void drawn.push(tween.value),
  };
  return { effect, tween, drawn };
}

/** Put the piece on the floor with the rows it covers full bar its cells: a drop clears them. */
function setUpClear(g: Game): void {
  g.state.board = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
  const land = g.ghost();
  g.state.piece = land;
  const cells = cellsOf(land.kind, land.rot).map(([cx, cy]) => [land.x + cx, land.y + cy]);
  for (const y of new Set(cells.map(([, y]) => y!))) {
    g.state.board[y] = Array.from({ length: COLS }, (_, x) =>
      cells.some(([cx, cy]) => cx === x && cy === y) ? 0 : 1,
    );
  }
}

/** A heavy source: a burst of particles from every cleared cell, a fade per row. */
function burst(fx: Effects): void {
  fx.use((event, fx) => {
    if (event.type !== 'clear') return;
    for (const y of event.rows) {
      fx.add(fade('board').effect);
      for (let x = 0; x < COLS; x++) {
        for (let i = 0; i < 12; i++) {
          fx.spawn({ x, y, vx: i - 6, vy: -i, gravity: 20, color: '#fff', life: 600 });
        }
      }
    }
  });
}

describe('Effects levels', () => {
  it('Off: no source hears an event, and nothing starts', () => {
    const fx = new Effects('off');
    let heard = 0;
    fx.use(() => heard++);
    fx.handle([{ type: 'over' }]);
    expect(heard).toBe(0);
    expect(fx.add(fade().effect)).toBe(false);
    expect(fx.spawn({ color: '#fff' })).toBe(false);
    const ctx = stubCtx();
    for (const layer of ['background', 'board', 'effects'] as const) fx.draw(ctx, layer, 10);
    expect(ctx.fills).toBe(0);
  });

  it('Reduced: short fades only, no particles or motion', () => {
    const fx = new Effects('reduced');
    let heard = 0;
    fx.use(() => heard++);
    fx.handle([{ type: 'over' }]);
    expect(heard).toBe(1);
    expect(fx.add(fade('board', false).effect)).toBe(true);
    expect(fx.add(fade('board', true).effect)).toBe(false);
    expect(fx.spawn({ color: '#fff' })).toBe(false);
    expect(fx.particles.count).toBe(0);
  });

  it('Full: everything', () => {
    const fx = new Effects('full');
    expect(fx.add(fade('board', false).effect)).toBe(true);
    expect(fx.add(fade('board', true).effect)).toBe(true);
    expect(fx.spawn({ color: '#fff' })).toBe(true);
  });

  it('lowering the level stops what it no longer allows, at once', () => {
    const fx = new Effects('full');
    fx.add(fade('board', false).effect);
    fx.add(fade('board', true).effect);
    fx.spawn({ color: '#fff' });
    fx.level = 'reduced';
    expect(fx.active).toBe(1);
    expect(fx.particles.count).toBe(0);
    fx.level = 'off';
    expect(fx.active).toBe(0);
  });

  it('runs at most MAX_EFFECTS at once', () => {
    const fx = new Effects('full');
    for (let i = 0; i < MAX_EFFECTS * 2; i++) fx.add(fade().effect);
    expect(fx.active).toBe(MAX_EFFECTS);
  });
});

describe('Effects frames and layers', () => {
  it('finished effects go; each draws only on its own layer', () => {
    const fx = new Effects();
    const a = fade('background', false, 50);
    const b = fade('board', false, 200);
    fx.add(a.effect);
    fx.add(b.effect);
    fx.draw(stubCtx(), 'background', 10);
    expect(a.drawn).toHaveLength(1);
    expect(b.drawn).toHaveLength(0);
    fx.frame(60, false);
    expect(fx.active).toBe(1);
    fx.draw(stubCtx(), 'background', 10);
    expect(a.drawn).toHaveLength(1);
  });

  it('particles draw on the effects layer only', () => {
    const fx = new Effects();
    fx.spawn({ color: '#fff' });
    const under = stubCtx();
    fx.draw(under, 'background', 10);
    fx.draw(under, 'board', 10);
    expect(under.fills).toBe(0);
    const over = stubCtx();
    fx.draw(over, 'effects', 10);
    expect(over.fills).toBe(1);
  });

  it('a long frame (back from a hidden tab) advances at most MAX_FRAME_MS', () => {
    const fx = new Effects();
    const { effect, tween } = fade('effects', false, 1000);
    fx.add(effect);
    fx.frame(60_000, false);
    expect(tween.progress).toBeCloseTo(MAX_FRAME_MS / 1000);
  });

  it('pausing freezes effects and particles mid-animation; resuming continues them', () => {
    const fx = new Effects();
    const { effect, tween } = fade('effects', false, 200);
    fx.add(effect);
    fx.spawn({ x: 0, y: 0, vx: 4, color: '#fff', life: 400 });
    fx.frame(50, false);
    const value = tween.value;
    const at = () => {
      const rects: number[] = [];
      fx.particles.draw(
        {
          fillStyle: '',
          globalAlpha: 1,
          fillRect: (x) => void rects.push(x),
        },
        10,
      );
      return rects[0];
    };
    const x = at();
    for (let i = 0; i < 100; i++) fx.frame(16.7, true);
    expect(tween.value).toBe(value);
    expect(at()).toBe(x);
    expect(fx.active).toBe(1);
    expect(fx.particles.count).toBe(1);
    // Resumed: it carries on from where it stopped and finishes on time.
    fx.frame(50, false);
    expect(tween.progress).toBeCloseTo(0.5);
    expect(at()).toBeGreaterThan(x!);
    fx.frame(100, false);
    expect(fx.active).toBe(0);
  });

  it('clear stops everything for a new game', () => {
    const fx = new Effects();
    fx.add(fade().effect);
    fx.spawn({ color: '#fff' });
    fx.clear();
    expect(fx.active).toBe(0);
    expect(fx.particles.count).toBe(0);
  });
});

describe('effects never touch the game', () => {
  /** A seeded run of drops and clears, with its events going to `fx` (or nowhere). */
  function play(fx: Effects | null) {
    const g = new Game(MODES.classic!, 11);
    for (let i = 0; i < 300 && !g.state.over; i++) {
      if (i % 3 === 0) g.rotate();
      g.move((i % 7) - 3);
      if (i % 2 === 0) setUpClear(g);
      g.hardDrop();
      if (fx) {
        fx.handle(g.takeEvents());
        fx.frame(16.7, false);
        for (const layer of ['background', 'board', 'effects'] as const)
          fx.draw(stubCtx(), layer, 10);
      }
    }
    return { state: g.state, save: g.save(), award: g.award, locks: g.locks };
  }

  it('the game state is identical with effects Full, Reduced, Off or none', () => {
    const none = play(null);
    for (const level of ['full', 'reduced', 'off'] as const) {
      const fx = new Effects(level);
      burst(fx);
      expect(play(fx)).toEqual(none);
    }
  });
});

describe('stress', () => {
  // CPU time only: the canvas is a stub, so real fill cost is not in it. A few frames
  // warm up first, so start-up compiling doesn't count as a dropped frame. Wall-clock
  // time: with every test file running at once the OS can stall one frame (seen: 33 ms
  // once in six full runs), so a run gets two retries. A slow frame loop fails all three.
  it(
    '1000 frames of nonstop clears: never over 300 particles, every frame under 16.7 ms',
    { retry: 2 },
    () => {
      const fx = new Effects('full');
      burst(fx);
      const g = new Game(MODES.classic!, 3);
      const ctx = stubCtx();
      let worst = 0;
      let peak = 0;
      let clears = 0;
      for (let frame = -20; frame < 1000; frame++) {
        const start = performance.now();
        setUpClear(g);
        g.hardDrop();
        const events = g.takeEvents();
        clears += events.filter((e) => e.type === 'clear').length;
        fx.handle(events);
        fx.frame(16.7, false);
        for (const layer of ['background', 'board', 'effects'] as const) fx.draw(ctx, layer, 30);
        if (frame >= 0) worst = Math.max(worst, performance.now() - start);
        peak = Math.max(peak, fx.particles.count);
        expect(fx.particles.count).toBeLessThanOrEqual(MAX_PARTICLES);
      }
      expect(g.state.over).toBe(false);
      expect(clears).toBe(1020);
      // The source asks for far more than the cap; the pool stays full, never over.
      expect(peak).toBe(MAX_PARTICLES);
      expect(worst).toBeLessThan(16.7);
    },
  );
});
