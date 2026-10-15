import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROFILE_VERSION,
  highestRung,
  newProfile,
  recordGame,
  recordRung,
  rename,
  toProfileText,
  type Profile,
} from '../core/profile.ts';
import {
  CLOUD_KEY,
  CODE_TTL_MS,
  CloudSync,
  RETRY_MS,
  cleanCode,
  cloudConfig,
  formatCode,
  type CloudStatus,
} from './cloud.ts';
import { loadProfile, updateProfile, writeProfile } from './profile.ts';
import type { SaveStorage } from './save.ts';

const ORIGIN = 'https://abcdefghijklmnop.supabase.co';
const KEY = 'sb_publishable_test-key';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A shared clock for the fake server and every device (ms). */
const clock = { t: 1_800_000_000_000 };

type Reply =
  | { status: number; body: unknown }
  | { status: number; text: string; headers?: Record<string, string> };

/**
 * An in-memory stand-in for the Supabase project: anonymous sign-in with rotating
 * refresh tokens, the saves table behind RLS, and the three functions with the
 * semantics in supabase/README.md.
 */
class FakeServer {
  private n = 0;
  private access = new Map<string, { uid: string; expires: number }>();
  /** Refresh token → user, and when it was spent (reusable for 10 s, like GoTrue). */
  private refresh = new Map<string, { uid: string; spent: number | null }>();
  members = new Map<string, string>();
  saves = new Map<string, { profile: unknown; revision: number }>();
  private codes = new Map<string, { save: string; expires: number; usedBy: string | null }>();
  private failures = new Map<string, number[]>();
  offline = false;
  /** Every request, as sent. */
  log: { url: string; init: RequestInit }[] = [];
  /** Replace the reply to a path (after the request is logged and authorised). */
  hook: ((path: string) => Reply | undefined) | null = null;
  /** Apply a request but lose its reply (the connection drops on the way back). */
  drop: ((path: string) => boolean) | null = null;

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    this.log.push({ url, init });
    if (this.offline) throw new TypeError('Failed to fetch');
    expect(url.startsWith(ORIGIN + '/')).toBe(true);
    const path = url.slice(ORIGIN.length);
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe(KEY);
    const reply = this.route(path, headers, init.body == null ? null : String(init.body));
    if (this.drop?.(path)) throw new TypeError('Failed to fetch');
    const hooked = this.hook?.(path) ?? reply;
    const text = 'text' in hooked ? hooked.text : JSON.stringify(hooked.body);
    const replyHeaders = 'headers' in hooked ? hooked.headers : undefined;
    return new Response(hooked.status === 204 ? null : text, {
      status: hooked.status,
      headers: replyHeaders,
    });
  };

  private session(uid: string) {
    const access = `eyJhbGciOiJIUzI1NiJ9.${uid}x${++this.n}.sig${this.n}`;
    const refresh = `r${uid}${++this.n}`;
    this.access.set(access, { uid, expires: clock.t + 3600_000 });
    this.refresh.set(refresh, { uid, spent: null });
    return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'bearer' };
  }

  private route(path: string, headers: Record<string, string>, body: string | null): Reply {
    const args = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    if (path === '/auth/v1/signup') return { status: 200, body: this.session(`u${++this.n}`) };
    if (path === '/auth/v1/token?grant_type=refresh_token') {
      const r = this.refresh.get(args.refresh_token as string);
      if (!r || (r.spent !== null && clock.t - r.spent > 10_000))
        return { status: 400, body: { error: 'invalid_grant' } };
      r.spent ??= clock.t;
      return { status: 200, body: this.session(r.uid) };
    }
    const bearer = headers.Authorization?.replace(/^Bearer /, '') ?? '';
    const tok = this.access.get(bearer);
    if (!tok || tok.expires <= clock.t) return { status: 401, body: { message: 'JWT expired' } };
    const uid = tok.uid;
    if (path === '/auth/v1/logout') {
      for (const [k, v] of this.refresh) if (v.uid === uid) this.refresh.delete(k);
      this.access.delete(bearer);
      return { status: 204, body: null };
    }
    const sid = this.members.get(uid);
    if (path === '/rest/v1/saves?select=revision,profile') {
      const s = sid ? this.saves.get(sid) : undefined;
      return { status: 200, body: s ? [{ revision: s.revision, profile: s.profile }] : [] };
    }
    if (path === '/rest/v1/rpc/save_profile') {
      const base = args.base_revision as number;
      if (!sid) {
        if (base !== 0) return { status: 200, body: conflict(0, null) };
        const id = `s${++this.n}`;
        this.saves.set(id, { profile: args.new_profile, revision: 1 });
        this.members.set(uid, id);
        return { status: 200, body: { status: 'saved', revision: 1, updated_at: 'now' } };
      }
      const s = this.saves.get(sid)!;
      if (s.revision !== base) return { status: 200, body: conflict(s.revision, s.profile) };
      s.profile = args.new_profile;
      s.revision++;
      return { status: 200, body: { status: 'saved', revision: s.revision, updated_at: 'now' } };
    }
    if (path === '/rest/v1/rpc/create_link_code') {
      if (!sid) return { status: 200, body: { status: 'no_save' } };
      let code = '';
      for (let i = 0; i < 8; i++) code += ALPHABET[(this.n++ * 7 + i * 13) % 32];
      this.codes.set(code, { save: sid, expires: clock.t + 600_000, usedBy: null });
      return { status: 200, body: { status: 'created', code, expires_at: 'later' } };
    }
    if (path === '/rest/v1/rpc/redeem_link_code') {
      const recent = (this.failures.get(uid) ?? []).filter((t) => t > clock.t - 600_000);
      if (recent.length >= 5) return { status: 200, body: { status: 'rate_limited' } };
      const c = this.codes.get(String(args.code));
      if (!c || c.usedBy || c.expires <= clock.t) {
        this.failures.set(uid, [...recent, clock.t]);
        return { status: 200, body: { status: 'invalid' } };
      }
      c.usedBy = uid;
      this.members.set(uid, c.save);
      const s = this.saves.get(c.save)!;
      return {
        status: 200,
        body: { status: 'linked', revision: s.revision, profile: s.profile, updated_at: 'now' },
      };
    }
    return { status: 404, body: { message: 'not found' } };
  }

  /** The stored profile of `uid`'s save. */
  saveOf(d: Device): unknown {
    const uid = [...this.members.keys()].find((u) => this.saveIdOf(d) === this.members.get(u));
    return uid ? this.saves.get(this.members.get(uid)!)?.profile : undefined;
  }

  private saveIdOf(d: Device): string | undefined {
    const st = JSON.parse(d.store.data.get(CLOUD_KEY) ?? 'null') as { access?: string } | null;
    const uid = st?.access ? this.access.get(st.access)?.uid : undefined;
    return uid ? this.members.get(uid) : undefined;
  }
}

const conflict = (revision: number, profile: unknown) => ({
  status: 'conflict',
  revision,
  profile,
  updated_at: null,
});

function memory(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

interface Device {
  store: ReturnType<typeof memory>;
  cloud: CloudSync;
  statuses: CloudStatus[];
  profile(): Profile;
  play(change: (p: Profile) => Profile): void;
}

/** A browser with its own storage and profile, talking to `server`. */
function device(server: FakeServer, start: Profile = newProfile()): Device {
  const store = memory();
  const storage = () => store;
  writeProfile(storage, start);
  const statuses: CloudStatus[] = [];
  const profile = () => loadProfile(storage).profile;
  const play = (change: (p: Profile) => Profile) => void updateProfile(storage, profile(), change);
  const cloud = new CloudSync(
    { url: ORIGIN, key: KEY },
    {
      storage,
      fetch: server.fetch,
      // As main.ts: null when the profile can't be written back here.
      profile: () => {
        const fresh = loadProfile(storage);
        return fresh.stored ? fresh.profile : null;
      },
      update: play,
      now: () => clock.t,
      locks: null,
      onStatus: (s) => statuses.push(s),
    },
  );
  return { store, cloud, statuses, profile, play };
}

/** A profile with ladder progress, bests and totals. */
function progressed(name: string, rungs: (1 | 2 | 3)[], score: number): Profile {
  let p = rename(newProfile(), name);
  rungs.forEach((s, i) => (p = recordRung(p, i + 1, s)));
  p = recordGame(p, 'classic', score, score / 100);
  return p;
}

/** Link `pad` to `phone`'s save through a fresh code. */
async function link(phone: Device, pad: Device): Promise<void> {
  const made = await phone.cloud.createCode();
  if (!('code' in made)) throw new Error('no code');
  expect(await pad.cloud.redeem(formatCode(made.code).toLowerCase())).toBe('linked');
}

let server: FakeServer;
beforeEach(() => {
  server = new FakeServer();
  clock.t = 1_800_000_000_000;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('config', () => {
  it('reads the project from the env, or none', () => {
    expect(
      cloudConfig({ VITE_SUPABASE_URL: `${ORIGIN}/`, VITE_SUPABASE_ANON_KEY: ` ${KEY} ` }),
    ).toEqual({ url: ORIGIN, key: KEY });
    expect(cloudConfig({})).toBeNull();
    expect(cloudConfig({ VITE_SUPABASE_URL: ORIGIN })).toBeNull();
    expect(cloudConfig({ VITE_SUPABASE_URL: 'nope', VITE_SUPABASE_ANON_KEY: KEY })).toBeNull();
    expect(cloudConfig({ VITE_SUPABASE_URL: 'data:x', VITE_SUPABASE_ANON_KEY: KEY })).toBeNull();
  });
});

describe('link codes as typed', () => {
  it('ignores case, spaces and dashes', () => {
    expect(cleanCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(cleanCode('AB CD EF GH')).toBe('ABCDEFGH');
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });

  it.each([
    '',
    'ABCDEFG',
    'ABCDEFGHJ',
    'ABCDEFG1',
    'ABCDEFGO',
    'ABCDÉFGH',
    'A'.repeat(65),
    "ABCD'--",
    'ABCD​EFGH',
  ])('refuses %j', (raw) => {
    expect(cleanCode(raw)).toBeNull();
  });
});

describe('turning cloud save on', () => {
  it('signs in anonymously and uploads the local profile', async () => {
    const phone = device(server, progressed('Ada', [3, 2], 1200));
    expect(phone.cloud.on).toBe(false);
    expect(phone.cloud.status).toBe('off');
    expect(await phone.cloud.enable()).toBe('on');
    expect(phone.cloud.on).toBe(true);
    expect(phone.cloud.status).toBe('synced');
    expect(server.saveOf(phone)).toEqual(JSON.parse(toProfileText(phone.profile())));
  });

  it('stays off when the sign-in fails', async () => {
    const phone = device(server);
    server.offline = true;
    expect(await phone.cloud.enable()).toBe('offline');
    expect(phone.cloud.on).toBe(false);
    server.offline = false;
    server.hook = (path) =>
      path === '/auth/v1/signup' ? { status: 200, body: { access_token: 'x y' } } : undefined;
    expect(await phone.cloud.enable()).toBe('error');
    expect(phone.cloud.on).toBe(false);
    expect(phone.store.data.has(CLOUD_KEY)).toBe(false);
  });

  it('syncs after each game without uploading an unchanged profile', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    phone.play((p) => recordGame(p, 'classic', 500, 5));
    await phone.cloud.sync();
    expect((server.saveOf(phone) as Profile).best.classic).toEqual({ score: 500, lines: 5 });
    const before = server.log.length;
    await phone.cloud.sync();
    // Nothing changed here: one read of the save, no upload.
    expect(server.log.slice(before).map((r) => r.url)).toEqual([
      `${ORIGIN}/rest/v1/saves?select=revision,profile`,
    ]);
  });

  it('joins sync requests made while one is waiting', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    phone.play((p) => recordGame(p, 'classic', 500, 5));
    const a = phone.cloud.sync();
    const b = phone.cloud.sync();
    const c = phone.cloud.sync();
    expect(b).toBe(c);
    await Promise.all([a, b, c]);
    expect(phone.cloud.status).toBe('synced');
  });
});

describe('iPhone to iPad', () => {
  it('rung progress, stars and bests match after linking', async () => {
    const phone = device(server, progressed('Ada', [3, 2, 3, 1], 4200));
    const pad = device(server, progressed('Player', [1, 3], 900));
    await phone.cloud.enable();
    await link(phone, pad);
    await phone.cloud.sync();

    const want = phone.profile();
    expect(pad.profile()).toEqual(want);
    expect(want.stars).toBe('3331');
    expect(highestRung(want)).toBe(5);
    expect(want.best.classic).toEqual({ score: 4200, lines: 42 });
    expect(want.name).toBe('Ada');
    expect(server.saveOf(pad)).toEqual(JSON.parse(toProfileText(want)));
    expect(pad.cloud.on).toBe(true);
    expect(pad.cloud.status).toBe('synced');
  });

  it('a code can only be used once', async () => {
    const phone = device(server, progressed('Ada', [3], 100));
    const pad = device(server);
    const other = device(server);
    await phone.cloud.enable();
    const made = await phone.cloud.createCode();
    if (!('code' in made)) throw new Error('no code');
    expect(made.expiresAt).toBe(clock.t + CODE_TTL_MS);
    expect(await pad.cloud.redeem(made.code)).toBe('linked');
    expect(await other.cloud.redeem(made.code)).toBe('invalid');
  });

  it('a first code uploads the save when there is none yet', async () => {
    const phone = device(server, progressed('Ada', [3], 100));
    await phone.cloud.enable();
    server.members.clear();
    server.saves.clear();
    const made = await phone.cloud.createCode();
    expect('code' in made).toBe(true);
    expect(server.saves.size).toBe(1);
  });

  it('a name changed on one device reaches the other', async () => {
    const phone = device(server, progressed('Ada', [3], 100));
    const pad = device(server);
    await phone.cloud.enable();
    await link(phone, pad);
    pad.play((p) => rename(p, 'Bo'));
    await pad.cloud.sync();
    await phone.cloud.sync();
    expect(phone.profile().name).toBe('Bo');
    // Renaming back to an earlier, "smaller" name still wins over the stale one.
    phone.play((p) => rename(p, 'Ada'));
    await phone.cloud.sync();
    await pad.cloud.sync();
    expect(pad.profile().name).toBe('Ada');
  });
});

describe('offline first', () => {
  it('play offline on both devices, then reconnect: nothing is lost', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const phone = device(server, progressed('Ada', [3, 1], 1000));
    const pad = device(server);
    await phone.cloud.enable();
    await link(phone, pad);

    server.offline = true;
    phone.play((p) => recordRung(recordRung(p, 3, 2), 4, 1));
    phone.play((p) => recordGame(p, 'classic', 7000, 70));
    pad.play((p) => recordRung(p, 2, 3));
    pad.play((p) => recordGame(p, 'override', 300, 3));
    await phone.cloud.sync();
    await pad.cloud.sync();
    expect(phone.cloud.status).toBe('offline');
    expect(pad.cloud.status).toBe('offline');
    // Play goes on: the local profiles kept their own progress.
    expect(phone.profile().stars).toBe('3121');
    expect(pad.profile().stars).toBe('33');

    server.offline = false;
    // Each retries on its own after RETRY_MS.
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(phone.cloud.status).toBe('synced');
    expect(pad.cloud.status).toBe('synced');
    await phone.cloud.sync();

    const want = phone.profile();
    expect(pad.profile()).toEqual(want);
    expect(want.stars).toBe('3321');
    expect(want.best.classic!.score).toBe(7000);
    expect(want.best.override!.score).toBe(300);
    expect(server.saveOf(phone)).toEqual(JSON.parse(toProfileText(want)));
  });

  it('a revision conflict merges and retries', async () => {
    const phone = device(server, progressed('Ada', [3], 100));
    const pad = device(server);
    await phone.cloud.enable();
    await link(phone, pad);
    pad.play((p) => recordRung(p, 2, 2));
    await pad.cloud.sync();
    phone.play((p) => recordGame(p, 'classic', 900, 9));
    await phone.cloud.sync();
    const saved = server.saveOf(phone) as Profile;
    expect(saved.stars).toBe('32');
    expect(saved.best.classic!.score).toBe(900);
    expect(phone.profile().stars).toBe('32');
  });

  it('never uploads a profile that is not stored here', async () => {
    const phone = device(server, progressed('Ada', [3, 3], 100));
    await phone.cloud.enable();
    const saved = server.saveOf(phone);
    // Another tab running a later version wrote its format.
    phone.store.setItem(
      'quadrix.profile',
      JSON.stringify({ ...(JSON.parse(toProfileText(phone.profile())) as object), v: 99 }),
    );
    const n = server.log.length;
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('error');
    expect(server.log.slice(n).some((r) => r.url.includes('save_profile'))).toBe(false);
    expect(server.saveOf(phone)).toEqual(saved);
  });

  it('a link whose reply was lost still merges instead of overwriting the save', async () => {
    // Both saves at revision 1, so a stale revision would match the new save.
    const phone = device(server, progressed('Ada', [3, 3, 3], 5000));
    const pad = device(server, progressed('Bo', [1], 50));
    await phone.cloud.enable();
    await pad.cloud.enable();
    const made = await phone.cloud.createCode();
    if (!('code' in made)) throw new Error('no code');
    server.drop = (path) => path === '/rest/v1/rpc/redeem_link_code';
    expect(await pad.cloud.redeem(made.code)).toBe('offline');
    server.drop = null;
    await pad.cloud.sync();
    expect(pad.profile().stars).toBe('333');
    pad.play((p) => recordGame(p, 'override', 70, 7));
    await pad.cloud.sync();
    const saved = server.saveOf(phone) as Profile;
    expect(saved.stars).toBe('333');
    expect(saved.best.classic!.score).toBe(5000);
    expect(saved.best.override!.score).toBe(70);
  });

  it('gives up after a few lost races and retries later', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    phone.play((p) => recordGame(p, 'classic', 1, 1));
    let rev = 10;
    const other = JSON.parse(toProfileText(progressed('Bo', [2], 10))) as unknown;
    server.hook = (path) =>
      path === '/rest/v1/rpc/save_profile'
        ? { status: 200, body: conflict(++rev, other) }
        : undefined;
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('offline');
    expect(rev).toBe(14);
  });

  it('a link code after an offline spell syncs again', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    phone.play((p) => recordGame(p, 'classic', 1, 1));
    server.offline = true;
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('offline');
    server.offline = false;
    await phone.cloud.createCode();
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('synced');
  });

  it('server errors and timeouts count as offline', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    phone.play((p) => recordGame(p, 'classic', 1, 1));
    for (const status of [500, 503, 429, 408]) {
      server.hook = () => ({ status, body: {} });
      await phone.cloud.sync();
      expect(phone.cloud.status).toBe('offline');
    }
  });

  it('turning off keeps local data and signs out', async () => {
    const phone = device(server, progressed('Ada', [3], 100));
    await phone.cloud.enable();
    const before = phone.profile();
    await phone.cloud.disable();
    expect(phone.cloud.on).toBe(false);
    expect(phone.cloud.status).toBe('off');
    expect(phone.store.data.has(CLOUD_KEY)).toBe(false);
    expect(phone.profile()).toEqual(before);
    expect(server.log.at(-1)!.url).toBe(`${ORIGIN}/auth/v1/logout`);
    // Sync does nothing once off.
    const n = server.log.length;
    await phone.cloud.sync();
    expect(server.log.length).toBe(n);
  });
});

describe('sessions', () => {
  it('refreshes an expiring token, and a rejected one once', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    clock.t += 3600_000;
    phone.play((p) => recordGame(p, 'classic', 1, 1));
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('synced');
    expect(server.log.some((r) => r.url.endsWith('grant_type=refresh_token'))).toBe(true);

    // The server refuses a token the client still thinks is fresh.
    const once = { done: false };
    server.hook = (path) => {
      if (once.done || !path.startsWith('/rest/')) return undefined;
      once.done = true;
      return { status: 401, body: {} };
    };
    phone.play((p) => recordGame(p, 'classic', 2, 2));
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('synced');
  });

  it('a refused refresh token signs out, keeping the profile', async () => {
    const phone = device(server, progressed('Ada', [3], 100));
    await phone.cloud.enable();
    const before = phone.profile();
    clock.t += 3600_000;
    server.hook = (path) =>
      path.startsWith('/auth/v1/token') ? { status: 400, body: {} } : undefined;
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('signed-out');
    expect(phone.cloud.on).toBe(false);
    expect(phone.store.data.has(CLOUD_KEY)).toBe(false);
    expect(phone.profile()).toEqual(before);
    // Turning on again works from there.
    server.hook = null;
    expect(await phone.cloud.enable()).toBe('on');
    expect(phone.cloud.status).toBe('synced');
  });

  it.each<[string, Reply]>([
    ['a 404', { status: 404, body: {} }],
    ['a 500 every time', { status: 500, body: {} }],
    ['a reply that is not JSON', { status: 200, text: '<html>' }],
  ])('a refresh failing with %s keeps the session', async (_, reply) => {
    const phone = device(server);
    await phone.cloud.enable();
    clock.t += 3600_000;
    server.hook = (path) => (path.startsWith('/auth/v1/token') ? reply : undefined);
    await phone.cloud.sync();
    expect(['error', 'offline']).toContain(phone.cloud.status);
    expect(phone.cloud.on).toBe(true);
    server.hook = null;
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('synced');
  });

  it('a refresh whose reply was lost is retried at once, inside the reuse window', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    clock.t += 3600_000;
    let first = true;
    server.drop = (path) => {
      if (!path.startsWith('/auth/v1/token') || !first) return false;
      first = false;
      return true;
    };
    phone.play((p) => recordGame(p, 'classic', 1, 1));
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('synced');
    expect(phone.cloud.on).toBe(true);
  });

  it('signing out refreshes an expired token for the logout, without storing it', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    clock.t += 3600_000;
    await phone.cloud.disable();
    const urls = server.log.map((r) => r.url.slice(ORIGIN.length));
    expect(urls.slice(-2)).toEqual(['/auth/v1/token?grant_type=refresh_token', '/auth/v1/logout']);
    expect(phone.store.data.has(CLOUD_KEY)).toBe(false);
  });

  it('serialises tabs through the lock manager', async () => {
    let tail: Promise<unknown> = Promise.resolve();
    let held = 0;
    let most = 0;
    const locks = {
      request: (_name: string, cb: () => Promise<unknown>) => {
        const run = tail.then(async () => {
          most = Math.max(most, ++held);
          try {
            return await cb();
          } finally {
            held--;
          }
        });
        tail = run.catch(() => undefined);
        return run;
      },
    } as unknown as Pick<LockManager, 'request'>;
    const phone = device(server);
    const tab = (): CloudSync =>
      new CloudSync(
        { url: ORIGIN, key: KEY },
        {
          storage: () => phone.store,
          fetch: server.fetch,
          profile: phone.profile,
          update: phone.play,
          now: () => clock.t,
          locks,
          onStatus: () => undefined,
        },
      );
    const [a, b] = [tab(), tab()];
    await a.enable();
    clock.t += 3600_000;
    phone.play((p) => recordGame(p, 'classic', 9, 9));
    await Promise.all([a.sync(), b.sync(), a.createCode(), b.sync()]);
    expect(most).toBe(1);
    expect(a.status).toBe('synced');
    expect(b.status).toBe('synced');
  });

  it('uses a token another tab rotated instead of the spent one', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    const tab2 = new CloudSync(
      { url: ORIGIN, key: KEY },
      {
        storage: () => phone.store,
        fetch: server.fetch,
        profile: phone.profile,
        update: phone.play,
        now: () => clock.t,
        locks: null,
        onStatus: () => undefined,
      },
    );
    clock.t += 3600_000;
    await tab2.sync();
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('synced');
  });

  it('reads stored state through an allow-list', () => {
    const phone = device(server);
    const good = {
      v: 1,
      on: true,
      access: 'a.b.c',
      refresh: 'r1',
      expires: clock.t,
      revision: 1,
      base: null,
    };
    phone.store.setItem(CLOUD_KEY, JSON.stringify(good));
    expect(phone.cloud.on).toBe(true);
    for (const patch of [
      { v: 2 },
      { on: 'true' },
      { access: 'a.b.c?x=<script>' },
      { refresh: 'r 1' },
      { expires: 'soon' },
      { revision: -1 },
      { revision: 1.5 },
      { base: 5 },
      { base: 'x'.repeat(200_000) },
    ]) {
      phone.store.setItem(CLOUD_KEY, JSON.stringify({ ...good, ...patch }));
      expect(phone.cloud.on).toBe(false);
    }
    phone.store.setItem(CLOUD_KEY, `{"__proto__":{"on":true},"v":1}`);
    expect(phone.cloud.on).toBe(false);
    expect(({} as Record<string, unknown>).on).toBeUndefined();
    phone.store.setItem(CLOUD_KEY, 'not json');
    expect(phone.cloud.on).toBe(false);
  });
});

describe('wrong link codes', () => {
  it('a wrong or expired code shows an error and changes nothing locally', async () => {
    const phone = device(server, progressed('Ada', [3], 100));
    const pad = device(server, progressed('Bo', [2, 2], 50));
    await phone.cloud.enable();
    await pad.cloud.enable();
    const made = await phone.cloud.createCode();
    if (!('code' in made)) throw new Error('no code');
    const before = new Map(pad.store.data);

    expect(await pad.cloud.redeem('ZZZZ-ZZZZ')).toBe('invalid');
    clock.t += CODE_TTL_MS + 1;
    // Expired (the session is still valid: refreshed as needed).
    expect(await pad.cloud.redeem(made.code)).toBe('invalid');

    const after = new Map(pad.store.data);
    expect(after.get('quadrix.profile')).toBe(before.get('quadrix.profile'));
    const st = (m: Map<string, string>) => {
      const { revision, base, on } = JSON.parse(m.get(CLOUD_KEY)!) as Record<string, unknown>;
      return { revision, base, on };
    };
    expect(st(after)).toEqual(st(before));
  });

  it('a malformed code never reaches the server', async () => {
    const pad = device(server);
    expect(await pad.cloud.redeem('hello')).toBe('invalid');
    expect(server.log).toEqual([]);
    expect(pad.store.data.has(CLOUD_KEY)).toBe(false);
  });

  it('with cloud save off, a wrong code keeps it off and the profile unchanged', async () => {
    const pad = device(server, progressed('Bo', [2], 50));
    const before = pad.profile();
    expect(await pad.cloud.redeem('ZZZZZZZZ')).toBe('invalid');
    expect(pad.cloud.on).toBe(false);
    expect(pad.profile()).toEqual(before);
  });

  it('too many wrong codes are rate limited', async () => {
    const pad = device(server);
    for (let i = 0; i < 5; i++) expect(await pad.cloud.redeem('ZZZZZZZZ')).toBe('invalid');
    expect(await pad.cloud.redeem('ZZZZZZZZ')).toBe('rate_limited');
  });

  it('offline, linking says so', async () => {
    const pad = device(server);
    server.offline = true;
    expect(await pad.cloud.redeem('ABCDEFGH')).toBe('offline');
  });
});

describe('hostile server responses', () => {
  const good = () =>
    JSON.parse(toProfileText(progressed('Ada', [3], 100))) as Record<string, unknown>;
  const hostileProfiles: [string, unknown][] = [
    ['a string count', { ...good(), gamesPlayed: '9' }],
    ['a negative count', { ...good(), totalLines: -5 }],
    ['oversize stars', { ...good(), stars: '3'.repeat(100_001) }],
    ['bad stars', { ...good(), stars: '<img src=x onerror=alert(1)>' }],
    ['__proto__', JSON.parse(`{"__proto__":{"isAdmin":true},${JSON.stringify(good()).slice(1)}`)],
    ['__proto__ in best', { ...good(), best: JSON.parse('{"__proto__":{"score":1,"lines":1}}') }],
    ['a newer version', { ...good(), v: PROFILE_VERSION + 1 }],
    ['an extra key', { ...good(), extra: 1 }],
    ['an array', [good()]],
    ['a number', 7],
  ];

  async function linkedPair() {
    const phone = device(server, progressed('Ada', [3, 3], 100));
    const pad = device(server, progressed('Bo', [1], 50));
    await phone.cloud.enable();
    await pad.cloud.enable();
    return { phone, pad };
  }

  it.each(hostileProfiles)('rejects a conflict carrying %s', async (_, profile) => {
    const { pad } = await linkedPair();
    pad.play((p) => recordGame(p, 'classic', 1, 1));
    const before = pad.profile();
    server.hook = (path) =>
      path === '/rest/v1/rpc/save_profile'
        ? { status: 200, body: conflict(9, profile) }
        : undefined;
    await pad.cloud.sync();
    expect(pad.cloud.status).toBe('error');
    expect(pad.profile()).toEqual(before);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it.each(hostileProfiles)('rejects a fetched save carrying %s', async (_, profile) => {
    const { pad } = await linkedPair();
    const before = pad.profile();
    server.hook = (path) =>
      path.startsWith('/rest/v1/saves')
        ? { status: 200, body: [{ revision: 9, profile }] }
        : undefined;
    await pad.cloud.sync();
    expect(pad.cloud.status).toBe('error');
    expect(pad.profile()).toEqual(before);
  });

  it.each(hostileProfiles)('rejects a link carrying %s', async (_, profile) => {
    const { phone, pad } = await linkedPair();
    const made = await phone.cloud.createCode();
    if (!('code' in made)) throw new Error('no code');
    const before = pad.profile();
    server.hook = (path) =>
      path === '/rest/v1/rpc/redeem_link_code'
        ? { status: 200, body: { status: 'linked', revision: 3, profile } }
        : undefined;
    expect(await pad.cloud.redeem(made.code)).toBe('error');
    expect(pad.profile()).toEqual(before);
  });

  it.each<[string, Reply]>([
    ['not JSON', { status: 200, text: '<html>' }],
    [
      'an oversize body',
      {
        status: 200,
        text: JSON.stringify({ status: 'saved', revision: 2, pad: 'x'.repeat(200_000) }),
      },
    ],
    ['a string revision', { status: 200, body: { status: 'saved', revision: '2' } }],
    ['a zero revision', { status: 200, body: { status: 'saved', revision: 0 } }],
    ['an unknown status', { status: 200, body: { status: 'ok' } }],
    ['a conflict with a null profile and a revision', { status: 200, body: conflict(4, null) }],
    ['null', { status: 200, body: null }],
    [
      'declared oversize',
      {
        status: 200,
        text: '{"status":"saved","revision":2}',
        headers: { 'content-length': '200000' },
      },
    ],
    ['a 400', { status: 400, body: { message: 'invalid profile' } }],
    ['a redirect-like 302', { status: 302, body: {} }],
  ])('rejects a save reply that is %s', async (_, reply) => {
    const { pad } = await linkedPair();
    pad.play((p) => recordGame(p, 'classic', 1, 1));
    const before = pad.profile();
    server.hook = (path) => (path === '/rest/v1/rpc/save_profile' ? reply : undefined);
    await pad.cloud.sync();
    expect(pad.cloud.status).toBe('error');
    expect(pad.profile()).toEqual(before);
  });

  it.each<[string, unknown]>([
    [
      'two rows',
      [
        { revision: 1, profile: good() },
        { revision: 2, profile: good() },
      ],
    ],
    ['an object', { revision: 1, profile: good() }],
    ['a row with no profile', [{ revision: 3, profile: null }]],
  ])('rejects fetched rows that are %s', async (_, body) => {
    const { pad } = await linkedPair();
    server.hook = (path) => (path.startsWith('/rest/v1/saves') ? { status: 200, body } : undefined);
    await pad.cloud.sync();
    expect(pad.cloud.status).toBe('error');
  });

  it.each<[string, unknown]>([
    ['a code with bad letters', { status: 'created', code: 'IIIIOOOO' }],
    ['a code that is markup', { status: 'created', code: '<b>x</b>' }],
    ['no code', { status: 'created' }],
  ])('rejects a link code reply with %s', async (_, body) => {
    const { phone } = await linkedPair();
    server.hook = (path) =>
      path === '/rest/v1/rpc/create_link_code' ? { status: 200, body } : undefined;
    expect(await phone.cloud.createCode()).toEqual({ error: 'error' });
  });

  it('rejects hostile tokens from a refresh', async () => {
    const phone = device(server);
    await phone.cloud.enable();
    clock.t += 3600_000;
    server.hook = (path) =>
      path.startsWith('/auth/v1/token')
        ? {
            status: 200,
            body: { access_token: 'a.b.c\r\nX-Evil: 1', refresh_token: 'r', expires_in: 3600 },
          }
        : undefined;
    await phone.cloud.sync();
    expect(phone.cloud.status).toBe('error');
  });
});

describe('secrets', () => {
  it('session tokens and link codes never reach a URL or a log line', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const phone = device(server, progressed('Ada', [3], 100));
    const pad = device(server);
    await phone.cloud.enable();
    const made = await phone.cloud.createCode();
    if (!('code' in made)) throw new Error('no code');
    await pad.cloud.redeem(made.code);
    clock.t += 3600_000;
    await pad.cloud.sync();
    await pad.cloud.redeem('ZZZZZZZZ');
    await phone.cloud.disable();

    const secrets = [made.code, formatCode(made.code)];
    for (const r of server.log) {
      const h = r.init.headers as Record<string, string>;
      if (h.Authorization) secrets.push(h.Authorization.slice('Bearer '.length));
      const body = r.init.body ? (JSON.parse(String(r.init.body)) as Record<string, unknown>) : {};
      if (typeof body.refresh_token === 'string') secrets.push(body.refresh_token);
    }
    for (const d of [phone, pad]) {
      const st = d.store.data.get(CLOUD_KEY);
      if (st) {
        const { access, refresh } = JSON.parse(st) as { access: string; refresh: string };
        secrets.push(access, refresh);
      }
    }
    expect(secrets.length).toBeGreaterThan(4);
    for (const r of server.log) {
      for (const s of secrets) expect(r.url).not.toContain(s);
      expect(r.init.credentials).toBe('omit');
      expect(r.init.referrerPolicy).toBe('no-referrer');
    }
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
});
