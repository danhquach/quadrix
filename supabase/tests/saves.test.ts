import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanName,
  MAX_NAME_LENGTH,
  MAX_RUNGS,
  newProfile,
  recordGame,
  recordRung,
  rename,
  toProfileText,
} from '../../src/core/profile.ts';
import { MAX_COUNT } from '../../src/core/snapshot.ts';
import stub from './supabase-stub.sql?raw';

// Every migration, in file-name (timestamp) order.
const migrations = Object.entries(
  import.meta.glob<string>('../migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([, sql]) => sql);

type Json = Record<string, unknown>;

let db: PGlite;
let next = 0;

/** A new anonymous Supabase user's id. */
async function newUser(): Promise<string> {
  next++;
  const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  return id;
}

/** Run `sql` as `user` signed in (role authenticated), or as anon when null. */
async function as<T = Json>(
  user: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx: Transaction) => {
    await tx.exec(`set local role ${user ? 'authenticated' : 'anon'}`);
    if (user) {
      const claims = JSON.stringify({ sub: user, role: 'authenticated', is_anonymous: true });
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    }
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Call one of the API functions as `user`; its JSON result. */
async function rpc(user: string | null, fn: string, ...args: unknown[]): Promise<Json> {
  const params = args.map((_, i) => `$${i + 1}`).join(', ');
  const [row] = await as<{ r: Json }>(user, `select public.${fn}(${params}) as r`, args);
  return row!.r;
}

const save = (user: string, profile: string, base: number) =>
  rpc(user, 'save_profile', profile, base);
const createCode = (user: string) => rpc(user, 'create_link_code');
const redeem = (user: string, code: unknown) => rpc(user, 'redeem_link_code', code);

/** As superuser, bypassing RLS. */
async function admin<T = Json>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

/** A profile with something in every field. */
function filled(): string {
  let p = rename(newProfile(), 'Ada');
  p = recordGame(p, 'classic', 1200, 14);
  p = recordRung(p, 1, 3);
  p = recordRung(p, 2, 1);
  return toProfileText(p);
}

/** `filled()` with `patch` applied to its JSON. */
function patched(patch: (p: Json) => void): string {
  const p = JSON.parse(filled()) as Json;
  patch(p);
  return JSON.stringify(p);
}

/** A user with a save holding `filled()`. */
async function userWithSave(): Promise<string> {
  const u = await newUser();
  expect(await save(u, filled(), 0)).toMatchObject({ status: 'saved', revision: 1 });
  return u;
}

async function codeFor(user: string): Promise<string> {
  const r = await createCode(user);
  expect(r.status).toBe('created');
  return r.code as string;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(stub);
  for (const sql of migrations) await db.exec(sql);
});

beforeEach(async () => {
  // Rate-limit windows and expiry are per test.
  await admin('delete from private.redeem_failures');
});

describe('access', () => {
  it('gives anon nothing: no table, no function', async () => {
    const u = await userWithSave();
    await expect(as(null, 'select * from public.saves')).rejects.toThrow(/permission denied/);
    await expect(rpc(null, 'save_profile', filled(), 0)).rejects.toThrow(/permission denied/);
    await expect(rpc(null, 'create_link_code')).rejects.toThrow(/permission denied/);
    await expect(rpc(null, 'redeem_link_code', 'AAAAAAAA')).rejects.toThrow(/permission denied/);
    await expect(as(null, 'select * from private.save_members')).rejects.toThrow(
      /permission denied/,
    );
    expect(await admin('select 1 from private.save_members where user_id = $1', [u])).toHaveLength(
      1,
    );
  });

  it('lets a player read only their own save', async () => {
    const a = await userWithSave();
    const b = await newUser();
    await save(b, toProfileText(newProfile()), 0);
    const seenByA = await as<{ profile: Json }>(a, 'select profile from public.saves');
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.profile.name).toBe('Ada');
    const seenByB = await as<{ profile: Json }>(b, 'select profile from public.saves');
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]!.profile.name).toBe('Player');
  });

  it('a player with no save sees no rows', async () => {
    await userWithSave();
    const c = await newUser();
    expect(await as(c, 'select * from public.saves')).toEqual([]);
  });

  it('denies direct writes to the table, even to a player’s own row', async () => {
    const a = await userWithSave();
    await expect(as(a, `update public.saves set revision = 99`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(as(a, `delete from public.saves`)).rejects.toThrow(/permission denied/);
    await expect(
      as(a, `insert into public.saves (profile) values ($1::jsonb)`, [filled()]),
    ).rejects.toThrow(/permission denied/);
  });

  it('denies the private tables and helpers to signed-in players', async () => {
    const a = await userWithSave();
    for (const table of ['save_members', 'link_codes', 'redeem_failures']) {
      await expect(as(a, `select * from private.${table}`)).rejects.toThrow(/permission denied/);
    }
    await expect(as(a, `select private.cleanup()`)).rejects.toThrow(/permission denied/);
    await expect(as(a, `select private.valid_profile('{}')`)).rejects.toThrow(/permission denied/);
  });

  it('refuses a deleted user whose token is still valid, without naming it', async () => {
    const a = await newUser();
    await admin('delete from auth.users where id = $1', [a]);
    await expect(save(a, filled(), 0)).rejects.toThrow(/^not signed in$/);
    await expect(createCode(a)).rejects.toThrow(/^not signed in$/);
    await expect(redeem(a, 'ZZZZZZZZ')).rejects.toThrow(/^not signed in$/);
  });

  it('refuses the API without a signed-in user id', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role authenticated');
        await tx.query('select public.create_link_code()');
      }),
    ).rejects.toThrow(/not signed in/);
  });
});

describe('save_profile', () => {
  it('creates the save at revision 1, then raises the revision on each save', async () => {
    const a = await newUser();
    expect(await save(a, filled(), 0)).toMatchObject({ status: 'saved', revision: 1 });
    expect(await save(a, filled(), 1)).toMatchObject({ status: 'saved', revision: 2 });
    expect(await save(a, toProfileText(newProfile()), 2)).toMatchObject({ revision: 3 });
    const [row] = await as<{ revision: number; profile: Json }>(a, 'select * from public.saves');
    expect(row!.revision).toBe(3);
    expect(row!.profile.name).toBe('Player');
  });

  it('answers a stale revision with a conflict carrying the stored save, unchanged', async () => {
    const a = await userWithSave();
    await save(a, filled(), 1);
    const r = await save(a, toProfileText(newProfile()), 1);
    expect(r).toMatchObject({ status: 'conflict', revision: 2 });
    expect((r.profile as Json).name).toBe('Ada');
    const [row] = await as<{ revision: number }>(a, 'select revision from public.saves');
    expect(row!.revision).toBe(2);
  });

  it('answers a first save (revision 0) over an existing save with a conflict', async () => {
    const a = await userWithSave();
    expect(await save(a, toProfileText(newProfile()), 0)).toMatchObject({
      status: 'conflict',
      revision: 1,
    });
  });

  it('answers a later revision with no save behind it with an empty conflict', async () => {
    const a = await newUser();
    expect(await save(a, filled(), 4)).toEqual({
      status: 'conflict',
      revision: 0,
      profile: null,
      updated_at: null,
    });
    expect(await as(a, 'select * from public.saves')).toEqual([]);
  });

  it('accepts what the client writes, from new to a full ladder', async () => {
    const a = await newUser();
    expect((await save(a, toProfileText(newProfile()), 0)).status).toBe('saved');
    const full = patched((p) => {
      p.stars = '3'.repeat(MAX_RUNGS);
      p.name = 'Ω'.repeat(MAX_NAME_LENGTH);
      p.gamesPlayed = MAX_COUNT;
      p.totalLines = MAX_COUNT;
    });
    expect((await save(a, full, 1)).status).toBe('saved');
  });

  it.each(['Ada Lovelace', 'Zoë', 'e\u0301', '名前', '🎮 Player', 'Ω-7', '❤️', '👍🏽', 'a\u180bb'])(
    'accepts the clean name %s',
    async (name) => {
      const a = await newUser();
      const r = await save(a, toProfileText(rename(newProfile(), name)), 0);
      expect(r.status).toBe('saved');
    },
  );

  const invalid: Record<string, string> = {
    'not an object': '[1]',
    'a string': '"profile"',
    'null JSON': 'null',
    'an extra key': patched((p) => (p.extra = 1)),
    'a __proto__ key': filled().replace('{', '{"__proto__":{"admin":true},'),
    'a missing key': patched((p) => delete p.totalLines),
    'version 0': patched((p) => (p.v = 0)),
    'a string version': patched((p) => (p.v = '1')),
    'an empty name': patched((p) => (p.name = '')),
    'a long name': patched((p) => (p.name = 'x'.repeat(MAX_NAME_LENGTH + 1))),
    'a control character in the name': patched((p) => (p.name = 'a\u0007b')),
    'a number name': patched((p) => (p.name = 7)),
    'a 4-star rung': patched((p) => (p.stars = '134')),
    'a 0-star rung': patched((p) => (p.stars = '10')),
    'too many rungs': patched((p) => (p.stars = '1'.repeat(MAX_RUNGS + 1))),
    'a negative count': patched((p) => (p.gamesPlayed = -1)),
    'a fractional count': patched((p) => (p.totalLines = 1.5)),
    'a count over MAX_COUNT': patched((p) => (p.totalLines = MAX_COUNT + 1)),
    'a string count': patched((p) => (p.gamesPlayed = '5')),
    'a huge exponent count': filled().replace(/"gamesPlayed":\d+/, '"gamesPlayed":1e400'),
    'best not an object': patched((p) => (p.best = [])),
    'a __proto__ mode in best': filled().replace(
      '"best":{',
      '"best":{"__proto__":{"score":1,"lines":1},',
    ),
    'an odd mode id': patched((p) => ((p.best as Json)['Classic!'] = { score: 1, lines: 1 })),
    'too many modes': patched((p) => {
      const modes = Array.from({ length: 17 }, (_, i) => ['m' + i, { score: 0, lines: 0 }]);
      p.best = Object.fromEntries(modes);
    }),
    'an extra key in a best': patched(
      (p) => ((p.best as Json).classic = { score: 1, lines: 1, x: 1 }),
    ),
    'a negative best': patched((p) => ((p.best as Json).classic = { score: -1, lines: 1 })),
    'spaces in the stars': patched((p) => (p.stars = '1'.repeat(MAX_RUNGS - 10) + ' '.repeat(10))),
    'a 1 MB name': patched((p) => (p.name = 'x'.repeat(1_000_000))),
    'a bidi override in the name': patched((p) => (p.name = 'ab\u202ecd')),
    'a zero-width space in the name': patched((p) => (p.name = 'a\u200bb')),
    'a C1 control in the name': patched((p) => (p.name = 'a\u0085b')),
    'a no-break space in the name': patched((p) => (p.name = 'a\u00a0b')),
    'a Hangul filler in the name': patched((p) => (p.name = '\u3164')),
    'a leading space in the name': patched((p) => (p.name = ' Ada')),
    'two spaces in the name': patched((p) => (p.name = 'A  da')),
  };

  for (const [what, profile] of Object.entries(invalid)) {
    it(`rejects a profile with ${what}, changing nothing`, async () => {
      const a = await userWithSave();
      await expect(save(a, profile, 1)).rejects.toThrow(/invalid profile/);
      const [row] = await as<{ revision: number }>(a, 'select revision from public.saves');
      expect(row!.revision).toBe(1);
    });
  }

  it('accepts every name the client can write, from hostile input', async () => {
    const raw = [
      '\u202eevil',
      'a\u200bb',
      'x\u0085y',
      '\u3164\u3164',
      '  A  da  ',
      'ｆｕｌｌ',
      'e\u0301\u0302\u0303',
      '👨\u200d👩\u200d👧',
      '\ufe0f❤',
      'a\u17b4b',
      'a\u180e\u180fb',
      '\u2800\u2800!',
      'Ⅻ',
      '\ud800x',
      'x'.repeat(300),
      '\u0000\u0007',
    ];
    for (const name of raw) {
      const a = await newUser();
      const profile = toProfileText(rename(newProfile(), name));
      expect((await save(a, profile, 0)).status, JSON.stringify(name)).toBe('saved');
    }
  });

  it('accepts every character the client keeps in a name', async () => {
    // Each code point that survives cleanName unchanged must pass the server's check.
    const kept: string[] = [];
    for (let cp = 0x20; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const name = 'a' + String.fromCodePoint(cp) + 'b';
      if (cleanName(name) === name) kept.push(name);
    }
    const refused = await admin<{ name: string }>(
      'select n as name from unnest($1::text[]) n where not private.valid_name(n)',
      [kept],
    );
    expect(refused.map((r) => r.name.codePointAt(1)!.toString(16))).toEqual([]);
  });

  it('never echoes the profile in its error', async () => {
    const a = await newUser();
    const secret = patched((p) => (p.name = 'SECRET-NAME-XYZ!'.repeat(2)));
    await expect(save(a, secret, 0)).rejects.toThrow(/^invalid profile$/);
  });

  it('the table itself refuses a bad profile, whoever writes it', async () => {
    await expect(admin(`insert into public.saves (profile) values ('{"v":1}')`)).rejects.toThrow(
      /profile_shape/,
    );
  });
});

describe('link codes', () => {
  it('needs a save to make one', async () => {
    const a = await newUser();
    expect(await createCode(a)).toEqual({ status: 'no_save' });
  });

  it('is 8 characters from the unambiguous alphabet, valid for 10 minutes', async () => {
    const a = await userWithSave();
    const r = await createCode(a);
    expect(r.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const minutes = (Date.parse(r.expires_at as string) - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10.1);
  });

  it('is stored only as a hash', async () => {
    const a = await userWithSave();
    const code = await codeFor(a);
    const rows = await admin<{ row: string }>('select l::text as row from private.link_codes l');
    expect(rows.length).toBeGreaterThan(0);
    for (const { row } of rows) expect(row).not.toContain(code);
  });

  it('attaches another browser to the same save; both then share it', async () => {
    const a = await userWithSave();
    const b = await newUser();
    const r = await redeem(b, await codeFor(a));
    expect(r).toMatchObject({ status: 'linked', revision: 1 });
    expect((r.profile as Json).name).toBe('Ada');

    expect(await save(b, toProfileText(rename(newProfile(), 'Bea')), 1)).toMatchObject({
      status: 'saved',
      revision: 2,
    });
    const [seenByA] = await as<{ profile: Json }>(a, 'select profile from public.saves');
    expect(seenByA!.profile.name).toBe('Bea');
    expect(await save(a, filled(), 1)).toMatchObject({ status: 'conflict', revision: 2 });
  });

  it('ignores case, spaces and dashes', async () => {
    const a = await userWithSave();
    const code = await codeFor(a);
    const typed = ` ${code.slice(0, 4).toLowerCase()} - ${code.slice(4)} `;
    expect((await redeem(await newUser(), typed)).status).toBe('linked');
  });

  it('works once: a second browser is refused', async () => {
    const a = await userWithSave();
    const code = await codeFor(a);
    expect((await redeem(await newUser(), code)).status).toBe('linked');
    const c = await newUser();
    expect(await redeem(c, code)).toEqual({ status: 'invalid' });
    expect(await as(c, 'select * from public.saves')).toEqual([]);
  });

  it('refuses the retry of a code once the browser moved on to another save', async () => {
    const a = await userWithSave();
    const c = await userWithSave();
    const b = await newUser();
    const first = await codeFor(a);
    expect((await redeem(b, first)).status).toBe('linked');
    expect((await redeem(b, await codeFor(c))).status).toBe('linked');
    expect(await redeem(b, first)).toEqual({ status: 'invalid' });
  });

  it('lets the same browser retry a code it already redeemed', async () => {
    const a = await userWithSave();
    const b = await newUser();
    const code = await codeFor(a);
    expect((await redeem(b, code)).status).toBe('linked');
    expect(await redeem(b, code)).toMatchObject({ status: 'linked', revision: 1 });
  });

  it('refuses an expired code, and the retry of one', async () => {
    const a = await userWithSave();
    const b = await newUser();
    const code = await codeFor(a);
    expect((await redeem(b, code)).status).toBe('linked');
    const fresh = await codeFor(a);
    await admin(`update private.link_codes set expires_at = now() - interval '1 second'`);
    expect(await redeem(b, code)).toEqual({ status: 'invalid' });
    expect(await redeem(await newUser(), fresh)).toEqual({ status: 'invalid' });
  });

  it('deletes expired codes on the next create or redeem', async () => {
    const a = await userWithSave();
    await codeFor(a);
    await admin(`update private.link_codes set expires_at = now() - interval '1 second'`);
    await redeem(await newUser(), 'ZZZZZZZZ');
    expect(await admin('select * from private.link_codes')).toEqual([]);
  });

  it('a new code replaces the save’s unused one', async () => {
    const a = await userWithSave();
    const first = await codeFor(a);
    const second = await codeFor(a);
    expect(await redeem(await newUser(), first)).toEqual({ status: 'invalid' });
    expect((await redeem(await newUser(), second)).status).toBe('linked');
  });

  it('refuses malformed and oversized input without echoing it', async () => {
    const b = await newUser();
    for (const code of [null, '', 'ABC', 'IIIIIIII', 'OOOO0000', 'x'.repeat(65), 'A'.repeat(1e6)]) {
      expect(await redeem(b, code)).toEqual({ status: 'invalid' });
      await admin('delete from private.redeem_failures');
    }
  });

  it('stops answering after 5 wrong codes, even for a right one', async () => {
    const a = await userWithSave();
    const b = await newUser();
    const code = await codeFor(a);
    for (let i = 0; i < 5; i++) expect((await redeem(b, 'ZZZZZZZZ')).status).toBe('invalid');
    expect(await redeem(b, code)).toEqual({ status: 'rate_limited' });
    // Other browsers are not affected.
    expect((await redeem(await newUser(), code)).status).toBe('linked');
  });

  it('opens again once the 10-minute window passes', async () => {
    const a = await userWithSave();
    const b = await newUser();
    for (let i = 0; i < 5; i++) await redeem(b, 'ZZZZZZZZ');
    await admin(`update private.redeem_failures set at = now() - interval '11 minutes'`);
    expect((await redeem(b, await codeFor(a))).status).toBe('linked');
    expect(await admin('select * from private.redeem_failures where user_id = $1', [b])).toEqual(
      [],
    );
  });

  it('moves a browser off its own save, which is deleted when nobody else uses it', async () => {
    const a = await userWithSave();
    const b = await userWithSave();
    const [{ id: bSave } = { id: '' }] = await as<{ id: string }>(b, 'select id from public.saves');
    expect((await redeem(b, await codeFor(a))).status).toBe('linked');
    expect(await admin('select 1 from public.saves where id = $1', [bSave])).toEqual([]);
  });

  it('redeeming a code for the browser’s own save changes nothing', async () => {
    const a = await userWithSave();
    expect(await redeem(a, await codeFor(a))).toMatchObject({ status: 'linked', revision: 1 });
    expect(await as(a, 'select * from public.saves')).toHaveLength(1);
  });
});

describe('deleting a user', () => {
  it('deletes their save and its codes when nobody else uses it', async () => {
    const a = await userWithSave();
    const [{ id } = { id: '' }] = await as<{ id: string }>(a, 'select id from public.saves');
    await codeFor(a);
    await redeem(a, 'ZZZZZZZZ');
    await admin('delete from auth.users where id = $1', [a]);
    expect(await admin('select 1 from public.saves where id = $1', [id])).toEqual([]);
    expect(await admin('select 1 from private.link_codes where save_id = $1', [id])).toEqual([]);
    expect(await admin('select 1 from private.save_members where user_id = $1', [a])).toEqual([]);
    expect(await admin('select 1 from private.redeem_failures where user_id = $1', [a])).toEqual(
      [],
    );
  });

  it('keeps a shared save until its last browser is gone', async () => {
    const a = await userWithSave();
    const b = await newUser();
    await redeem(b, await codeFor(a));
    const [{ id } = { id: '' }] = await as<{ id: string }>(a, 'select id from public.saves');
    await admin('delete from auth.users where id = $1', [a]);
    expect(await as(b, 'select id from public.saves')).toEqual([{ id }]);
    await admin('delete from auth.users where id = $1', [b]);
    expect(await admin('select 1 from public.saves where id = $1', [id])).toEqual([]);
  });

  it('leaves no trace of a browser in the codes it redeemed', async () => {
    const a = await userWithSave();
    const b = await newUser();
    await redeem(b, await codeFor(a));
    await admin('delete from auth.users where id = $1', [b]);
    expect(await admin('select 1 from private.link_codes where used_by = $1', [b])).toEqual([]);
    expect(await as(a, 'select revision from public.saves')).toEqual([{ revision: 1 }]);
  });
});

describe('logging', () => {
  it('the migrations never raise notices or log', () => {
    for (const sql of migrations) {
      expect(sql).not.toMatch(/raise\s+(notice|log|info|debug|warning)/i);
      expect(sql).not.toMatch(/raise\s+exception\s+'[^']*%/i);
    }
  });
});
