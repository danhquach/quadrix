import type { GameEvent } from '../core/events.ts';
import { ParticlePool, type ParticleSpec } from './particles.ts';

/** Full plays everything; Reduced short fades only; Off nothing at all. */
export type EffectsLevel = 'full' | 'reduced' | 'off';
export const EFFECTS_LEVELS: readonly EffectsLevel[] = ['full', 'reduced', 'off'];

/**
 * Where an effect draws on the board canvas, bottom to top: under the blocks, over the
 * blocks, over the falling piece. The HUD is the page above the canvas.
 */
export type Layer = 'background' | 'board' | 'effects';

/** One running effect, on the effects clock; positions are in board cells. */
export interface Effect {
  readonly layer: Layer;
  /** Shake, particles or large movement: Full only. A short fade is not motion. */
  readonly motion: boolean;
  /** Advance by `dt` ms. Returns whether it is still running. */
  update(dt: number): boolean;
  /** Draw at `cell` canvas pixels to a board cell. */
  draw(ctx: CanvasRenderingContext2D, cell: number): void;
}

/** Plugs effects into the event stream: called for every game event. */
export type EffectSource = (event: GameEvent, fx: Effects) => void;

/** Running effects at most; past this, new ones are dropped. */
export const MAX_EFFECTS = 64;
/** The longest step one frame may take: back from a hidden tab, nothing jumps. */
export const MAX_FRAME_MS = 100;

/**
 * Runs the effects over the board. Presentation only: it reads game events and never
 * touches a game. Its clock only moves while play does, so pausing freezes every
 * effect where it is and resuming carries on from there.
 */
export class Effects {
  readonly particles = new ParticlePool();
  private running: Effect[] = [];
  private readonly sources: EffectSource[] = [];
  private levelNow: EffectsLevel;

  constructor(level: EffectsLevel = 'full') {
    this.levelNow = level;
  }

  get level(): EffectsLevel {
    return this.levelNow;
  }

  /** Change the level; whatever the new level doesn't allow stops now. */
  set level(level: EffectsLevel) {
    this.levelNow = level;
    if (level !== 'full') this.particles.clear();
    this.running = this.running.filter((e) => this.allows(e));
  }

  /** Running effects, particles not included. */
  get active(): number {
    return this.running.length;
  }

  /** Have `source` turn game events into effects from now on. */
  use(source: EffectSource): void {
    this.sources.push(source);
  }

  /** Pass this frame's game events to every source. With Effects off, nothing listens. */
  handle(events: readonly GameEvent[]): void {
    if (this.levelNow === 'off') return;
    for (const event of events) for (const source of this.sources) source(event, this);
  }

  /** Start `effect` if the level allows it and there is room. Returns whether it started. */
  add(effect: Effect): boolean {
    if (!this.allows(effect) || this.running.length >= MAX_EFFECTS) return false;
    this.running.push(effect);
    return true;
  }

  /** Start a particle: Full only, and only while the pool has room. */
  spawn(spec: ParticleSpec): boolean {
    return this.levelNow === 'full' && this.particles.spawn(spec);
  }

  /** Advance every effect by `dt` ms, unless paused: then nothing moves. */
  frame(dt: number, paused: boolean): void {
    if (paused) return;
    const step = Math.min(MAX_FRAME_MS, Math.max(0, dt));
    this.particles.update(step);
    this.running = this.running.filter((e) => e.update(step));
  }

  /** Draw the effects on `layer`; particles go on the effects layer. */
  draw(ctx: CanvasRenderingContext2D, layer: Layer, cell: number): void {
    for (const e of this.running) if (e.layer === layer) e.draw(ctx, cell);
    if (layer === 'effects') this.particles.draw(ctx, cell);
  }

  /** Stop everything: a new game starts clean. */
  clear(): void {
    this.running = [];
    this.particles.clear();
  }

  private allows(e: Effect): boolean {
    return this.levelNow === 'full' || (this.levelNow === 'reduced' && !e.motion);
  }
}
