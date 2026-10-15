import { describe, expect, it } from 'vitest';
import { COLS, Game, ROWS } from '../core/game.ts';
import { MODES } from '../core/modes/index.ts';
import {
  MUSIC,
  MUSIC_LENGTH,
  VOICES,
  cuesFor,
  gainOf,
  hz,
  musicOn,
  voiceLength,
  type Cue,
  type GameView,
} from './sound.ts';

const game = {};
const base: GameView = { game, locks: 3, lines: 0, level: 1, over: false, x: 3, rot: 0 };
const at = (v: Partial<GameView>): GameView => ({ ...base, ...v });

describe('cuesFor', () => {
  it('is silent on the first frame, a new game, or nothing changed', () => {
    expect(cuesFor(null, base)).toEqual([]);
    expect(cuesFor(base, at({ game: {}, x: 5, locks: 9 }))).toEqual([]);
    expect(cuesFor(base, base)).toEqual([]);
  });

  it('plays move, rotate (kick included) and nothing for a fall', () => {
    expect(cuesFor(base, at({ x: 4 }))).toEqual(['move']);
    expect(cuesFor(base, at({ x: 2 }))).toEqual(['move']);
    expect(cuesFor(base, at({ rot: 1 }))).toEqual(['rotate']);
    expect(cuesFor(base, at({ rot: 1, x: 2 }))).toEqual(['rotate']);
  });

  it('plays one move per frame however far the piece slid', () => {
    expect(cuesFor(base, at({ x: 0 }))).toEqual(['move']);
  });

  it('plays lock, or the clear sized by its lines instead', () => {
    expect(cuesFor(base, at({ locks: 4, x: 0, rot: 2 }))).toEqual(['lock']);
    for (const n of [1, 2, 3, 4]) {
      expect(cuesFor(base, at({ locks: 4, lines: n }))).toEqual([`clear${n}`]);
    }
  });

  it('adds level up to the clear that earned it', () => {
    expect(cuesFor(at({ lines: 8 }), at({ locks: 4, lines: 10, level: 2 }))).toEqual([
      'clear2',
      'level',
    ]);
  });

  it('plays game over once, and only that', () => {
    expect(cuesFor(base, at({ locks: 4, lines: 1, level: 2, over: true }))).toEqual(['over']);
    expect(cuesFor(at({ over: true }), at({ over: true }))).toEqual([]);
  });
});

/** Drive a real game and collect the cues, frame by frame, the way main.ts does. */
function heard(g: Game, frames: ((g: Game) => void)[]): Cue[][] {
  const view = (): GameView => ({
    game: g,
    locks: g.locks,
    lines: g.state.lines,
    level: g.state.level,
    over: g.state.over,
    x: g.state.piece.x,
    rot: g.state.piece.rot,
  });
  let prev = view();
  return frames.map((frame) => {
    frame(g);
    const next = view();
    const cues = cuesFor(prev, next);
    prev = next;
    return cues;
  });
}

describe.each(['classic', 'override'])('a real %s game', (id) => {
  const mode = MODES[id]!;

  it('sounds each event once', () => {
    const g = new Game(mode, 7);
    expect(
      heard(g, [
        (g) => g.move(1),
        (g) => g.rotate(),
        (g) => g.step(),
        (g) => {
          // Several moves in one frame, as held-key repeat at 0 ms makes: one sound.
          while (g.move(-1));
        },
        (g) => g.hardDrop(),
        () => {},
      ]),
    ).toEqual([['move'], ['rotate'], [], ['move'], ['lock'], []]);
  });

  it('plays a quad clear and its level up, then game over', () => {
    const g = new Game(mode, 7);
    // Nine lines down and four full rows but one gap, filled by a vertical I.
    g.state.lines = 9;
    for (let y = ROWS - 4; y < ROWS; y++) g.state.board[y] = Array<number>(COLS).fill(1);
    for (let y = ROWS - 4; y < ROWS; y++) g.state.board[y]![0] = 0;
    g.state.piece = { kind: 'I', rot: 1, x: -2, y: 0 };
    expect(g.fits(g.state.piece)).toBe(true);
    const [quad] = heard(g, [(g) => g.hardDrop()]);
    expect(quad).toEqual(['clear4', 'level']);
    // Fill the board so the next piece can't spawn.
    const [over] = heard(g, [
      (g) => {
        for (let y = 0; y < ROWS; y++) {
          for (let x = 0; x < COLS; x++) g.state.board[y]![x] = (x + y) % 2 ? 1 : 0;
        }
        g.lock();
      },
    ]);
    expect(over).toEqual(['over']);
  });
});

describe('musicOn', () => {
  it('plays only while a game runs, unmuted', () => {
    expect(musicOn(false, 'running', false)).toBe(true);
    expect(musicOn(true, 'running', false)).toBe(false);
    expect(musicOn(false, 'paused', false)).toBe(false);
    expect(musicOn(false, 'countdown', false)).toBe(false);
    expect(musicOn(false, 'running', true)).toBe(false);
    expect(musicOn(false, null, true)).toBe(false);
  });
});

describe('gainOf', () => {
  it('maps 0–100 to 0–1, squared, and clamps', () => {
    expect(gainOf(0)).toBe(0);
    expect(gainOf(50)).toBe(0.25);
    expect(gainOf(100)).toBe(1);
    expect(gainOf(-5)).toBe(0);
    expect(gainOf(500)).toBe(1);
  });
});

describe('VOICES and MUSIC', () => {
  const notes = [...Object.values(VOICES).flat(), ...MUSIC];

  it('every note is audible, short of clipping, and starts in order', () => {
    expect(hz(69)).toBe(440);
    for (const n of notes) {
      expect(n.freq).toBeGreaterThan(20);
      expect(n.freq).toBeLessThan(5000);
      if (n.to !== undefined) expect(n.to).toBeGreaterThan(20);
      expect(n.dur).toBeGreaterThan(0.01);
      expect(n.gain).toBeGreaterThan(0);
      expect(n.gain).toBeLessThanOrEqual(0.5);
      expect(n.start).toBeGreaterThanOrEqual(0);
    }
  });

  it('bigger clears play longer', () => {
    const len = (c: Cue) => voiceLength(VOICES[c]);
    expect(len('clear1')).toBeLessThan(len('clear2'));
    expect(len('clear2')).toBeLessThan(len('clear3'));
    expect(len('clear3')).toBeLessThan(len('clear4'));
  });

  it('effects are short, so fast play never piles them up', () => {
    expect(voiceLength(VOICES.move)).toBeLessThanOrEqual(0.05);
    expect(voiceLength(VOICES.rotate)).toBeLessThanOrEqual(0.05);
    expect(voiceLength(VOICES.lock)).toBeLessThanOrEqual(0.1);
  });

  it('the music ends inside its loop, so the loop has no seam', () => {
    expect(MUSIC_LENGTH).toBeGreaterThan(5);
    expect(voiceLength(MUSIC)).toBeLessThanOrEqual(MUSIC_LENGTH);
  });
});
