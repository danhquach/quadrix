import { describe, expect, it } from 'vitest';
import { MODES } from './modes/index.ts';
import {
  DEFAULT_NAME,
  MAX_NAME_LENGTH,
  MAX_PROFILE_CHARS,
  MAX_RUNGS,
  PROFILE_VERSION,
  cleanName,
  highestRung,
  mergeProfiles,
  newProfile,
  parseProfile,
  profileFromCloud,
  recordGame,
  recordRung,
  rename,
  toProfileText,
  type Profile,
} from './profile.ts';
import { mulberry32 } from './pieces.ts';
import { MAX_COUNT } from './snapshot.ts';

/** The profile parsed from `text`. */
function parse(...args: Parameters<typeof parseProfile>): Profile {
  return parseProfile(...args).profile;
}

/** A profile with something in every field. */
function filled(): Profile {
  let p = rename(newProfile(), 'Ada');
  p = recordGame(p, 'classic', 1200, 14);
  p = recordGame(p, 'override', 300, 3);
  for (const [i, s] of [3, 2, 1].entries()) p = recordRung(p, i + 1, s as 1 | 2 | 3);
  return p;
}

/** Stored text for `p` with `patch` applied on top of its JSON object. */
function stored(p: Profile, patch: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(toProfileText(p)), ...patch });
}

describe('new profile', () => {
  it('has the default name, empty records and every mode', () => {
    const p = newProfile();
    expect(p).toEqual({
      name: DEFAULT_NAME,
      best: Object.fromEntries(Object.keys(MODES).map((id) => [id, { score: 0, lines: 0 }])),
      stars: '',
      gamesPlayed: 0,
      totalLines: 0,
    });
    expect(highestRung(p)).toBe(1);
  });
});

describe('cleanName', () => {
  it('trims, collapses whitespace and keeps ordinary names', () => {
    expect(cleanName('  Ada   Lovelace \n')).toBe('Ada Lovelace');
    expect(cleanName('Zoë 李')).toBe('Zoë 李');
    expect(cleanName('a\tb\nc')).toBe('a b c');
  });

  it('falls back to the default name when nothing is left', () => {
    for (const raw of ['', '   ', '​‍', '‮⁦', '\u0000\u001f']) {
      expect(cleanName(raw)).toBe(DEFAULT_NAME);
    }
  });

  it('keeps HTML and script text as plain characters (rendered as text, never markup)', () => {
    expect(cleanName('<b>x</b>')).toBe('<b>x</b>');
    expect(cleanName('<img src=x onerror=alert(1)>')).toBe('<img src=x onerr');
  });

  it('strips bidi overrides and isolates', () => {
    expect(cleanName('abc‮evil‬')).toBe('abcevil');
    expect(cleanName('⁦a⁧b⁨c⁩‎‏؜')).toBe('abc');
  });

  it('strips zero-width and other format characters', () => {
    expect(cleanName('a​b‌c‍d⁠e﻿')).toBe('abcde');
    expect(cleanName('a­b')).toBe('ab');
  });

  it('strips control, private-use, unassigned and lone surrogate characters', () => {
    expect(cleanName('a\u0007b\u007fc\u0085d')).toBe('abcd');
    expect(cleanName('ab͸c\ud800d')).toBe('abcd');
  });

  it('strips characters that draw nothing: fillers, braille blank, grapheme joiner', () => {
    for (const raw of [
      '\u3164\u3164',
      '\u115f',
      '\u1160',
      '\uffa0',
      '\u2800\u2800',
      '\u034f',
      '\ufffc',
    ]) {
      expect(cleanName(raw)).toBe(DEFAULT_NAME);
    }
    expect(cleanName('a\u034f\u034fb')).toBe('ab');
    expect(cleanName('\u2800Ada\u3164')).toBe('Ada');
  });

  it('drops leading combining marks and caps them at two per character', () => {
    expect(cleanName('\u0301\u0301')).toBe(DEFAULT_NAME);
    expect(cleanName('\u0301Ada')).toBe('Ada');
    expect(cleanName('a ' + '\u0301'.repeat(3) + 'b')).toBe('a b');
    expect(cleanName('a \u0301 b')).toBe('a b');
    expect(cleanName('\u0301 Ada')).toBe('Ada');
    // NFKC composes the first mark into the letter; two more may follow.
    expect(cleanName('a' + '\u0301'.repeat(40))).toBe('\u00e1\u0301\u0301');
    expect(cleanName('Vi\u1EC7t')).toBe('Vi\u1EC7t');
    expect(cleanName('e\u0302\u0323')).toBe('\u1EC7');
  });

  it('needs a letter, digit or symbol such as an emoji, else the default name', () => {
    for (const raw of ['...', '!!', '<>', '-_-']) expect(cleanName(raw)).toBe(DEFAULT_NAME);
    expect(cleanName('\u{1F600}')).toBe('\u{1F600}');
    expect(cleanName('7')).toBe('7');
    expect(cleanName('<Ada>')).toBe('<Ada>');
  });

  it('strips Unicode tag characters', () => {
    expect(cleanName('\u{E0041}x\u{E007F}')).toBe('x');
  });

  it('never leaves half a surrogate pair at the raw-input cut', () => {
    const name = cleanName('a'.repeat(255) + '\u{1F600}');
    expect(name).toBe('a'.repeat(MAX_NAME_LENGTH));
    expect(cleanName(' '.repeat(255) + '\u{1F600}b')).toBe(DEFAULT_NAME);
  });

  it('folds compatibility look-alikes', () => {
    expect(cleanName('Ａｄａ')).toBe('Ada');
    expect(cleanName('ﬁ')).toBe('fi');
  });

  it('cuts to MAX_NAME_LENGTH code points without splitting a surrogate pair', () => {
    expect(Array.from(cleanName('x'.repeat(100)))).toHaveLength(MAX_NAME_LENGTH);
    const emoji = cleanName('😀'.repeat(40));
    expect(Array.from(emoji)).toEqual(Array(MAX_NAME_LENGTH).fill('😀'));
    expect(cleanName('a'.repeat(MAX_NAME_LENGTH - 1) + ' b')).toBe('a'.repeat(MAX_NAME_LENGTH - 1));
  });

  it('handles an oversize paste quickly', () => {
    const t = performance.now();
    expect(cleanName(' ​'.repeat(500_000) + 'x')).toBe(DEFAULT_NAME);
    expect(cleanName('\u0301'.repeat(1_000_000))).toBe(DEFAULT_NAME);
    expect(cleanName('a' + '\u0301'.repeat(1_000_000))).toBe('\u00e1\u0301\u0301');
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe('records', () => {
  it('keeps the best score and lines per mode and adds up totals', () => {
    let p = recordGame(newProfile(), 'classic', 500, 8);
    p = recordGame(p, 'classic', 300, 12);
    p = recordGame(p, 'override', 50, 1);
    expect(p.best.classic).toEqual({ score: 500, lines: 12 });
    expect(p.best.override).toEqual({ score: 50, lines: 1 });
    expect(p.gamesPlayed).toBe(3);
    expect(p.totalLines).toBe(21);
  });

  it('counts a ladder rung (mode null) toward totals, not toward any best', () => {
    const p = recordGame(recordGame(newProfile(), 'classic', 500, 8), null, 9000, 12);
    expect(p.best.classic).toEqual({ score: 500, lines: 8 });
    expect(p.best.override).toEqual({ score: 0, lines: 0 });
    expect(p.gamesPlayed).toBe(2);
    expect(p.totalLines).toBe(20);
  });

  it('ignores an unknown mode, including __proto__', () => {
    const p = newProfile();
    for (const mode of ['nope', '__proto__', 'constructor', 'toString']) {
      expect(recordGame(p, mode, 9, 9)).toBe(p);
    }
  });

  it('counts a non-finite or negative score or lines as 0', () => {
    for (const bad of [NaN, Infinity, -5, 1.5]) {
      const p = recordGame(newProfile(), 'classic', bad, bad);
      expect(p.best.classic).toEqual({ score: 0, lines: 0 });
      expect(p.totalLines).toBe(0);
      expect(p.gamesPlayed).toBe(1);
    }
  });

  it('caps totals at MAX_COUNT', () => {
    const p = { ...newProfile(), gamesPlayed: MAX_COUNT, totalLines: MAX_COUNT - 1 };
    const q = recordGame(p, 'classic', 0, 10);
    expect(q.gamesPlayed).toBe(MAX_COUNT);
    expect(q.totalLines).toBe(MAX_COUNT);
  });

  it('unlocks rungs in order and only ever raises stars', () => {
    let p = recordRung(newProfile(), 1, 2);
    expect(p.stars).toBe('2');
    expect(highestRung(p)).toBe(2);
    p = recordRung(p, 2, 1);
    p = recordRung(p, 1, 1);
    expect(p.stars).toBe('21');
    p = recordRung(p, 1, 3);
    expect(p.stars).toBe('31');
    expect(highestRung(p)).toBe(3);
  });

  it('ignores locked or invalid rungs', () => {
    const p = recordRung(newProfile(), 1, 3);
    for (const index of [3, 100, 0, -1, 1.5, NaN, Infinity]) {
      expect(recordRung(p, index, 3)).toBe(p);
    }
  });

  it('ignores invalid stars', () => {
    const p = newProfile();
    for (const stars of [0, 4, 2.5, NaN, -1]) {
      expect(recordRung(p, 1, stars as 1)).toBe(p);
    }
  });

  it('stops at MAX_RUNGS', () => {
    const p = { ...newProfile(), stars: '1'.repeat(MAX_RUNGS) };
    expect(highestRung(p)).toBe(MAX_RUNGS);
    expect(recordRung(p, MAX_RUNGS + 1, 3)).toBe(p);
    expect(recordRung(p, MAX_RUNGS, 3).stars.length).toBe(MAX_RUNGS);
  });
});

describe('stored profile', () => {
  it('round-trips every field', () => {
    const p = filled();
    const text = toProfileText(p);
    expect(JSON.parse(text).v).toBe(PROFILE_VERSION);
    expect(parse(text)).toEqual(p);
  });

  it('gives a new profile for missing, unparseable, non-object or oversize text', () => {
    const oversize = stored(filled(), { pad: 'x'.repeat(MAX_PROFILE_CHARS) });
    for (const text of [null, '', '{oops', 'null', '[]', '"x"', '42', oversize]) {
      expect(parse(text)).toEqual(newProfile());
    }
  });

  it('accepts a profile with stars for every rung up to the cap', () => {
    const p = { ...filled(), stars: '3'.repeat(MAX_RUNGS) };
    expect(toProfileText(p).length).toBeLessThanOrEqual(MAX_PROFILE_CHARS);
    expect(parse(toProfileText(p))).toEqual(p);
  });

  it('resets only the invalid field', () => {
    const p = filled();
    const bad: Record<string, unknown[]> = {
      name: [42, null, {}, ['Ada']],
      stars: [123, null, ['3'], { 0: '3' }],
      gamesPlayed: [-1, 1.5, '7', MAX_COUNT + 1, null, Number.MAX_VALUE],
      totalLines: [-1, 2 ** 53, '7', true],
      best: [null, 'x', [], 5],
    };
    for (const [field, values] of Object.entries(bad)) {
      for (const value of values) {
        const got = parse(stored(p, { [field]: value }));
        expect(got).toEqual({ ...p, [field]: (newProfile() as never)[field] });
      }
    }
  });

  it('resets one mode or one count inside best, keeping the rest', () => {
    const p = filled();
    const got = parse(stored(p, { best: { classic: { score: -5, lines: 14 }, override: 'nope' } }));
    expect(got.best).toEqual({
      classic: { score: 0, lines: 14 },
      override: { score: 0, lines: 0 },
    });
    expect(got.stars).toBe(p.stars);
  });

  it('keeps the valid start of a damaged stars string', () => {
    for (const [stars, kept] of [
      ['3214', '321'],
      ['32x1', '32'],
      ['0', ''],
      ['3‮2', '3'],
      ['３', ''],
    ]) {
      expect(parse(stored(filled(), { stars })).stars).toBe(kept);
    }
  });

  it('re-cleans a stored name: hostile text cannot come back from storage', () => {
    for (const [name, clean] of [
      ['  Ada  ', 'Ada'],
      ['a‮b​c', 'abc'],
      ['x'.repeat(5000), 'x'.repeat(MAX_NAME_LENGTH)],
      ['​', DEFAULT_NAME],
      ['<script>alert(1)</script>', '<script>alert(1)'],
      ['\u3164\u2800', DEFAULT_NAME],
      ['a' + '\u0301'.repeat(30), '\u00e1\u0301\u0301'],
      ['\u{E0041}Eve', 'Eve'],
    ]) {
      expect(parse(stored(filled(), { name })).name).toBe(clean);
    }
  });

  it('ignores unknown keys and never pollutes prototypes', () => {
    const text =
      '{"v":1,"name":"Ada","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},' +
      '"best":{"__proto__":{"polluted":1},"classic":{"score":7,"lines":1,"__proto__":{"x":1}},"extra":{"score":9,"lines":9}},' +
      '"stars":"3","gamesPlayed":2,"totalLines":1,"extra":true}';
    const p = parse(text);
    expect(p).toEqual({
      ...newProfile(),
      name: 'Ada',
      best: { ...newProfile().best, classic: { score: 7, lines: 1 } },
      stars: '3',
      gamesPlayed: 2,
      totalLines: 1,
    });
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(p.best)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(p.best)).toEqual(Object.keys(MODES));
  });

  it('rejects migrated data whose prototype is not Object.prototype', () => {
    // JSON.parse never builds these, but a migration step could.
    const p = parse('{"v":0}', { 0: () => Object.create({ name: 'Eve' }) });
    expect(p).toEqual(newProfile());
  });

  it('upgrades older versions through the migration steps', () => {
    const v0 = JSON.stringify({ v: 0, player: 'Ada', games: 4 });
    const migrations = {
      0: (old: Record<string, unknown>) => ({ v: 1, name: old.player, gamesPlayed: old.games }),
    };
    expect(parse(v0, migrations)).toEqual({ ...newProfile(), name: 'Ada', gamesPlayed: 4 });
  });

  it('salvages the fields it knows when no migration step exists', () => {
    for (const v of [0, -3, 99, 'x', undefined]) {
      expect(parse(stored(filled(), { v }), {})).toEqual(filled());
    }
  });

  it('flags a profile from a later version, so it is not written back', () => {
    expect(parseProfile(stored(filled(), { v: PROFILE_VERSION + 1 }))).toEqual({
      profile: filled(),
      newer: true,
    });
    for (const v of [2 ** 53, 1e300]) {
      expect(parseProfile(stored(filled(), { v })).newer).toBe(true);
    }
    for (const v of [PROFILE_VERSION, 0, 'x', Number.MAX_VALUE * 2]) {
      expect(parseProfile(stored(filled(), { v })).newer).toBe(false);
    }
    expect(parseProfile(null).newer).toBe(false);
  });
});

/** Seeded random profiles, some sharing values so ties are covered. */
function randomProfiles(seed: number, n: number): Profile[] {
  let state = seed;
  const roll = (max: number): number => {
    const [v, next] = mulberry32(state);
    state = next;
    return Math.floor(v * max);
  };
  const out: Profile[] = [];
  for (let i = 0; i < n; i++) {
    const stars = Array.from({ length: roll(12) }, () => String(1 + roll(3))).join('');
    out.push({
      name: ['Player', 'Ada', 'Bo', 'Ada'][roll(4)]!,
      best: {
        classic: { score: roll(5) * 100, lines: roll(5) },
        override: { score: roll(5) * 100, lines: roll(5) },
      },
      stars,
      gamesPlayed: roll(6),
      totalLines: roll(6) * 10,
    });
  }
  return out;
}

describe('merge', () => {
  const profiles = randomProfiles(7, 40);

  it('is commutative', () => {
    for (const a of profiles)
      for (const b of profiles) {
        expect(mergeProfiles(a, b)).toEqual(mergeProfiles(b, a));
      }
  });

  it('never lowers any value of either side', () => {
    for (const a of profiles)
      for (const b of profiles) {
        const m = mergeProfiles(a, b);
        for (const side of [a, b]) {
          expect(m.gamesPlayed).toBeGreaterThanOrEqual(side.gamesPlayed);
          expect(m.totalLines).toBeGreaterThanOrEqual(side.totalLines);
          expect(highestRung(m)).toBeGreaterThanOrEqual(highestRung(side));
          for (const id of Object.keys(MODES)) {
            expect(m.best[id]!.score).toBeGreaterThanOrEqual(side.best[id]!.score);
            expect(m.best[id]!.lines).toBeGreaterThanOrEqual(side.best[id]!.lines);
          }
          for (let i = 0; i < side.stars.length; i++) {
            expect(Number(m.stars[i])).toBeGreaterThanOrEqual(Number(side.stars[i]));
          }
        }
      }
  });

  it('takes the max of each field and rung', () => {
    const a = { ...filled(), stars: '312', gamesPlayed: 5, totalLines: 40 };
    const b = { ...filled(), stars: '1331', gamesPlayed: 9, totalLines: 20 };
    b.best = { ...b.best, classic: { score: 5000, lines: 2 } };
    const m = mergeProfiles(a, b);
    expect(m.stars).toBe('3331');
    expect(m.gamesPlayed).toBe(9);
    expect(m.totalLines).toBe(40);
    expect(m.best.classic).toEqual({ score: 5000, lines: 14 });
  });

  it('is idempotent and keeps a merge with a new profile unchanged', () => {
    const p = filled();
    expect(mergeProfiles(p, p)).toEqual(p);
    expect(mergeProfiles(p, newProfile())).toEqual(p);
  });

  it('prefers a chosen name over the default, else the same name either way', () => {
    expect(mergeProfiles(rename(newProfile(), 'Ada'), newProfile()).name).toBe('Ada');
    expect(mergeProfiles(newProfile(), rename(newProfile(), 'Ada')).name).toBe('Ada');
    expect(mergeProfiles(rename(newProfile(), 'Ada'), rename(newProfile(), 'Bo')).name).toBe('Bo');
  });

  it('merges full-length ladders', () => {
    const a = { ...newProfile(), stars: '1'.repeat(MAX_RUNGS) };
    const b = { ...newProfile(), stars: '3'.repeat(MAX_RUNGS - 1) };
    const m = mergeProfiles(a, b);
    expect(m.stars).toBe('3'.repeat(MAX_RUNGS - 1) + '1');
  });
});

describe('profile from the cloud', () => {
  /** The JSON object this version uploads for `p`, with `patch` on top. */
  const upload = (p: Profile, patch: Record<string, unknown> = {}): unknown => ({
    ...(JSON.parse(toProfileText(p)) as object),
    ...patch,
  });

  it('accepts exactly what this version uploads', () => {
    const p = filled();
    expect(profileFromCloud(upload(p))).toEqual(p);
    expect(profileFromCloud(upload(newProfile()))).toEqual(newProfile());
  });

  it('drops bests of modes it does not know, after checking them', () => {
    const p = filled();
    const best = {
      ...p.best,
      marathon: { score: 1, lines: 1 },
      constructor: { score: 9, lines: 9 },
    };
    const read = profileFromCloud(upload(p, { best }));
    expect(read).toEqual(p);
    expect(Object.keys(read!.best)).toEqual(Object.keys(MODES));
  });

  it('fills in bests missing from the save', () => {
    expect(profileFromCloud(upload(newProfile(), { best: {} }))).toEqual(newProfile());
  });

  it('cleans the name like a typed one', () => {
    expect(profileFromCloud(upload(newProfile(), { name: 'A\u202eda' }))?.name).toBe('Ada');
  });

  const p = filled();
  it.each<[string, unknown]>([
    ['null', null],
    ['an array', [upload(p)]],
    ['a string', toProfileText(p)],
    ['a newer version', upload(p, { v: PROFILE_VERSION + 1 })],
    ['an older version', upload(p, { v: 0 })],
    ['an extra key', upload(p, { admin: true })],
    ['a missing key', JSON.parse(toProfileText(p).replace(/"stars":"\d*",/, ''))],
    ['__proto__ at the top', JSON.parse(`{"__proto__":{"x":1},${toProfileText(p).slice(1)}`)],
    ['__proto__ in best', upload(p, { best: JSON.parse('{"__proto__":{"score":1,"lines":1}}') })],
    ['a best with an extra key', upload(p, { best: { classic: { score: 1, lines: 1, x: 1 } } })],
    ['a best that is a number', upload(p, { best: { classic: 5 } })],
    [
      'too many modes',
      upload(p, {
        best: Object.fromEntries(
          Array.from({ length: 17 }, (_, i) => [`m${i}`, { score: 0, lines: 0 }]),
        ),
      }),
    ],
    ['a string count', upload(p, { gamesPlayed: '5' })],
    ['a fractional count', upload(p, { totalLines: 1.5 })],
    ['a negative count', upload(p, { totalLines: -1 })],
    ['a count over the cap', upload(p, { gamesPlayed: MAX_COUNT + 1 })],
    ['a huge score', upload(p, { best: { classic: { score: 1e300, lines: 0 } } })],
    ['stars that are not 1..3', upload(p, { stars: '12<script>' })],
    ['stars as a number', upload(p, { stars: 123 })],
    ['oversize stars', upload(p, { stars: '1'.repeat(MAX_RUNGS + 1) })],
    ['a name that is not text', upload(p, { name: ['Ada'] })],
    ['an oversize name', upload(p, { name: 'A'.repeat(100_000) })],
  ])('rejects %s', (_, data) => {
    expect(profileFromCloud(data)).toBeNull();
  });

  it('never pollutes prototypes', () => {
    profileFromCloud(JSON.parse(`{"__proto__":{"polluted":1},${toProfileText(p).slice(1)}`));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
