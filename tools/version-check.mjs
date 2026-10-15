// CI's version check (tools/version-checks.mjs).
//   node tools/version-check.mjs bump <base-ref>  a PR raises the version over <base-ref>'s
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { bumpProblems, printable } from './version-checks.mjs';

const version = (text) => JSON.parse(text).version;
const head = version(readFileSync('package.json', 'utf8'));
const [mode, ref] = process.argv.slice(2);

if (mode !== 'bump' || !ref) {
  console.error('usage: node tools/version-check.mjs bump <base-ref>');
  process.exit(2);
}
const base = version(execFileSync('git', ['show', `${ref}:package.json`], { encoding: 'utf8' }));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const found = bumpProblems({ base, head, locks: [lock.version, lock.packages?.['']?.version] });
if (found.length) {
  // One line per problem: a version holding a line break could otherwise start a
  // ::workflow-command:: line in CI's log.
  console.error(found.map((p) => printable(p).replaceAll('\n', ' ')).join('\n'));
  process.exit(1);
}
console.log(printable(`version ${head} ok`));
