import { describe, expect, it } from 'vitest';
import { Game } from './game.ts';
import { MODES } from './modes/index.ts';
import { COUNTDOWN_MS, Session, type Move } from './session.ts';

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
});
