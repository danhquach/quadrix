import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS } from './game.ts';
import { MODES } from './modes/index.ts';
import { COUNTDOWN_MS, LOCK_DELAY_MS, MAX_LOCK_RESETS, Session, type Move } from './session.ts';

const GRAVITY = MODES.classic!.gravityMs(1);
const MOVES: Move[] = ['left', 'right', 'rotate', 'softDrop', 'hardDrop'];

function session(now = 0): Session {
  return new Session(new Game(MODES.classic!, 1), now);
}

/** Everything a pause must leave untouched. */
function snapshot(s: Session) {
  return structuredClone({ ...s.game.state, mode: s.game.state.mode.id });
}

describe('session', () => {
  it('drops one row per gravity interval while running', () => {
    const s = session();
    const y = s.game.state.piece.y;
    s.tick(GRAVITY - 1);
    expect(s.game.state.piece.y).toBe(y);
    s.tick(GRAVITY);
    expect(s.game.state.piece.y).toBe(y + 1);
  });

  it('stops gravity while paused, for any length of time', () => {
    const s = session();
    s.tick(GRAVITY / 2);
    const before = snapshot(s);
    s.pause();
    for (const t of [GRAVITY, 10 * GRAVITY, 1e9, Number.MAX_SAFE_INTEGER]) s.tick(t);
    expect(s.phase).toBe('paused');
    expect(snapshot(s)).toEqual(before);
  });

  it('blocks every move while paused and while counting down', () => {
    const s = session();
    const before = snapshot(s);
    s.pause();
    for (const m of MOVES) expect(s.act(m, 0)).toBe(false);
    expect(snapshot(s)).toEqual(before);
    s.resume(0);
    expect(s.phase).toBe('countdown');
    for (const m of MOVES) expect(s.act(m, 1)).toBe(false);
    expect(snapshot(s)).toEqual(before);
  });

  it('applies moves while running', () => {
    const s = session();
    const x = s.game.state.piece.x;
    expect(s.act('left', 0)).toBe(true);
    expect(s.game.state.piece.x).toBe(x - 1);
  });

  it('counts down 3, 2, 1 with no gravity, then runs', () => {
    const s = session();
    s.pause();
    const before = snapshot(s);
    s.resume(1000);
    const seen: number[] = [];
    for (let t = 1000; t < 1000 + COUNTDOWN_MS; t += 100) {
      s.tick(t);
      seen.push(s.countdown(t));
    }
    expect([...new Set(seen)]).toEqual([3, 2, 1]);
    expect(snapshot(s)).toEqual(before);
    s.tick(1000 + COUNTDOWN_MS);
    expect(s.phase).toBe('running');
    expect(s.countdown(1000 + COUNTDOWN_MS)).toBe(0);
  });

  it('restarts the drop timer from zero on resume', () => {
    const s = session();
    // Most of an interval has passed when the game pauses.
    s.tick(GRAVITY - 1);
    s.pause();
    s.resume(50_000);
    const end = 50_000 + COUNTDOWN_MS;
    s.tick(end);
    const y = s.game.state.piece.y;
    s.tick(end + GRAVITY - 1);
    expect(s.game.state.piece.y).toBe(y);
    s.tick(end + GRAVITY);
    expect(s.game.state.piece.y).toBe(y + 1);
  });

  it('pausing during the countdown stops it; resuming starts a fresh one', () => {
    const s = session();
    s.pause();
    s.resume(0);
    s.tick(COUNTDOWN_MS - 1);
    s.pause();
    s.tick(COUNTDOWN_MS * 10);
    expect(s.phase).toBe('paused');
    s.resume(COUNTDOWN_MS * 10);
    expect(s.countdown(COUNTDOWN_MS * 10)).toBe(3);
  });

  it('toggle pauses, resumes, and re-pauses a countdown', () => {
    const s = session();
    s.toggle(0);
    expect(s.phase).toBe('paused');
    s.toggle(0);
    expect(s.phase).toBe('countdown');
    s.toggle(1);
    expect(s.phase).toBe('paused');
  });

  it('resume does nothing unless paused', () => {
    const s = session();
    s.resume(0);
    expect(s.phase).toBe('running');
  });

  it('cannot pause a finished game', () => {
    const s = session();
    s.game.state.over = true;
    s.pause();
    expect(s.phase).toBe('running');
    expect(s.act('left', 0)).toBe(false);
  });

  it('soft drop scores and restarts the drop timer', () => {
    const s = session();
    s.tick(GRAVITY - 10);
    const y = s.game.state.piece.y;
    s.act('softDrop', GRAVITY - 10);
    expect(s.game.state.piece.y).toBe(y + 1);
    expect(s.game.state.score).toBe(1);
    s.tick(GRAVITY);
    expect(s.game.state.piece.y).toBe(y + 1);
  });

  describe('lock delay', () => {
    /** An O resting on the floor, cells in columns x+1 and x+2. */
    function resting(x = 3): Session {
      const s = session();
      s.game.state.piece = { kind: 'O', rot: 0, x, y: ROWS - 2 };
      return s;
    }

    /** Fill the bottom row in columns 0..4: an O at x 1..3 rests on it, at x 4 it hangs free. */
    function ledge(s: Session): void {
      for (let x = 0; x <= 4; x++) s.game.state.board[ROWS - 1]![x] = 1;
      s.game.state.piece = { kind: 'O', rot: 0, x: 2, y: ROWS - 3 };
    }

    it('locks a resting piece LOCK_DELAY_MS after touchdown', () => {
      const s = resting();
      s.tick(10);
      s.tick(10 + LOCK_DELAY_MS - 1);
      expect(s.game.locks).toBe(0);
      s.tick(10 + LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
      expect(s.game.state.board[ROWS - 1]![4]).not.toBe(0);
    });

    it('starts the delay when gravity lands the piece, not before', () => {
      const s = session();
      s.game.state.piece = { kind: 'O', rot: 0, x: 3, y: ROWS - 3 };
      s.tick(GRAVITY);
      expect(s.game.state.piece.y).toBe(ROWS - 2);
      s.tick(GRAVITY + LOCK_DELAY_MS - 1);
      expect(s.game.locks).toBe(0);
      s.tick(GRAVITY + LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
    });

    it('a gravity step on a resting piece does not lock it', () => {
      const s = resting();
      s.tick(GRAVITY - LOCK_DELAY_MS + 1);
      s.tick(GRAVITY);
      expect(s.game.locks).toBe(0);
    });

    it('slides a resting piece under an overhang', () => {
      const s = resting(4);
      // A roof over columns 0..3 with a two-row gap under it.
      for (let x = 0; x <= 3; x++) s.game.state.board[ROWS - 3]![x] = 1;
      s.tick(0);
      let t = 0;
      for (let i = 0; i < 5; i++) {
        t += LOCK_DELAY_MS - 100;
        s.tick(t);
        expect(s.act('left', t)).toBe(true);
      }
      expect(s.game.locks).toBe(0);
      expect(s.game.state.piece.x).toBe(-1);
      s.tick(t + LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
      expect(s.game.state.board[ROWS - 1]!.slice(0, 2)).not.toContain(0);
      expect(s.game.state.board[ROWS - 2]!.slice(0, 2)).not.toContain(0);
    });

    it('a failed move does not restart the timer', () => {
      const s = resting(-1);
      s.tick(0);
      s.act('left', LOCK_DELAY_MS - 1);
      s.tick(LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
    });

    it('a rotate restarts the timer', () => {
      const s = resting();
      s.tick(0);
      expect(s.act('rotate', 400)).toBe(true);
      s.tick(400 + LOCK_DELAY_MS - 1);
      expect(s.game.locks).toBe(0);
      s.tick(400 + LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
    });

    it(`stops restarting the timer after ${MAX_LOCK_RESETS} resets`, () => {
      const s = resting();
      s.tick(0);
      let t = 0;
      for (let i = 0; i < MAX_LOCK_RESETS; i++) {
        t += LOCK_DELAY_MS - 1;
        s.act(i % 2 ? 'right' : 'left', t);
        expect(s.game.locks).toBe(0);
      }
      // The last reset gave a full delay; further moves add nothing.
      s.act('left', t + 100);
      s.tick(t + LOCK_DELAY_MS - 1);
      expect(s.game.locks).toBe(0);
      s.tick(t + LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
    });

    it('cannot stall forever by moving back and forth', () => {
      const s = resting();
      for (let t = 0; t < 60_000 && s.game.locks === 0; t += 50) {
        s.act(t % 100 ? 'right' : 'left', t);
        s.tick(t);
      }
      expect(s.game.locks).toBe(1);
    });

    it('stops the timer while the piece is lifted off, restarts it on touchdown', () => {
      const s = session();
      ledge(s);
      s.tick(0);
      s.act('right', 100);
      s.act('right', 200);
      // Hanging past the ledge's edge: no lock however long the timer would have run.
      expect(s.game.grounded()).toBe(false);
      s.tick(GRAVITY - 1);
      expect(s.game.locks).toBe(0);
      // Gravity lands it on the floor: a fresh delay from there.
      s.tick(GRAVITY);
      expect(s.game.grounded()).toBe(true);
      s.tick(GRAVITY + LOCK_DELAY_MS - 1);
      expect(s.game.locks).toBe(0);
      s.tick(GRAVITY + LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
    });

    it('with its resets used up, locks the moment it next touches down', () => {
      const s = session();
      ledge(s);
      s.tick(0);
      let t = 0;
      for (let i = 0; i < MAX_LOCK_RESETS; i++) s.act(i % 2 ? 'right' : 'left', (t += 10));
      expect(s.game.state.piece.x).toBe(1);
      for (let i = 0; i < 3; i++) s.act('right', (t += 10));
      expect(s.game.grounded()).toBe(false);
      expect(s.game.locks).toBe(0);
      s.tick(GRAVITY);
      expect(s.game.locks).toBe(1);
    });

    it('holding soft drop on a resting piece does not lock it early', () => {
      const s = resting();
      s.tick(0);
      for (let t = 0; t < LOCK_DELAY_MS; t += 16) {
        s.act('softDrop', t);
        s.tick(t);
      }
      expect(s.game.locks).toBe(0);
      expect(s.game.state.score).toBe(0);
      s.tick(LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
    });

    it('soft drop onto the stack starts the delay', () => {
      const s = session();
      s.game.state.piece = { kind: 'O', rot: 0, x: 3, y: ROWS - 3 };
      s.act('softDrop', 100);
      expect(s.game.grounded()).toBe(true);
      s.tick(100 + LOCK_DELAY_MS - 1);
      expect(s.game.locks).toBe(0);
      s.tick(100 + LOCK_DELAY_MS);
      expect(s.game.locks).toBe(1);
    });

    it('hard drop still locks instantly', () => {
      const s = session();
      s.act('hardDrop', 0);
      expect(s.game.locks).toBe(1);
    });

    it('a new piece gets a fresh set of resets', () => {
      const s = resting();
      s.tick(0);
      let t = 0;
      for (let i = 0; i < MAX_LOCK_RESETS; i++) s.act(i % 2 ? 'right' : 'left', (t += 10));
      s.tick((t += LOCK_DELAY_MS));
      expect(s.game.locks).toBe(1);
      s.game.state.piece = { kind: 'O', rot: 0, x: 3, y: ROWS - 4 };
      s.tick(t);
      expect(s.game.locks).toBe(1);
      s.act('left', t + 100);
      s.tick(t + 100 + LOCK_DELAY_MS - 1);
      expect(s.game.locks).toBe(1);
      s.tick(t + 100 + LOCK_DELAY_MS);
      expect(s.game.locks).toBe(2);
    });

    it('keeps what is left of the delay across a pause', () => {
      const s = resting();
      s.tick(0);
      s.tick(300);
      s.pause();
      s.tick(10_000);
      expect(s.game.locks).toBe(0);
      s.resume(10_000);
      const end = 10_000 + COUNTDOWN_MS;
      s.tick(end);
      s.tick(end + LOCK_DELAY_MS - 300 - 1);
      expect(s.game.locks).toBe(0);
      s.tick(end + LOCK_DELAY_MS - 300);
      expect(s.game.locks).toBe(1);
    });

    it('keeps the delay left when paused again during the countdown', () => {
      const s = resting();
      s.tick(0);
      s.tick(400);
      s.pause();
      s.resume(1000);
      s.tick(1000 + COUNTDOWN_MS - 1);
      s.pause();
      s.resume(9000);
      const end = 9000 + COUNTDOWN_MS;
      s.tick(end);
      s.tick(end + LOCK_DELAY_MS - 400 - 1);
      expect(s.game.locks).toBe(0);
      s.tick(end + LOCK_DELAY_MS - 400);
      expect(s.game.locks).toBe(1);
    });

    it('gives the piece after a hard drop a full gravity interval', () => {
      const s = session();
      s.tick(GRAVITY - 1);
      s.act('hardDrop', GRAVITY - 1);
      const y = s.game.state.piece.y;
      s.tick(2 * GRAVITY - 2);
      expect(s.game.state.piece.y).toBe(y);
      s.tick(2 * GRAVITY - 1);
      expect(s.game.state.piece.y).toBe(y + 1);
    });

    it('locks a piece resting on a full stack and ends the game when the next cannot spawn', () => {
      const s = session();
      for (let y = 2; y < ROWS; y++)
        s.game.state.board[y] = Array<number>(COLS)
          .fill(1)
          .map((c, x) => (x === 9 ? 0 : c));
      s.game.state.piece = { kind: 'O', rot: 0, x: 3, y: 0 };
      s.tick(0);
      s.tick(LOCK_DELAY_MS);
      expect(s.game.state.over).toBe(true);
      expect(s.act('left', LOCK_DELAY_MS)).toBe(false);
    });
  });
});
