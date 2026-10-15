import { describe, expect, it } from 'vitest';
import {
  FLICK_MIN_PX,
  FLICK_WINDOW_MS,
  GestureTracker,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  isAction,
  type Action,
} from './gestures.ts';

const CELL = 30;

/** Run a touch along `points` ([x, y, t]); the last point is the release. Returns every action in order. */
function gesture(points: [number, number, number][], cell = CELL): Action[] {
  const g = new GestureTracker();
  const [first, ...rest] = points;
  g.down(first![0], first![1], first![2], cell);
  const last = rest.pop() ?? first!;
  const out = rest.flatMap(([x, y, t]) => g.move(x, y, t));
  return [...out, ...g.up(last[0], last[1], last[2])];
}

/** A steady drag from (x0, y0) by (dx, dy) over `ms`, sampled every 16 ms. */
function drag(dx: number, dy: number, ms: number, x0 = 100, y0 = 100): [number, number, number][] {
  const n = Math.max(1, Math.round(ms / 16));
  return Array.from({ length: n + 1 }, (_, i) => [
    x0 + (dx * i) / n,
    y0 + (dy * i) / n,
    (ms * i) / n,
  ]);
}

describe('GestureTracker', () => {
  it('reads a tap as rotate', () => {
    expect(
      gesture([
        [100, 100, 0],
        [100, 100, 80],
      ]),
    ).toEqual(['rotate']);
  });

  it('reads a jittery tap within the slop as rotate only', () => {
    expect(
      gesture([
        [100, 100, 0],
        [104, 103, 30],
        [97, 105, 60],
        [103, 104, 90],
      ]),
    ).toEqual(['rotate']);
  });

  it('does not rotate on a long press', () => {
    expect(
      gesture([
        [100, 100, 0],
        [100, 100, TAP_MAX_MS + 1],
      ]),
    ).toEqual([]);
  });

  it('a short drag past the slop is neither a tap nor a move', () => {
    expect(gesture(drag(TAP_SLOP_PX + 5, 0, 100))).toEqual([]);
  });

  it('a quick sideways swipe of one cell moves once and does not rotate', () => {
    expect(gesture(drag(CELL + 2, 0, 60))).toEqual(['right']);
  });

  it('moves one column per cell width dragged', () => {
    expect(gesture(drag(3.5 * CELL, 0, 400))).toEqual(['right', 'right', 'right']);
    expect(gesture(drag(-2.2 * CELL, 0, 400))).toEqual(['left', 'left']);
  });

  it('dragging back undoes moves cell by cell', () => {
    const g = new GestureTracker();
    g.down(100, 100, 0, CELL);
    expect(g.move(100 + 2 * CELL, 100, 200)).toEqual(['right', 'right']);
    expect(g.move(100 + CELL - 1, 100, 400)).toEqual(['left']);
    expect(g.up(100 + CELL - 1, 100, 500)).toEqual([]);
  });

  it('a slow drag down soft-drops once per cell and never hard-drops', () => {
    expect(gesture(drag(0, 4 * CELL, 1000))).toEqual(Array(4).fill('softDrop'));
  });

  it('locks to the first axis: a sideways drag that drifts down never soft-drops', () => {
    const actions = gesture([
      [100, 100, 0],
      [130, 105, 100],
      [170, 140, 300],
      [180, 200, 600],
    ]);
    expect(actions).toEqual(['right', 'right']);
  });

  it('locks to the first axis: a drag down that drifts sideways never moves', () => {
    const actions = gesture([
      [100, 100, 0],
      [102, 130, 200],
      [160, 160, 500],
      [200, 190, 800],
    ]);
    expect(actions).toEqual(['softDrop', 'softDrop', 'softDrop']);
  });

  it('a fast flick down is exactly one hard drop', () => {
    expect(gesture(drag(0, 200, 60))).toEqual(['hardDrop']);
  });

  it('a flick hard-drops once however far the finger keeps going', () => {
    const g = new GestureTracker();
    g.down(100, 100, 0, CELL);
    const out = [
      ...g.move(100, 140, 16),
      ...g.move(100, 200, 32),
      ...g.move(100, 300, 48),
      ...g.move(100, 400, 64),
      ...g.move(130, 600, 300),
    ];
    expect(out).toEqual(['hardDrop']);
    expect(g.up(100, 700, 320)).toEqual([]);
  });

  it('two flicks are two hard drops', () => {
    const g = new GestureTracker();
    const flick = (t0: number) => {
      g.down(100, 100, t0, CELL);
      return [...g.move(100, 160, t0 + 16), ...g.up(100, 220, t0 + 32)];
    };
    expect([...flick(0), ...flick(200)]).toEqual(['hardDrop', 'hardDrop']);
  });

  it('a slow drag that stops before release does not flick', () => {
    const points = drag(0, 3 * CELL, 900);
    const [x, y, t] = points.at(-1)!;
    points.push([x, y, t + FLICK_WINDOW_MS + 200]);
    expect(gesture(points)).toEqual(['softDrop', 'softDrop', 'softDrop']);
  });

  it('a fast but tiny downward twitch is not a flick', () => {
    expect(gesture(drag(0, FLICK_MIN_PX - 2, 10))).toEqual([]);
  });

  it('a flick up does nothing', () => {
    expect(gesture(drag(0, -200, 60))).toEqual([]);
  });

  it('a slow drag that speeds into a flick soft-drops then hard-drops once', () => {
    const slow = drag(0, 2 * CELL, 600);
    const fast = drag(0, 150, 48, 100, 100 + 2 * CELL).map(
      ([x, y, t]) => [x, y, t + 600] as [number, number, number],
    );
    // The first fast sample still averages with the slow drag, so it may soft-drop once more.
    const actions = gesture([...slow, ...fast.slice(1)]);
    expect(actions.at(-1)).toBe('hardDrop');
    expect(actions.slice(0, -1).every((a) => a === 'softDrop')).toBe(true);
    expect(actions.filter((a) => a === 'hardDrop')).toHaveLength(1);
  });

  it('ignores moves and ups without a down, and after cancel', () => {
    const g = new GestureTracker();
    expect(g.move(200, 200, 10)).toEqual([]);
    expect(g.up(200, 200, 20)).toEqual([]);
    g.down(100, 100, 0, CELL);
    g.cancel();
    expect(g.move(100 + 3 * CELL, 100, 100)).toEqual([]);
    expect(g.up(100, 100, 120)).toEqual([]);
  });

  it('a bad or tiny cell size cannot loop or move on a tap', () => {
    for (const cell of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1]) {
      expect(
        gesture(
          [
            [100, 100, 0],
            [105, 100, 50],
          ],
          cell,
        ),
      ).toEqual(['rotate']);
      const moves = gesture(drag(1e5, 0, 200), cell);
      // drag() samples 13 moves plus the up: at most 20 moves each.
      expect(moves.length).toBeLessThanOrEqual(20 * 14);
      expect(moves.length).toBeGreaterThan(0);
      expect(moves.every((a) => a === 'right')).toBe(true);
    }
  });

  it('ignores non-finite or absurd coordinates and times without throwing', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e308, -1e308];
    for (const v of bad) {
      const g = new GestureTracker();
      g.down(100, 100, 0, CELL);
      expect(g.move(v, 100, 16)).toEqual([]);
      expect(g.move(100, v, 32)).toEqual([]);
      expect(g.move(100, 100, v)).toEqual([]);
      // The touch survives the bad samples.
      expect(g.move(100 + CELL, 100, 48)).toEqual(['right']);
      expect(g.up(v, v, v)).toEqual([]);

      const h = new GestureTracker();
      h.down(v, 100, 0, CELL);
      expect(h.move(100 + CELL, 100, 16)).toEqual([]);
      expect(h.up(100, 100, 32)).toEqual([]);
    }
  });

  it('waits on a diagonal start until one axis clearly leads', () => {
    // First 12px lean sideways but not decisively; then the thumb goes straight down.
    const actions = gesture([
      [100, 100, 0],
      [109, 107, 50],
      [110, 130, 300],
      [110, 165, 600],
      [110, 200, 900],
    ]);
    expect(actions).toEqual(['softDrop', 'softDrop', 'softDrop']);
  });

  it('a diagonal that never picks a side does nothing, and is not a tap', () => {
    expect(gesture(drag(40, 40, 150))).toEqual([]);
  });

  it('a new down fully resets a touch whose up was lost', () => {
    const g = new GestureTracker();
    g.down(100, 100, 0, CELL);
    expect(g.move(100, 300, 16)).toEqual(['hardDrop']);
    // No up: the next touch must not inherit the flick, axis or anchors.
    g.down(100, 100, 1000, CELL);
    expect(g.move(100 + CELL, 100, 1100)).toEqual(['right']);
    g.down(100, 100, 2000, CELL);
    expect(g.up(100, 100, 2050)).toEqual(['rotate']);
  });

  it('a flick with no move events (down then up) is one hard drop', () => {
    const g = new GestureTracker();
    g.down(100, 100, 0, CELL);
    expect(g.up(100, 220, 40)).toEqual(['hardDrop']);
  });

  it('caps the moves from one wild jump', () => {
    const g = new GestureTracker();
    g.down(0, 0, 0, CELL);
    expect(g.move(1e5, 0, 16).length).toBe(20);
  });
});

describe('isAction', () => {
  it('accepts only the known actions', () => {
    for (const a of ['left', 'right', 'rotate', 'softDrop', 'hardDrop', 'pause']) {
      expect(isAction(a)).toBe(true);
    }
    for (const v of ['', 'Left', 'constructor', '__proto__', 'toString', null, undefined, 1, {}]) {
      expect(isAction(v)).toBe(false);
    }
  });
});
