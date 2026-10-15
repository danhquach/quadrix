import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundOut } from './audio.ts';
import { MUSIC_LENGTH, VOICES } from './sound.ts';

// A minimal stand-in for Web Audio: just enough to see what SoundOut starts and stops.
class Param {
  value = 1;
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
}
class Node {
  readonly gain = new Param();
  connect<T>(n: T): T {
    return n;
  }
}
class Osc extends Node {
  type = 'sine';
  readonly frequency = new Param();
  stoppedAt: number | null = null;
  start() {}
  stop(t: number) {
    this.stoppedAt = t;
  }
}
class Source extends Node {
  buffer: unknown = null;
  loop = false;
  offset: number | null = null;
  stopped = false;
  start(_when: number, offset: number) {
    this.offset = offset;
  }
  stop() {
    this.stopped = true;
  }
}
class Ctx {
  static made: Ctx[] = [];
  state = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  readonly destination = new Node();
  readonly oscs: Osc[] = [];
  readonly sources: Source[] = [];
  readonly gains: Node[] = [];
  constructor() {
    Ctx.made.push(this);
  }
  createGain() {
    const g = new Node();
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    const o = new Osc();
    this.oscs.push(o);
    return o;
  }
  createBufferSource() {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  createDynamicsCompressor() {
    return Object.assign(new Node(), {
      threshold: new Param(),
      knee: new Param(),
      ratio: new Param(),
      attack: new Param(),
      release: new Param(),
    });
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}
class Offline extends Ctx {
  private readonly length: number;
  private readonly rate: number;
  constructor(_channels: number, length: number, rate: number) {
    super();
    Ctx.made.pop();
    this.length = length;
    this.rate = rate;
  }
  startRendering() {
    return Promise.resolve({ duration: this.length / this.rate });
  }
}

let active = true;
beforeEach(() => {
  Ctx.made = [];
  active = true;
  vi.stubGlobal('AudioContext', Ctx);
  vi.stubGlobal('OfflineAudioContext', Offline);
  vi.stubGlobal('navigator', {
    userActivation: {
      get isActive() {
        return active;
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

/** A SoundOut unlocked by a click, its music rendered. */
async function ready(): Promise<{ out: SoundOut; ctx: Ctx }> {
  const out = new SoundOut();
  out.setLevels(false, 70, 50);
  out.unlock();
  await Promise.resolve();
  await Promise.resolve();
  return { out, ctx: Ctx.made[0]! };
}

describe('SoundOut', () => {
  it('creates no audio before a user gesture, then starts it on one', () => {
    const out = new SoundOut();
    active = false;
    out.unlock();
    out.play('move');
    out.music(true);
    expect(Ctx.made).toHaveLength(0);
    active = true;
    out.unlock();
    expect(Ctx.made).toHaveLength(1);
    expect(Ctx.made[0]!.state).toBe('running');
    out.unlock();
    expect(Ctx.made).toHaveLength(1);
  });

  it('plays silent where audio is missing, without throwing', () => {
    vi.stubGlobal('AudioContext', function broken() {
      throw new Error('no audio');
    });
    const out = new SoundOut();
    expect(() => {
      out.unlock();
      out.play('lock');
      out.music(true);
      out.setLevels(true, 0, 0);
    }).not.toThrow();
  });

  it('plays a cue, and cuts off its last sound when it plays again (no stacking)', async () => {
    const { out, ctx } = await ready();
    const before = ctx.oscs.length;
    out.play('clear4');
    const first = ctx.oscs.slice(before);
    expect(first).toHaveLength(VOICES.clear4.length);
    // Each note stops itself once played out.
    expect(first.every((o) => o.stoppedAt !== null && o.stoppedAt > 0.1)).toBe(true);
    ctx.currentTime = 0.1;
    out.play('clear4');
    for (const o of first) expect(o.stoppedAt).toBeCloseTo(0.11);
    expect(ctx.oscs.length - before).toBe(2 * VOICES.clear4.length);
  });

  it('plays a cue caught by the first click before audio has started', () => {
    const out = new SoundOut();
    out.unlock();
    const ctx = Ctx.made[0]!;
    ctx.state = 'suspended';
    out.play('move');
    expect(ctx.oscs.length).toBeGreaterThan(0);
  });

  it('mute stops everything at once and plays nothing after', async () => {
    const { out, ctx } = await ready();
    out.music(true);
    out.play('over');
    const voices = ctx.oscs.slice(-VOICES.over.length);
    const track = ctx.sources[0]!;
    ctx.currentTime = 0.05;
    out.setLevels(true, 70, 50);
    expect(voices.every((o) => o.stoppedAt! < 0.1)).toBe(true);
    expect(track.stopped).toBe(true);
    const count = ctx.oscs.length;
    out.play('move');
    out.music(true);
    expect(ctx.oscs.length).toBe(count);
    expect(ctx.sources).toHaveLength(1);
    // The master gain is ramped to silence.
    expect(ctx.gains.some((g) => g.gain.value === 0)).toBe(true);
  });

  it('music starts once, pauses, and resumes where it stopped', async () => {
    const { out, ctx } = await ready();
    out.music(true);
    out.music(true);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.offset).toBe(0);
    expect(ctx.sources[0]!.loop).toBe(true);
    ctx.currentTime = 3;
    out.music(false);
    out.music(false);
    expect(ctx.sources[0]!.stopped).toBe(true);
    ctx.currentTime = 10;
    out.music(true);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1]!.offset).toBeCloseTo(3);
    // Past the end, the loop wraps.
    ctx.currentTime = 10 + MUSIC_LENGTH;
    out.music(false);
    out.music(true);
    expect(ctx.sources[2]!.offset).toBeCloseTo(3, 1);
  });

  it('music wanted before it finished rendering starts once it is ready', async () => {
    const out = new SoundOut();
    out.unlock();
    out.music(true);
    const ctx = Ctx.made[0]!;
    expect(ctx.sources).toHaveLength(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.sources).toHaveLength(1);
  });
});
