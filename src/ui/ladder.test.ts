import { describe, expect, it } from 'vitest';
import { MAX_RUNGS, rung, rungStars } from '../core/ladder.ts';
import { LOCKED_SHOWN, PAGE, ladderPage, ladderTop, objectiveView, starText } from './ladder.ts';

describe('ladder page', () => {
  it('shows a new player rung 1 as current with locked rungs above', () => {
    const page = ladderPage('', 1, ladderTop(1));
    expect(page.rows.map((r) => [r.index, r.state])).toEqual([
      [4, 'locked'],
      [3, 'locked'],
      [2, 'locked'],
      [1, 'current'],
    ]);
    expect(page.higher).toBe(false);
    expect(page.lower).toBe(false);
  });

  it('lists passed rungs with their best stars, highest first', () => {
    const page = ladderPage('321', 4, ladderTop(4));
    expect(page.rows.map((r) => [r.index, r.state, r.stars])).toEqual([
      [7, 'locked', 0],
      [6, 'locked', 0],
      [5, 'locked', 0],
      [4, 'current', 0],
      [3, 'passed', 1],
      [2, 'passed', 2],
      [1, 'passed', 3],
    ]);
  });

  it('builds one page only, thousands of rungs up', () => {
    const stars = '3'.repeat(4999);
    const page = ladderPage(stars, 5000, ladderTop(5000));
    expect(page.rows).toHaveLength(PAGE);
    expect(page.rows[0]!.index).toBe(5000 + LOCKED_SHOWN);
    expect(page.rows.find((r) => r.state === 'current')!.index).toBe(5000);
    expect(page.higher).toBe(false);
    expect(page.lower).toBe(true);

    const lower = ladderPage(stars, 5000, page.top - PAGE);
    expect(lower.rows[0]!.index).toBe(page.top - PAGE);
    expect(lower.rows.every((r) => r.state === 'passed' && r.stars === 3)).toBe(true);
    expect(lower.higher).toBe(true);
  });

  it('clamps the page to the list', () => {
    const stars = '1'.repeat(199);
    expect(ladderPage(stars, 200, 10_000).top).toBe(ladderTop(200));
    const bottom = ladderPage(stars, 200, -5);
    expect(bottom.top).toBe(PAGE);
    expect(bottom.rows.at(-1)!.index).toBe(1);
    expect(bottom.lower).toBe(false);
    for (const bad of [NaN, Infinity, 1.5]) expect(ladderPage(stars, 200, bad).top).toBe(203);
  });

  it('shows no locked rungs above the last one', () => {
    const page = ladderPage('2'.repeat(MAX_RUNGS), MAX_RUNGS, ladderTop(MAX_RUNGS));
    expect(page.top).toBe(MAX_RUNGS);
    expect(page.rows[0]).toEqual({ index: MAX_RUNGS, state: 'current', stars: 2 });
  });
});

describe('starText', () => {
  it('shows filled then empty stars', () => {
    expect([0, 1, 2, 3].map(starText)).toEqual(['☆☆☆', '★☆☆', '★★☆', '★★★']);
    expect([-1, 4, NaN, 1.5].map(starText)).toEqual(['☆☆☆', '★★★', '☆☆☆', '☆☆☆']);
  });
});

describe('rung objective tracker', () => {
  const r = rung(1);

  it('shows lines toward the goal, pieces used and both star targets', () => {
    expect(objectiveView(r, 3, 9)).toEqual({
      lines: `3 / ${r.goalLines}`,
      pieces: '9',
      three: `★★★ ≤ ${r.stars.three}`,
      two: `★★ ≤ ${r.stars.two}`,
      threeLost: false,
      twoLost: false,
    });
  });

  it('caps lines at the goal (a final multi-line clear passes it)', () => {
    expect(objectiveView(r, r.goalLines + 3, 1).lines).toBe(`${r.goalLines} / ${r.goalLines}`);
  });

  it('marks a target lost only once pieces pass it, matching the stars awarded', () => {
    for (const index of [1, 2, 3, 7, 64, 1000, MAX_RUNGS]) {
      const ri = rung(index);
      for (let pieces = 0; pieces <= ri.stars.two + 2; pieces++) {
        const v = objectiveView(ri, 0, pieces);
        const stars = rungStars(ri, pieces);
        expect(v.threeLost).toBe(stars < 3);
        expect(v.twoLost).toBe(stars < 2);
      }
    }
  });
});
