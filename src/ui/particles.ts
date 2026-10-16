/** Live particles at most, across every effect. */
export const MAX_PARTICLES = 300;

/** One particle, in board cells: position, velocity and fall per second, size, colour. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  color: string;
  /** Age and lifetime in ms; it fades out as it ages and goes at its lifetime. */
  age: number;
  life: number;
}

/** What a new particle starts with; anything left out is 0 (size 0.2, lifetime 500 ms). */
export type ParticleSpec = Partial<Omit<Particle, 'age'>> & { color: string };

/** The canvas calls particles need. */
export type ParticlePaint = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'globalAlpha' | 'fillRect'
>;

/**
 * A fixed pool of particles. Every particle is made once, up front; a spent one is
 * recycled for the next spawn, so frames create and free nothing. Live ones are the
 * first `count` in the pool.
 */
export class ParticlePool {
  readonly capacity: number;
  private readonly pool: Particle[];
  private live = 0;

  constructor(capacity = MAX_PARTICLES) {
    this.capacity = capacity;
    this.pool = Array.from({ length: capacity }, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      gravity: 0,
      size: 0,
      color: '',
      age: 0,
      life: 0,
    }));
  }

  get count(): number {
    return this.live;
  }

  /** Start a particle, or none when the pool is full. Returns whether one started. */
  spawn(spec: ParticleSpec): boolean {
    if (this.live >= this.capacity) return false;
    const p = this.pool[this.live++]!;
    p.x = spec.x ?? 0;
    p.y = spec.y ?? 0;
    p.vx = spec.vx ?? 0;
    p.vy = spec.vy ?? 0;
    p.gravity = spec.gravity ?? 0;
    p.size = spec.size ?? 0.2;
    p.color = spec.color;
    // At least 1 ms, so its fade never divides by zero.
    p.life = Math.max(1, spec.life ?? 500);
    p.age = 0;
    return true;
  }

  /** Age and move every live particle by `dt` ms; spent ones go back to the pool. */
  update(dt: number): void {
    const s = dt / 1000;
    for (let i = 0; i < this.live;) {
      const p = this.pool[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        // Swap the spent one past the live end; the swapped-in one is checked next.
        this.pool[i] = this.pool[this.live - 1]!;
        this.pool[--this.live] = p;
        continue;
      }
      p.vy += p.gravity * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
      i++;
    }
  }

  /** Draw the live particles as squares, `cell` canvas pixels to a board cell. */
  draw(ctx: ParticlePaint, cell: number): void {
    for (let i = 0; i < this.live; i++) {
      const p = this.pool[i]!;
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      const size = p.size * cell;
      ctx.fillRect(p.x * cell - size / 2, p.y * cell - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  /** Drop every live particle. */
  clear(): void {
    this.live = 0;
  }
}
