import { MUSIC, MUSIC_LENGTH, VOICES, gainOf, type Cue, type Note } from './sound.ts';

/** Fade in and out for every note, so none starts or stops with a click. */
const FADE = 0.005;

/** A note being played: its oscillator and its envelope. */
interface Voice {
  readonly osc: OscillatorNode;
  readonly env: GainNode;
}

/** Schedule `notes` into `out`, starting at `t0` (seconds on `ctx`'s clock). */
function schedule(
  ctx: BaseAudioContext,
  out: AudioNode,
  notes: readonly Note[],
  t0: number,
): Voice[] {
  return notes.map((n) => {
    const start = t0 + n.start;
    const end = start + n.dur;
    const osc = ctx.createOscillator();
    osc.type = n.wave;
    osc.frequency.setValueAtTime(n.freq, start);
    if (n.to !== undefined) osc.frequency.exponentialRampToValueAtTime(n.to, end);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(n.gain, start + FADE);
    env.gain.exponentialRampToValueAtTime(0.001, end);
    env.gain.linearRampToValueAtTime(0, end + FADE);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(end + 2 * FADE);
    return { osc, env };
  });
}

/** Fade a voice out now and stop it. */
function silence(ctx: BaseAudioContext, v: Voice): void {
  const now = ctx.currentTime;
  v.env.gain.cancelScheduledValues(now);
  v.env.gain.setValueAtTime(v.env.gain.value, now);
  v.env.gain.linearRampToValueAtTime(0, now + FADE);
  v.osc.stop(now + 2 * FADE);
}

/**
 * The game's sound effects and music, all synthesized with Web Audio (no audio files).
 * Nothing is created until the player's first click or key press (browser autoplay
 * rules); until then every call is a quiet no-op.
 */
export class SoundOut {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private muted = false;
  private sfxVolume = 0;
  private musicVolume = 0;
  /** Each cue's notes, stopped when that cue plays again (no stacking) or on mute. */
  private readonly voices = new Map<Cue, Voice[]>();
  /** The music loop, rendered once from MUSIC. */
  private loop: AudioBuffer | null = null;
  private track: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** When the playing loop's start would have been (context time). */
  private trackStart = 0;
  /** Where in the loop the music stopped, to carry on from there. */
  private offset = 0;
  private wantMusic = false;

  /**
   * Start audio, from an input handler. A browser only allows it after the player's
   * first click or key press; before that (or for a key like Esc that doesn't count)
   * this waits, so no context is refused and no autoplay warning is logged.
   */
  unlock(): void {
    if (!this.ctx) {
      if (navigator.userActivation && !navigator.userActivation.isActive) return;
      try {
        this.build(new AudioContext());
      } catch {
        return; // No audio here: the game plays silent.
      }
    }
    if (this.ctx!.state !== 'running') this.ctx!.resume().catch(() => {});
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    // A limiter at the end: effects and music together never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(limiter).connect(ctx.destination);
    this.apply();
    void this.render(ctx.sampleRate);
  }

  /** Render the music loop offline, once; it starts when the game wants it. */
  private async render(rate: number): Promise<void> {
    try {
      const off = new OfflineAudioContext(1, Math.ceil(MUSIC_LENGTH * rate), rate);
      schedule(off, off.destination, MUSIC, 0);
      this.loop = await off.startRendering();
      this.music(this.wantMusic);
    } catch {
      // No music, effects still play.
    }
  }

  /** Mute (everything stops at once) and the effects and music volumes, 0–100. */
  setLevels(muted: boolean, sfxVolume: number, musicVolume: number): void {
    this.muted = muted;
    this.sfxVolume = sfxVolume;
    this.musicVolume = musicVolume;
    this.apply();
  }

  private apply(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Mute fades in FADE: at once to the ear, without a click.
    const master = this.master!.gain;
    master.cancelScheduledValues(now);
    master.setValueAtTime(master.value, now);
    master.linearRampToValueAtTime(this.muted ? 0 : 1, now + FADE);
    this.sfx!.gain.setValueAtTime(gainOf(this.sfxVolume), now);
    this.musicBus!.gain.setValueAtTime(gainOf(this.musicVolume), now);
    if (this.muted) {
      for (const vs of this.voices.values()) for (const v of vs) silence(ctx, v);
      this.voices.clear();
    }
    this.music(this.wantMusic);
  }

  /**
   * Play `cue` now, cutting off its previous sound if that is still going. While the
   * first click's resume is still pending, it plays as soon as audio starts.
   */
  play(cue: Cue): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state === 'closed') return;
    for (const v of this.voices.get(cue) ?? []) silence(ctx, v);
    this.voices.set(cue, schedule(ctx, this.sfx!, VOICES[cue], ctx.currentTime));
  }

  /** Whether the music should play; call freely, it only acts on a change. */
  music(on: boolean): void {
    this.wantMusic = on;
    const ctx = this.ctx;
    if (!ctx || !this.loop) return;
    const play = on && !this.muted;
    if (play && !this.track) {
      const src = ctx.createBufferSource();
      src.buffer = this.loop;
      src.loop = true;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + FADE);
      src.connect(gain).connect(this.musicBus!);
      src.start(now, this.offset);
      this.trackStart = now - this.offset;
      this.track = { src, gain };
    } else if (!play && this.track) {
      const now = ctx.currentTime;
      this.offset = (now - this.trackStart) % this.loop.duration;
      // From wherever its fade-in got to, so a pause right after a start can't click.
      const g = this.track.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + FADE);
      this.track.src.stop(now + 2 * FADE);
      this.track = null;
    }
  }
}
