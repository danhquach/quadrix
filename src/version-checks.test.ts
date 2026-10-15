import { describe, expect, it } from 'vitest';
import { bumpProblems, printable, pushedBranches } from '../tools/version-checks.mjs';

describe('bumpProblems', () => {
  const bump = (base: string, head: string, locks = [head, head]): string[] =>
    bumpProblems({ base, head, locks });

  it('lets a higher version through', () => {
    expect(bump('0.6.1', '0.6.2')).toEqual([]);
    expect(bump('0.6.9', '0.7.0')).toEqual([]);
    expect(bump('0.9.9', '1.0.0')).toEqual([]);
    expect(bump('0.6.9', '0.6.10')).toEqual([]);
  });

  it('refuses the same or a lower version', () => {
    expect(bump('0.6.2', '0.6.2')).toHaveLength(1);
    expect(bump('0.7.0', '0.6.9')).toHaveLength(1);
    expect(bump('1.0.0', '0.9.9')).toHaveLength(1);
    // Compared as numbers, not text.
    expect(bump('0.6.10', '0.6.9')).toHaveLength(1);
  });

  it("refuses when main's version is not x.y.z", () => {
    expect(bump('', '0.6.2')).toHaveLength(1);
    expect(bump(undefined as unknown as string, '0.6.2')).toHaveLength(1);
  });

  it('refuses a version that is not x.y.z', () => {
    expect(bump('0.6.1', '0.6.2-beta')).toHaveLength(1);
    expect(bump('0.6.1', 'v0.6.2')).toHaveLength(1);
    expect(bump('0.6.1', '00.6.2')).toHaveLength(1);
  });

  it('refuses a lockfile that names another version', () => {
    expect(bump('0.6.1', '0.6.2', ['0.6.1', '0.6.2'])).toHaveLength(1);
    expect(bump('0.6.1', '0.6.2', ['0.6.2', '0.6.1'])).toHaveLength(1);
    expect(bump('0.6.1', '0.6.2', ['0.6.2', undefined as unknown as string])).toHaveLength(1);
  });
});

describe('pushedBranches', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const zero = '0'.repeat(40);
  const line = (sha: string, remoteRef: string): string =>
    `refs/heads/x ${sha} ${remoteRef} ${zero}`;

  it('checks every commit pushed to a branch other than main', () => {
    expect(pushedBranches(`${line(a, 'refs/heads/issue-1-x')}\n`)).toEqual([a]);
    expect(
      pushedBranches([line(a, 'refs/heads/issue-1-x'), line(b, 'refs/heads/issue-2-y')].join('\n')),
    ).toEqual([a, b]);
  });

  it('leaves main, tags and branch deletes alone', () => {
    expect(pushedBranches(line(a, 'refs/heads/main'))).toEqual([]);
    expect(pushedBranches(line(a, 'refs/tags/v0.6.2'))).toEqual([]);
    expect(pushedBranches(line(a, 'refs/for/main'))).toEqual([]);
    expect(pushedBranches(line(zero, 'refs/heads/issue-1-x'))).toEqual([]);
    // A branch merely named like main is still checked.
    expect(pushedBranches(line(a, 'refs/heads/main-fix'))).toEqual([a]);
  });

  it('checks only full object names', () => {
    const sha256 = 'c'.repeat(64);
    expect(pushedBranches(line(sha256, 'refs/heads/issue-1-x'))).toEqual([sha256]);
    for (const bad of ['--upload-pack=x', 'HEAD', 'a'.repeat(39), 'A'.repeat(40), `${a}:x`]) {
      expect(pushedBranches(line(bad, 'refs/heads/issue-1-x'))).toEqual([]);
    }
  });

  it('checks nothing on an empty or malformed push', () => {
    expect(pushedBranches('')).toEqual([]);
    expect(pushedBranches('\n\n')).toEqual([]);
    expect(pushedBranches('refs/heads/x')).toEqual([]);
  });
});

describe('printable', () => {
  it('keeps plain text and its line breaks', () => {
    expect(printable('version 0.2.0 ok\nnext')).toBe('version 0.2.0 ok\nnext');
  });

  it('drops terminal escapes and other control characters', () => {
    expect(printable('0.2.0\u001b[2J\u001b]0;title\u0007\r\t\u0085')).toBe('0.2.0[2J]0;title');
  });

  it('drops bidi overrides and zero-width characters', () => {
    expect(printable('0.\u202e2.0\u2066\u200b\u200d\ufeff')).toBe('0.2.0');
  });

  it('reports a hostile version without its escapes', () => {
    const found = bumpProblems({ base: '0.1.0', head: '1.0.0\n::error::x\u001b[31m', locks: [] });
    expect(found.length).toBeGreaterThan(0);
    for (const line of found.map((p) => printable(p).replaceAll('\n', ' '))) {
      expect(line).not.toContain('\n');
      expect(line).not.toContain('\u001b');
    }
  });
});
