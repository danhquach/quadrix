// npm's prepare step (runs on npm ci and npm install): points git at the
// versioned hooks in .githooks, so every clone gets the pre-push version check.
// It never fails the install: outside a git checkout (an installed package)
// there is nothing to set up, and a hooks folder of your own is left in place.
import { execFileSync } from 'node:child_process';

const HOOKS = '.githooks';
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

try {
  git('rev-parse', '--is-inside-work-tree');
} catch {
  process.exit(0);
}
let current = '';
try {
  current = git('config', '--get', 'core.hooksPath');
} catch {
  // Not set yet.
}
if (current && current !== HOOKS) {
  console.warn(
    `git's core.hooksPath is ${current}, so the pre-push version check in ${HOOKS} is not set up.`,
  );
  process.exit(0);
}
try {
  git('config', 'core.hooksPath', HOOKS);
} catch {
  console.warn(`Could not point git at ${HOOKS}; the pre-push version check is not set up.`);
}
