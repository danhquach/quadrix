/** A game event that has a sound. A clear's number is its line count. */
export type Cue =
  'move' | 'rotate' | 'lock' | 'clear1' | 'clear2' | 'clear3' | 'clear4' | 'level' | 'over';

/** What the sounds follow, read from the game once per frame. */
export interface GameView {
  /** The game itself: a different one is a new game, which makes no sound. */
  readonly game: object;
  readonly locks: number;
  readonly lines: number;
  readonly level: number;
  readonly over: boolean;
  readonly x: number;
  readonly rot: number;
}

/**
 * The sounds for what happened between two frames, at most one of each. A lock plays
 * lock, or its clear instead; level up joins it; game over replaces both. Without a lock,
 * a rotation (kicks included) or else a sideways move plays. Falling makes no sound.
 */
export function cuesFor(prev: GameView | null, next: GameView): Cue[] {
  if (!prev || prev.game !== next.game) return [];
  if (next.over) return prev.over ? [] : ['over'];
  if (next.locks !== prev.locks) {
    const cleared = Math.min(4, next.lines - prev.lines);
    const cues: Cue[] = [cleared > 0 ? (`clear${cleared}` as Cue) : 'lock'];
    if (next.level > prev.level) cues.push('level');
    return cues;
  }
  if (next.rot !== prev.rot) return ['rotate'];
  if (next.x !== prev.x) return ['move'];
  return [];
}

/** Whether the music plays: only while a game runs, unmuted. A countdown is still a pause. */
export function musicOn(muted: boolean, phase: string | null, over: boolean): boolean {
  return !muted && phase === 'running' && !over;
}

/** Volume 0–100 as a gain: squared, so the slider's middle sounds like half. */
export function gainOf(volume: number): number {
  const v = Math.min(100, Math.max(0, volume)) / 100;
  return v * v;
}

export type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';

/** One synthesized note: from `freq` (sliding to `to`, if set), `start` and `dur` in seconds. */
export interface Note {
  readonly freq: number;
  readonly to?: number;
  readonly start: number;
  readonly dur: number;
  readonly wave: Wave;
  readonly gain: number;
}

/** A MIDI note number's frequency (69 is A4, 440 Hz). */
export function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Rising notes, `step` seconds apart, each `dur` long. */
function run(midis: number[], step: number, dur: number, wave: Wave, gain: number): Note[] {
  return midis.map((m, i) => ({ freq: hz(m), start: i * step, dur, wave, gain }));
}

/**
 * Each cue's notes. All sounds are synthesized here and in audio.ts: no audio files.
 * Bigger clears play longer, higher runs; level up waits for the clear it comes with.
 */
export const VOICES: Readonly<Record<Cue, readonly Note[]>> = {
  move: [{ freq: 330, start: 0, dur: 0.03, wave: 'triangle', gain: 0.3 }],
  rotate: [{ freq: 520, to: 780, start: 0, dur: 0.05, wave: 'square', gain: 0.12 }],
  lock: [{ freq: 140, to: 70, start: 0, dur: 0.09, wave: 'triangle', gain: 0.5 }],
  clear1: run([72, 76], 0.05, 0.08, 'square', 0.14),
  clear2: run([72, 76, 79], 0.05, 0.09, 'square', 0.14),
  clear3: run([72, 76, 79, 84], 0.05, 0.1, 'square', 0.15),
  clear4: [
    ...run([72, 76, 79, 84, 88, 91], 0.05, 0.12, 'square', 0.15),
    { freq: hz(48), start: 0, dur: 0.45, wave: 'triangle', gain: 0.4 },
  ],
  level: run([67, 72, 76, 79, 84], 0.06, 0.1, 'triangle', 0.35).map((n) => ({
    ...n,
    start: n.start + 0.3,
  })),
  over: run([64, 60, 57, 53, 48], 0.18, 0.22, 'triangle', 0.4),
};

/** The longest a cue's notes last, in seconds. */
export function voiceLength(notes: readonly Note[]): number {
  return Math.max(0, ...notes.map((n) => n.start + n.dur));
}

/** Seconds per music step (an eighth note at 132 beats a minute). */
export const MUSIC_STEP = 60 / 132 / 2;

// One looping track, original: four bars of eighth notes, MIDI numbers, null rests.
const _ = null;
const LEAD: readonly (number | null)[] = [
  ...[69, _, 64, 69, 72, _, 71, 69],
  ...[69, _, _, 64, 65, 67, 69, _],
  ...[72, _, 74, 76, 79, 76, 74, 72],
  ...[71, _, 67, _, 69, _, _, _],
];
const BASS: readonly (number | null)[] = [
  ...[45, _, 57, _, 45, _, 57, _],
  ...[41, _, 53, _, 41, _, 53, _],
  ...[48, _, 60, _, 43, _, 55, _],
  ...[40, _, 52, _, 45, _, 57, _],
];

/** The music loop's notes; it lasts MUSIC_STEP times the number of steps. */
export const MUSIC: readonly Note[] = [
  ...LEAD.flatMap((m, i) =>
    m === null
      ? []
      : [
          {
            freq: hz(m),
            start: i * MUSIC_STEP,
            dur: MUSIC_STEP * 0.9,
            wave: 'square' as const,
            gain: 0.09,
          },
        ],
  ),
  ...BASS.flatMap((m, i) =>
    m === null
      ? []
      : [
          {
            freq: hz(m),
            start: i * MUSIC_STEP,
            dur: MUSIC_STEP * 1.8,
            wave: 'triangle' as const,
            gain: 0.3,
          },
        ],
  ),
];

/** The music loop's length in seconds. */
export const MUSIC_LENGTH = LEAD.length * MUSIC_STEP;
