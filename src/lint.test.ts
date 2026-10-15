import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The ESLint config is the guard; push a probe file that breaks each rule
// through it and expect a refusal, and a file that keeps it and expect none.
const eslint = new ESLint();

async function errors(code: string, filePath: string, rules: string[]): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId && rules.includes(m.ruleId)).length;
}

describe('HTML and code sinks', () => {
  const sinks = (code: string) =>
    errors(code, 'src/sink-probe.ts', ['no-restricted-syntax', 'no-implied-eval', 'no-new-func']);

  it.each([
    "document.body.innerHTML = '<img src=x onerror=alert(1)>';",
    "document.body.outerHTML = '<b>x</b>';",
    "document.body['innerHTML'] = '<b>x</b>';",
    "document.body.insertAdjacentHTML('beforeend', '<b>x</b>');",
    "document.write('<b>x</b>');",
    "window.document.writeln('<b>x</b>');",
    "document.body.setHTMLUnsafe('<b>x</b>');",
    "new DOMParser().parseFromString('<b>x</b>', 'text/html');",
    "document.createRange().createContextualFragment('<b>x</b>');",
    "eval('alert(1)');",
    "window.eval('alert(1)');",
    "setTimeout('alert(1)', 0);",
    "new Function('alert(1)')();",
    "Object.assign(document.body, { innerHTML: '<b>x</b>' });",
    "({ innerHTML: document.body.innerHTML } = { innerHTML: '<b>x</b>' });",
    "document.body[`innerHTML`] = '<b>x</b>';",
    "document.createElement('iframe').srcdoc = '<b>x</b>';",
    "document.body.setAttribute('onclick', 'alert(1)');",
    "document.body.setAttribute('ONCLICK', 'alert(1)');",
    "document.createElement('iframe').setAttribute('srcdoc', '<b>x</b>');",
    "document.body.setAttributeNS(null, 'onclick', 'alert(1)');",
  ])('refuses %s', async (code) => {
    expect(await sinks(code)).toBeGreaterThan(0);
  });

  it('refuses a sink inside the engine too', async () => {
    expect(
      await errors(
        "export const x = (el: Element) => { el.innerHTML = '<b>x</b>'; };",
        'src/core/sink-probe.ts',
        ['no-restricted-syntax'],
      ),
    ).toBeGreaterThan(0);
  });

  it('refuses a sink in every linted file type', async () => {
    for (const file of ['tools/probe.mjs', 'tools/probe.cjs', 'src/probe.mts', 'src/probe.tsx']) {
      expect(
        await errors("document.body.innerHTML = '<b>x</b>';", file, ['no-restricted-syntax']),
      ).toBeGreaterThan(0);
    }
  });

  it('allows text and safe attributes', async () => {
    expect(await sinks("document.body.textContent = '<b>x</b>';")).toBe(0);
    expect(await sinks("document.body.setAttribute('aria-label', 'Score');")).toBe(0);
    expect(await sinks('export const read = (el: Element) => el.innerHTML.length;')).toBe(0);
    expect(await sinks('export const log = (s: { write(t: string): void }) => s.write("x");')).toBe(
      0,
    );
  });
});

describe('Math.random', () => {
  const RANDOM_RULES = ['no-restricted-properties', 'no-restricted-syntax'];
  const random = (filePath: string, code = 'export const roll = () => Math.random();') =>
    errors(code, filePath, RANDOM_RULES);

  it.each(['src/main.ts', 'src/core/game.ts', 'src/core/modes/classic.ts'])(
    'refuses it in %s',
    async (file) => {
      expect(await random(file)).toBeGreaterThan(0);
    },
  );

  it.each([
    "export const roll = () => Math['random']();",
    'export const roll = () => globalThis.Math.random();',
    "export const roll = () => window.Math['random']();",
    'const { random } = Math;\nexport const roll = () => random();',
  ])('refuses the alias %s', async (code) => {
    expect(await random('src/main.ts', code)).toBeGreaterThan(0);
  });

  it('allows it only in the seeded RNG', async () => {
    expect(await random('src/core/pieces.ts')).toBe(0);
    expect(
      await random('src/core/pieces.ts', 'export const roll = () => globalThis.Math.random();'),
    ).toBe(0);
  });
});

describe('pure engine', () => {
  const core = (code: string, filePath = 'src/core/purity-probe.ts') =>
    errors(code, filePath, [
      'no-restricted-globals',
      'no-restricted-imports',
      'no-restricted-syntax',
    ]);

  it.each([
    'export const w = window.innerWidth;',
    "export const el = document.getElementById('board');",
    "export const v = localStorage.getItem('save');",
    "export const v = sessionStorage.getItem('save');",
    "export const db = indexedDB.open('save');",
    'export const ua = navigator.userAgent;',
    "export const r = fetch('/x');",
    'export const id = requestAnimationFrame(() => {});',
    'export const href = location.href;',
    "export const el = globalThis.document.getElementById('board');",
    "export const v = self.localStorage.getItem('save');",
    'export const w = top.innerWidth;',
  ])('refuses the global in %s', async (code) => {
    expect(await core(code)).toBeGreaterThan(0);
  });

  it.each([
    "import '../main.ts';",
    "import '../../main';",
    "import { x } from '../ui/hud.ts';",
    "import { x } from '../storage/save.ts';",
    "import '../page.css';",
    "export const m = () => import('../main.ts');",
  ])('refuses the import %s', async (code) => {
    expect(await core(code)).toBeGreaterThan(0);
  });

  it('allows engine-internal imports', async () => {
    expect(await core("import { classic } from './modes/classic.ts';\nexport { classic };")).toBe(
      0,
    );
  });

  it('lets the UI layer use the page', async () => {
    expect(await core("export const el = document.getElementById('board');", 'src/main.ts')).toBe(
      0,
    );
  });
});
