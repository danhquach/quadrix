import { describe, expect, it } from 'vitest';
import css from '../page.css?raw';

/** Comments say "200 ms" too; only the rules count. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(rules)?.[1];
  if (body === undefined) throw new Error(`${selector} is not in page.css`);
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const TIMES = ['--ui-fast', '--ui-enter', '--ui-slow', '--ui-pulse'];

describe('UI timing', () => {
  it('defines each shared timing once, in :root', () => {
    const root = block(':root');
    for (const name of TIMES) expect(root.get(name)).toMatch(/^\d+ms$/);
    expect(root.get('--ui-ease')).toMatch(/^cubic-bezier\(/);
  });

  it('uses no one-off durations: every time is a shared value', () => {
    const root = /:root\s*\{[^}]*\}/.exec(rules)![0];
    const rest = rules.replace(root, '');
    // Off sets the shared values to 0ms; nothing else names a time.
    const times = [...rest.matchAll(/(?<![\w.-])\d*\.?\d+m?s\b/g)].map((m) => m[0]);
    expect(times.every((t) => t === '0ms')).toBe(true);
    for (const decl of rest.match(/(?:transition|animation)(?:-duration)?:[^;]+;/g) ?? [])
      if (!/^(transition|animation): none;$/.test(decl)) expect(decl).toMatch(/var\(--ui-/);
  });

  it('Reduced turns slides and scales into fades', () => {
    const reduced = block(":root[data-effects='reduced']");
    expect(reduced.get('--ui-shift')).toBe('0px');
    expect(reduced.get('--ui-scale')).toBe('1');
  });

  it('Off makes every transition instant', () => {
    const off = block(":root[data-effects='off']");
    for (const name of TIMES) expect(off.get(name)).toBe('0ms');
    expect(off.get('--ui-shift')).toBe('0px');
    expect(off.get('--ui-scale')).toBe('1');
    expect(off.get('--ui-press')).toBe('1');
  });

  it('a leaving panel stops taking clicks at once', () => {
    for (const sel of ['.overlay[hidden]', '.guide[hidden]']) {
      const body = new RegExp(`${sel.replace(/[.[\]]/g, '\\$&')}[^{]*\\{([^}]*)\\}`).exec(rules);
      expect(body?.[1]).toMatch(/pointer-events:\s*none/);
    }
    for (const sel of ['.pause-menu[hidden]', '.tab-panel[hidden]'])
      expect(rules).toMatch(
        new RegExp(`${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{[^}]*pointer-events:\\s*none`),
      );
    // A hidden tab keeps its place but can't be seen or focused.
    expect(rules).toMatch(/\.tab-panel\[hidden\]\s*\{[^}]*visibility:\s*hidden/);
  });
});
