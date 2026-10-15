import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Every use of Math.random is banned. Games must be reproducible from a seed, so
// the only randomness source is the seeded generator in src/core/pieces.ts.
const RNG_FILE = 'src/core/pieces.ts';
const RANDOM = `Use the seeded RNG from ${RNG_FILE} instead of Math.random.`;
const noMathRandom = {
  'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: RANDOM }],
};
// globalThis.Math.random and window.Math['random'] reach it through an alias.
const RANDOM_SYNTAX = [
  {
    selector:
      "MemberExpression[object.property.name='Math'][property.name='random'], MemberExpression[object.property.name='Math'][property.value='random']",
    message: RANDOM,
  },
  // const { random } = Math
  {
    selector: "VariableDeclarator[init.name='Math'] > ObjectPattern > Property[key.name='random']",
    message: RANDOM,
  },
];

// No HTML sinks anywhere: all text reaches the page through textContent, so
// player-typed or stored text can never inject markup.
const HTML_SINK = 'Render text with textContent / DOM nodes, never as HTML.';
const SINK_PROPS = /^(innerHTML|outerHTML|srcdoc)$/.source;
const SINK_SYNTAX = [
  // el.innerHTML = … and el['innerHTML'] = …
  {
    selector: `AssignmentExpression > MemberExpression[property.name=/${SINK_PROPS}/], AssignmentExpression > MemberExpression[property.value=/${SINK_PROPS}/]`,
    message: HTML_SINK,
  },
  // Object.assign(el, { innerHTML }) and ({ innerHTML: el.innerHTML } = …)
  {
    selector: `Property[key.name=/${SINK_PROPS}/], Property[key.value=/${SINK_PROPS}/]`,
    message: HTML_SINK,
  },
  // el[`innerHTML`] = …: a template-literal key hides the name from the rules above.
  {
    selector: "AssignmentExpression > MemberExpression[property.type='TemplateLiteral']",
    message: HTML_SINK,
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(insertAdjacentHTML|setHTMLUnsafe|parseFromString|createContextualFragment)$/]',
    message: HTML_SINK,
  },
  // document.write(…) and window.document.write(…), not any stream's write().
  {
    selector:
      "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/], CallExpression[callee.object.property.name='document'][callee.property.name=/^(write|writeln)$/]",
    message: HTML_SINK,
  },
  // setAttribute('srcdoc' | 'onclick', …) writes markup or code too.
  {
    selector:
      "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(srcdoc|on)/i], CallExpression[callee.property.name='setAttributeNS'][arguments.1.value=/^(srcdoc|on)/i]",
    message: HTML_SINK,
  },
  // eval(…) and window.eval(…)
  {
    selector: "CallExpression[callee.name='eval'], CallExpression[callee.property.name='eval']",
    message: 'No eval.',
  },
];
const noHtmlSinks = {
  // setTimeout('code') and new Function('code') are eval too.
  'no-implied-eval': 'error',
  'no-new-func': 'error',
};

// src/core/** is the pure engine: it runs under Vitest with no page present.
// Dependencies point inward: the UI may import core, never the reverse.
const CORE_MESSAGE =
  'src/core must stay pure: no DOM, no storage, no UI imports. Pass data in from the UI layer.';
const CORE_SYNTAX = [
  // import('../main.ts') slips past no-restricted-imports; the engine needs no lazy loading.
  { selector: 'ImportExpression', message: CORE_MESSAGE },
];
const pureCore = {
  'no-restricted-globals': [
    'error',
    ...[
      'window',
      // globalThis.document and self.localStorage reach the page through an alias.
      'globalThis',
      'self',
      'top',
      'parent',
      'frames',
      'document',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'navigator',
      'location',
      'fetch',
      'requestAnimationFrame',
    ].map((name) => ({ name, message: CORE_MESSAGE })),
  ],
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/ui/**', '**/storage/**', '**/main', '**/main.ts', '*.css', '**/*.css'],
          message: CORE_MESSAGE,
        },
      ],
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...noMathRandom,
      ...noHtmlSinks,
      'no-restricted-syntax': ['error', ...SINK_SYNTAX, ...RANDOM_SYNTAX],
    },
  },
  {
    files: ['src/core/**/*.{ts,mts,cts,tsx}'],
    rules: {
      ...pureCore,
      'no-restricted-syntax': ['error', ...SINK_SYNTAX, ...RANDOM_SYNTAX, ...CORE_SYNTAX],
    },
  },
  {
    files: [RNG_FILE],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': ['error', ...SINK_SYNTAX, ...CORE_SYNTAX],
    },
  },
  prettier,
);
