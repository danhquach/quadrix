import { describe, expect, it } from 'vitest';
import { COLS, ROWS } from '../core/game.ts';
import { DEFAULT_KEYS } from './keys.ts';
import { KeyRepeat, REPEAT_TIMING, heldMove, type RepeatMove } from './repeat.ts';

const { delayMs, intervalMs, softDropMs } = REPEAT_TIMING;

/** Run frames of `frameMs` from `from` to `to`, collecting every repeat move. */
function run(r: KeyRepeat, from: number, to: number, frameMs = 1000 / 60, running = true) {
  const moves: { at: number; move: RepeatMove }[] = [];
  for (let t = from; t <= to; t += frameMs) {
    for (const move of r.tick(t, running)) moves.push({ at: t, move });
  }
  return moves;
}

describe('heldMove', () => {
  it('holds only the moves that repeat, and never with a modifier', () => {
    expect(heldMove('ArrowLeft', false)).toBe('left');
    expect(heldMove('ArrowRight', false)).toBe('right');
    expect(heldMove('ArrowDown', false)).toBe('softDrop');
    for (const key of ['ArrowUp', ' ', 'p', 'Escape', 'a', '__proto__']) {
      expect(heldMove(key, false)).toBeNull();
    }
    expect(heldMove('ArrowLeft', true)).toBeNull();
  });

  it('follows rebound keys', () => {
    const keys = { ...DEFAULT_KEYS, left: 'a', softDrop: 's' };
    expect(heldMove('a', false, keys)).toBe('left');
    expect(heldMove('A', false, keys)).toBe('left');
    expect(heldMove('s', false, keys)).toBe('softDrop');
    expect(heldMove('ArrowLeft', false, keys)).toBeNull();
  });
});

describe('KeyRepeat.setTiming', () => {
  it('uses the new delay and interval from the next press', () => {
    const r = new KeyRepeat();
    r.setTiming({ delayMs: 50, intervalMs: 100, softDropMs });
    r.press('left', 0);
    expect(r.tick(49, true)).toEqual([]);
    expect(r.tick(50, true)).toEqual(['left']);
    expect(r.tick(149, true)).toEqual([]);
    expect(r.tick(150, true)).toEqual(['left']);
  });

  it('with interval 0 goes straight to the wall once the delay is up', () => {
    const r = new KeyRepeat();
    r.setTiming({ delayMs: 50, intervalMs: 0, softDropMs });
    r.press('right', 0);
    expect(r.tick(50, true).length).toBe(ROWS);
  });
});

describe('KeyRepeat', () => {
  it('waits the delay, then repeats every interval', () => {
    const r = new KeyRepeat();
    expect(r.press('right', 0)).toBe(true);
    expect(r.tick(delayMs - 1, true)).toEqual([]);
    expect(r.tick(delayMs, true)).toEqual(['right']);
    expect(r.tick(delayMs + intervalMs - 1, true)).toEqual([]);
    expect(r.tick(delayMs + intervalMs, true)).toEqual(['right']);
  });

  it('ignores the computer’s own repeats of a key already held', () => {
    const r = new KeyRepeat();
    r.press('right', 0);
    expect(r.press('right', 100)).toBe(false);
    expect(r.press('right', 150)).toBe(false);
    // The delay still runs from the first press.
    expect(r.tick(delayMs, true)).toEqual(['right']);
  });

  it('reaches the wall in delay + columns × interval, within one frame, at any frame rate', () => {
    for (const frameMs of [1000 / 30, 1000 / 60, 1000 / 144]) {
      const r = new KeyRepeat();
      r.press('right', 0);
      // The press itself moves once; COLS - 1 more moves cross any board.
      const moves = run(r, 0, 2000, frameMs);
      const wall = moves[COLS - 2]!.at;
      const due = delayMs + (COLS - 2) * intervalMs;
      expect(wall).toBeGreaterThanOrEqual(due);
      expect(wall - due).toBeLessThan(frameMs);
    }
  });

  it('catches up after a long frame, but never more than a board in one tick', () => {
    const r = new KeyRepeat();
    r.press('left', 0);
    expect(r.tick(delayMs + 2 * intervalMs, true)).toEqual(['left', 'left', 'left']);
    expect(r.tick(60_000, true).length).toBeLessThanOrEqual(ROWS);
    // The backlog is dropped, not carried into the next frames.
    expect(r.tick(60_000 + 1, true)).toEqual([]);
  });

  it('stops on release', () => {
    const r = new KeyRepeat();
    r.press('right', 0);
    r.release('right', 100);
    expect(run(r, 100, 1000)).toEqual([]);
  });

  describe('last pressed wins', () => {
    it('switches to the newer key, with a fresh delay', () => {
      const r = new KeyRepeat();
      r.press('left', 0);
      r.press('right', 500);
      expect(r.tick(500 + delayMs - 1, true)).toEqual([]);
      expect(r.tick(500 + delayMs, true)).toEqual(['right']);
    });

    it('falls back to the older key when the newer is released', () => {
      const r = new KeyRepeat();
      r.press('left', 0);
      r.press('right', 100);
      r.release('right', 200);
      expect(r.tick(200 + delayMs - 1, true)).toEqual([]);
      expect(r.tick(200 + delayMs, true)).toEqual(['left']);
    });

    it('keeps the newer key when the older is released', () => {
      const r = new KeyRepeat();
      r.press('left', 0);
      r.press('right', 100);
      r.release('left', 150);
      expect(r.tick(100 + delayMs, true)).toEqual(['right']);
    });

    it('holds in every press and release order', () => {
      // Each sequence of events, then the direction expected to repeat (or none).
      const cases: [string, RepeatMove | null][] = [
        ['+L +R', 'right'],
        ['+R +L', 'left'],
        ['+L +R -R', 'left'],
        ['+L +R -L', 'right'],
        ['+R +L -L', 'right'],
        ['+R +L -R', 'left'],
        ['+L +R -L -R', null],
        ['+L +R -R -L', null],
        ['+L +R -R +R', 'right'],
        ['+L +R -L +L', 'left'],
        ['-L +R', 'right'],
      ];
      for (const [events, expected] of cases) {
        const r = new KeyRepeat();
        let t = 0;
        for (const ev of events.split(' ')) {
          const move = ev[1] === 'L' ? 'left' : 'right';
          if (ev[0] === '+') r.press(move, t);
          else r.release(move, t);
          t += 10;
        }
        const moves = run(r, t, t + 1000).map((m) => m.move);
        expect(new Set(moves), events).toEqual(new Set(expected ? [expected] : []));
      }
    });
  });

  it('repeats a held ↓ at the soft-drop rate, alongside a held direction', () => {
    const r = new KeyRepeat();
    r.press('softDrop', 0);
    r.press('right', 0);
    expect(r.tick(delayMs, true).sort()).toEqual(['right', 'softDrop']);
    expect(r.tick(delayMs + softDropMs, true)).toContain('softDrop');
    r.release('softDrop', delayMs + softDropMs);
    const after = run(r, delayMs + softDropMs + 1, 1000).map((m) => m.move);
    expect(after).not.toContain('softDrop');
    expect(after).toContain('right');
  });

  it('does not burst after a pause: a held key waits a fresh delay on resume', () => {
    const r = new KeyRepeat();
    r.press('right', 0);
    r.press('softDrop', 0);
    run(r, 0, 300);
    // Paused (and counting down) for five seconds, keys still held.
    expect(run(r, 300, 5300, 1000 / 60, false)).toEqual([]);
    expect(r.tick(5310, true)).toEqual([]);
    expect(r.tick(5310 + delayMs - 1, true)).toEqual([]);
    expect(r.tick(5310 + delayMs, true).sort()).toEqual(['right', 'softDrop']);
  });

  it('keeps the newer key when the older is released while paused', () => {
    const r = new KeyRepeat();
    r.press('left', 0);
    r.press('right', 10);
    r.tick(20, false);
    r.release('left', 30);
    expect(r.tick(1000, true)).toEqual([]);
    expect(r.tick(1000 + delayMs, true)).toEqual(['right']);
  });

  it('starts the delay when play starts for a key pressed before it', () => {
    const r = new KeyRepeat();
    r.press('left', 0);
    expect(run(r, 0, 1000, 1000 / 60, false)).toEqual([]);
    expect(r.tick(1000, true)).toEqual([]);
    expect(r.tick(1000 + delayMs, true)).toEqual(['left']);
  });

  it('forgets every held key on clear (keyups missed while the window lost focus)', () => {
    const r = new KeyRepeat();
    r.press('left', 0);
    r.press('softDrop', 0);
    r.clear();
    expect(run(r, 0, 1000)).toEqual([]);
    // A fresh press after clear acts as new.
    expect(r.press('left', 1000)).toBe(true);
  });

  it('treats an interval of 0 as instant: a board’s worth of moves at once', () => {
    const r = new KeyRepeat({ delayMs, intervalMs: 0, softDropMs });
    r.press('right', 0);
    expect(r.tick(delayMs, true)).toEqual(Array<RepeatMove>(ROWS).fill('right'));
  });
});
