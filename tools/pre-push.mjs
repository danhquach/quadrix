// Git's pre-push hook (.githooks/pre-push): a push to any branch but main must
// raise the version over origin's main, the check CI runs on every PR
// (tools/version-checks.mjs), so a missed bump stops here instead of in CI.
// It checks the tip commit of each pushed branch, not the working tree, and
// always compares with origin's main (where PRs land), whatever the push goes to.
//   git push --no-verify   skips it
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { bumpProblems, printable, pushedBranches } from './version-checks.mjs';

const SKIP = 'git push --no-verify skips this check';

const shas = pushedBranches(readFileSync(0, 'utf8'));
if (!shas.length) process.exit(0);

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // A large package-lock.json must not overflow the default 1 MB.
    maxBuffer: 64 * 1024 * 1024,
  });
const json = (rev, file) => JSON.parse(git('show', `${rev}:${file}`));

try {
  git('fetch', '--quiet', '--no-tags', 'origin', 'main');
} catch {
  console.error(
    "pre-push: could not fetch origin's main to compare the version.\n" +
      `Push again once it can be reached (${SKIP}).`,
  );
  process.exit(1);
}

let failed = false;
// Set when a version (not an unreadable file) is what stops the push.
let raise = false;
// A version that isn't text reads as none, so bumpProblems refuses it.
const text = (v) => (typeof v === 'string' ? v : '');
const fail = (message) => {
  failed = true;
  console.error(`pre-push: ${printable(message)}`);
};
let base;
let mainRead = true;
try {
  base = text(json('FETCH_HEAD', 'package.json').version);
} catch {
  mainRead = false;
  fail("cannot read package.json on origin's main");
}
// A main with no usable version is refused by bumpProblems, never let through.
for (const sha of mainRead ? shas : []) {
  const at = sha.slice(0, 7);
  let head;
  let lock;
  try {
    head = text(json(sha, 'package.json').version);
    lock = json(sha, 'package-lock.json');
  } catch {
    fail(`cannot read package.json and package-lock.json at ${at}`);
    continue;
  }
  const found = bumpProblems({
    base,
    head,
    locks: [text(lock?.version), text(lock?.packages?.['']?.version)],
  });
  if (found.length) {
    fail(`${at} can't land on main:\n  ${found.join('\n  ')}`);
    raise = true;
  }
}
if (raise) console.error('Commit the raised version and push again.');
if (failed) {
  console.error(`(${SKIP}.)`);
  process.exit(1);
}
