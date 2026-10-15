// The version checks (package.json "version"), apart from git and the file
// system so they can be tested. Every PR to main raises the version, so each
// deploy ships a new number.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** [major, minor, patch], or null when `v` isn't a plain x.y.z version. */
function parts(v) {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Why a PR's version may not land on main; empty when it may.
 * @param {{ base: string, head: string, locks: string[] }} versions
 *   `base` is main's version, `head` the PR's, `locks` the versions the PR's
 *   package-lock.json names (its own and its root package's).
 * @returns {string[]}
 */
export function bumpProblems({ base, head, locks }) {
  const problems = [];
  const b = parts(base);
  const h = parts(head);
  if (!h) problems.push(`The version "${head}" is not x.y.z`);
  if (!b) problems.push(`main's version "${base}" is not x.y.z`);
  const stale = locks.filter((v) => v !== head);
  if (stale.length) {
    problems.push(
      `package-lock.json says ${stale.join(', ')}, package.json ${head}: run npm install`,
    );
  }
  if (h && b) {
    const higher = h[0] - b[0] || h[1] - b[1] || h[2] - b[2];
    if (higher <= 0) {
      problems.push(
        `The version ${head} is not higher than main's ${base}: raise it (npm version patch --no-git-tag-version)`,
      );
    }
  }
  return problems;
}

const ZERO = /^0+$/;
// A full object name: SHA-1 (40 hex digits) or SHA-256 (64).
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The tip commit of each branch a push sends, other than main, which must
 * raise the version over main's; tags, other refs and branch deletes are left to CI.
 * @param {string} lines git's pre-push stdin: "<local ref> <local sha> <remote ref> <remote sha>" per line
 * @returns {string[]} the local commits to check
 */
export function pushedBranches(lines) {
  const shas = [];
  for (const line of lines.split('\n')) {
    const [, sha, remoteRef] = line.trim().split(/\s+/);
    if (!sha || !remoteRef || ZERO.test(sha) || !SHA.test(sha)) continue;
    if (!remoteRef.startsWith('refs/heads/') || remoteRef === 'refs/heads/main') continue;
    shas.push(sha);
  }
  return shas;
}

const HIDDEN = new Set([0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0xfeff]);

/**
 * `message` with control characters (other than its own line breaks), bidi
 * overrides and zero-width characters dropped. Versions come from commits and
 * the remote, so none of those reach the terminal or CI's log.
 * @param {string} message
 * @returns {string}
 */
export const printable = (message) =>
  [...message]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      if (ch === '\n') return true;
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
      if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return false;
      return !HIDDEN.has(code);
    })
    .join('');
