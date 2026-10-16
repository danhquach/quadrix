import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES, ParticlePool, type ParticlePaint } from './particles.ts';

/** A canvas stand-in that records the squares drawn. */
function paint(): ParticlePaint & { rects: number[][]; alphas: number[] } {
  const rects: number[][] = [];
  const alphas: number[] = [];
  return {
    rects,
    alphas,
    fillStyle: '',
    globalAlpha: 1,
    fillRect(x, y, w, h) {
      rects.push([x, y, w, h]);
      alphas.push(this.globalAlpha);
    },
  };
}

describe('ParticlePool', () => {
  it('holds at most 300 live particles', () => {
    const pool = new ParticlePool();
    expect(pool.capacity).toBe(MAX_PARTICLES);
    expect(MAX_PARTICLES).toBe(300);
    let started = 0;
    for (let i = 0; i < 1000; i++) if (pool.spawn({ color: '#fff' })) started++;
    expect(started).toBe(300);
    expect(pool.count).toBe(300);
  });

  it('recycles its particles: the same objects, never new ones', () => {
    const pool = new ParticlePool(10);
    const objects = new Set<object>();
    const peek = () => (pool as unknown as { pool: object[] }).pool;
    for (const p of peek()) objects.add(p);
    for (let frame = 0; frame < 50; frame++) {
      while (pool.spawn({ color: '#fff', life: 30 }));
      pool.update(16);
    }
    expect(peek()).toHaveLength(10);
    for (const p of peek()) expect(objects.has(p)).toBe(true);
  });

  it('moves particles by velocity and gravity, in cells per second', () => {
    const pool = new ParticlePool(1);
    pool.spawn({ x: 1, y: 2, vx: 2, vy: 0, gravity: 10, color: '#fff', life: 10_000 });
    pool.update(500);
    const ctx = paint();
    pool.draw(ctx, 10);
    const [x, y, w] = ctx.rects[0]!;
    // vx 2 for 0.5 s is 1 cell; vy grows to 5 then moves 2.5 cells.
    expect(x! + w! / 2).toBeCloseTo(20);
    expect(y! + w! / 2).toBeCloseTo(45);
  });

  it('fades out as it ages and goes at its lifetime', () => {
    const pool = new ParticlePool(1);
    pool.spawn({ color: '#fff', life: 100 });
    pool.update(50);
    const ctx = paint();
    pool.draw(ctx, 10);
    expect(ctx.alphas[0]).toBeCloseTo(0.5);
    expect(ctx.globalAlpha).toBe(1);
    pool.update(50);
    expect(pool.count).toBe(0);
  });

  it('keeps the survivors when one in the middle dies', () => {
    const pool = new ParticlePool(3);
    pool.spawn({ color: 'a', life: 100 });
    pool.spawn({ color: 'b', life: 10 });
    pool.spawn({ color: 'c', life: 100 });
    pool.update(20);
    expect(pool.count).toBe(2);
    const ctx = paint();
    const seen: string[] = [];
    const tracking = {
      ...ctx,
      fillRect() {
        seen.push(String(tracking.fillStyle));
      },
    };
    pool.draw(tracking, 10);
    expect(seen.sort()).toEqual(['a', 'c']);
  });

  it('clear drops every live particle', () => {
    const pool = new ParticlePool(5);
    while (pool.spawn({ color: '#fff' }));
    pool.clear();
    expect(pool.count).toBe(0);
    expect(pool.spawn({ color: '#fff' })).toBe(true);
  });
});
