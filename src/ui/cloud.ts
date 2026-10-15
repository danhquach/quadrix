import {
  MAX_PROFILE_CHARS,
  mergeProfiles,
  parseProfile,
  profileFromCloud,
  toProfileText,
  type Profile,
} from '../core/profile.ts';
import type { SaveStorage } from './save.ts';

/**
 * Cloud save client: anonymous sign-in, profile sync and device linking against the
 * Supabase backend (supabase/README.md), over plain fetch.
 *
 * Secrets: the session tokens live only in CLOUD_KEY and in request headers or bodies;
 * a link code only in a request body and on screen. None ever goes into a URL, a log
 * line, an error message or the page title. Nothing here logs.
 */

export const CLOUD_KEY = 'quadrix.cloud';

/** Where the backend is; null when the build ships without cloud save. */
export interface CloudConfig {
  /** Project origin, e.g. https://<ref>.supabase.co. */
  url: string;
  /** The anon or publishable key (public by design; the build refuses any other). */
  key: string;
}

/** The project from the build's env, or null if not configured. */
export function cloudConfig(env: Record<string, unknown>): CloudConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
  const key =
    typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
  if (!url || !key) return null;
  try {
    const origin = new URL(url).origin;
    return /^https?:\/\//.test(origin) ? { url: origin, key } : null;
  } catch {
    return null;
  }
}

/** signed-out: the session was refused (revoked or deleted); cloud save is off again. */
export type CloudStatus = 'off' | 'syncing' | 'synced' | 'offline' | 'error' | 'signed-out';

/** What the client needs from the page; real browser objects in the app, stubs in tests. */
export interface CloudHost {
  storage: () => SaveStorage | null;
  fetch: typeof fetch;
  /**
   * The profile as stored now, or null when it isn't stored (storage unavailable, or a
   * later version's data): syncing then stops, so a blank profile never replaces the save.
   */
  profile(): Profile | null;
  /** Apply `change` to the stored profile (and show the result). */
  update(change: (p: Profile) => Profile): void;
  now(): number;
  /** Cross-tab lock (navigator.locks), so two tabs never rotate the same refresh token. */
  locks: Pick<LockManager, 'request'> | null;
  /** Called whenever the status changes. */
  onStatus(status: CloudStatus): void;
}

export type EnableResult = 'on' | 'offline' | 'error';
export type RedeemResult = 'linked' | 'invalid' | 'rate_limited' | 'offline' | 'error';
export type CodeResult = { code: string; expiresAt: number } | { error: 'offline' | 'error' };

/** Link code letters: the server's alphabet, without I, O, 0 and 1. */
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
/** How long a link code is valid (the server's 10 minutes, timed from receipt). */
export const CODE_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;
/** Retry after an offline failure. */
export const RETRY_MS = 60_000;
/** Refresh the access token this long before it expires. */
const REFRESH_EARLY_MS = 60_000;
/** Biggest response read: a profile at the server's 128 KiB cap plus its envelope. */
const MAX_RESPONSE = 140_000;
/** Biggest body sent with keepalive (the browser's limit is 64 KiB for all in flight). */
const KEEPALIVE_MAX = 32_000;
/** Push/merge rounds per sync before giving up (another device keeps winning the race). */
const MAX_ROUNDS = 4;
const LOCK = 'quadrix.cloud';

const ACCESS = /^[\w-]{1,4096}\.[\w-]{1,4096}\.[\w-]{1,4096}$/;
const REFRESH = /^[\w.~+/=-]{1,1024}$/;

/**
 * This browser's cloud state, kept under CLOUD_KEY. `on` is false after a link code was
 * tried with cloud save off: the sign-in is kept (so the server's per-user rate limit
 * sticks) but nothing syncs. `base` is the profile text as of the last sync (null before
 * the first), to tell local changes from remote ones.
 */
interface CloudState {
  on: boolean;
  access: string;
  refresh: string;
  /** When the access token expires (ms since epoch, local clock). */
  expires: number;
  /** The save's revision as of the last sync; 0 before the first. */
  revision: number;
  base: string | null;
}

/**
 * A failure: offline (network, timeout, server busy) retries on a timer; error retries on
 * the next trigger; auth is a rejected access token; lost is a refused session.
 */
class CloudError extends Error {
  readonly kind: 'offline' | 'error' | 'auth' | 'lost';
  /** The HTTP status, when the server answered. */
  readonly status: number;
  constructor(kind: 'offline' | 'error' | 'auth' | 'lost', status = 0) {
    super(`cloud ${kind}`);
    this.kind = kind;
    this.status = status;
  }
}

/** The 8 code letters from what the player typed (case, spaces and dashes ignored), or null. */
export function cleanCode(raw: string): string | null {
  if (raw.length > 64) return null;
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  return CODE.test(code) ? code : null;
}

/** A code shown in two halves, ABCD-EFGH. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export class CloudSync {
  private readonly config: CloudConfig;
  private readonly host: CloudHost;
  private chain: Promise<unknown> = Promise.resolve();
  private queued: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private current: CloudStatus;

  constructor(config: CloudConfig, host: CloudHost) {
    this.config = config;
    this.host = host;
    this.current = this.on ? 'synced' : 'off';
  }

  /** Whether cloud save is on in this browser. */
  get on(): boolean {
    return this.read()?.on ?? false;
  }

  get status(): CloudStatus {
    return this.current;
  }

  /** Another tab turned cloud save on or off: show it. */
  reload(): void {
    if (!this.on) this.setStatus('off');
    else if (this.current === 'off') this.setStatus('synced');
  }

  /**
   * Sign in (unless a link attempt already did), then upload the local profile. Only a
   * failed sign-in leaves cloud save off; a failed first upload retries like any sync.
   */
  enable(): Promise<EnableResult> {
    return this.exclusive(async () => {
      let found = this.read();
      if (!found) {
        try {
          found = await this.signIn();
        } catch (e) {
          return failure(e);
        }
      }
      const st = found;
      st.on = true;
      this.write(st);
      await this.run(() => this.syncOnce(st));
      // The session was refused during the first upload: off again (status signed-out).
      return this.on ? 'on' : 'error';
    });
  }

  /**
   * Stop syncing here and sign out. The local profile stays; the save stays for other
   * devices. Turning on again starts a new save: rejoining this one takes a link code.
   */
  disable(): Promise<void> {
    return this.exclusive(async () => {
      const st = this.read();
      this.clear();
      clearTimeout(this.retry);
      this.setStatus('off');
      if (!st) return;
      try {
        // Revokes this browser's refresh tokens (refreshed first if expired, not stored).
        await this.authed(st, (t) => this.call('/auth/v1/logout', 'POST', null, t), false);
      } catch {
        // Offline or refused: the tokens are gone from here and expire unused.
      }
    });
  }

  /**
   * Sync now: merge in what other devices saved, then upload. Never throws; failures
   * show in the status and retry later. Calls while one is waiting join it.
   */
  sync(): Promise<void> {
    if (!this.on) return Promise.resolve();
    this.queued ??= this.exclusive(() => {
      this.queued = null;
      const st = this.read();
      return st?.on ? this.run(() => this.syncOnce(st)) : Promise.resolve();
    });
    return this.queued;
  }

  /** A link code for this save, for another device to enter. */
  createCode(): Promise<CodeResult> {
    return this.exclusive(async () => {
      try {
        const st = this.read();
        if (!st?.on) return { error: 'error' };
        let res = await this.authed(st, (t) => this.rpc('create_link_code', '{}', t));
        if (isPlain(res) && res.status === 'no_save') {
          await this.run(() => this.syncOnce(st));
          res = await this.authed(st, (t) => this.rpc('create_link_code', '{}', t));
        }
        if (!isPlain(res) || res.status !== 'created' || typeof res.code !== 'string')
          throw new CloudError('error');
        const code = cleanCode(res.code);
        if (!code) throw new CloudError('error');
        // The server answered: an earlier offline sync can go again now (queued after this).
        if (this.current === 'offline') void this.sync();
        return { code, expiresAt: this.host.now() + CODE_TTL_MS };
      } catch (e) {
        return { error: failure(e) };
      }
    });
  }

  /**
   * Attach this browser to the save a link code was made for, and merge that save into
   * the local profile. A code that is malformed, wrong or expired changes nothing here.
   * Turns cloud save on when it was off.
   */
  redeem(raw: string): Promise<RedeemResult> {
    const code = cleanCode(raw);
    if (!code) return Promise.resolve('invalid');
    return this.exclusive(async () => {
      let st: CloudState | null = null;
      let sent = false;
      try {
        st = this.read() ?? (await this.signIn());
        this.write(st);
        // A fresh sign-in after a lost session: no longer signed out, just off.
        if (!st.on) this.setStatus('off');
        sent = true;
        const res = await this.authed(st, (t) =>
          this.rpc('redeem_link_code', JSON.stringify({ code }), t),
        );
        if (!isPlain(res)) throw new CloudError('error');
        if (res.status === 'invalid') return 'invalid';
        if (res.status === 'rate_limited') return 'rate_limited';
        const remote = readSave(res, 'linked');
        if (!remote?.profile) throw new CloudError('error');
        // A different save: the last sync's base no longer applies.
        st.base = null;
        st.on = true;
        this.adopt(st, remote.revision, remote.profile);
        const linked = st;
        await this.run(() => this.syncOnce(linked));
        return 'linked';
      } catch (e) {
        // The server may have moved this browser to the code's save already (reply lost
        // or rejected): forget the old save's revision, so the next upload conflicts and
        // merges instead of overwriting a save it never saw.
        if (sent && st && this.read()) {
          st.revision = 0;
          st.base = null;
          this.write(st);
        }
        return failure(e);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Sync

  /**
   * Upload local changes, or fetch the save when there are none; on a newer save
   * (another device synced), merge it into the local profile and go round again.
   */
  private async syncOnce(st: CloudState): Promise<void> {
    let fetched = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const text = toProfileText(this.stored());
      if (st.revision > 0 && text === st.base) {
        if (fetched) return;
        fetched = true;
        const rows = await this.authed(st, (t) =>
          this.call('/rest/v1/saves?select=revision,profile', 'GET', null, t),
        );
        if (!Array.isArray(rows) || rows.length > 1) throw new CloudError('error');
        if (rows.length === 0) {
          // The save is gone: start a new one from the local profile.
          st.revision = 0;
          st.base = null;
          continue;
        }
        const row = readSave(rows[0], null);
        if (!row?.profile) throw new CloudError('error');
        if (row.revision === st.revision) return;
        this.adopt(st, row.revision, row.profile);
        continue;
      }
      const body = `{"new_profile":${text},"base_revision":${st.revision}}`;
      const res = await this.authed(st, (t) => this.rpc('save_profile', body, t));
      if (isPlain(res) && res.status === 'saved') {
        if (!isRevision(res.revision) || res.revision < 1) throw new CloudError('error');
        st.revision = res.revision;
        st.base = text;
        this.write(st);
        return;
      }
      const conflict = readSave(res, 'conflict');
      if (!conflict) throw new CloudError('error');
      fetched = true;
      if (conflict.profile) this.adopt(st, conflict.revision, conflict.profile);
      else {
        st.revision = 0;
        st.base = null;
      }
    }
    // Other devices kept winning the race: try again later.
    throw new CloudError('offline');
  }

  /** The stored profile; an error when it isn't stored (see CloudHost.profile). */
  private stored(): Profile {
    const p = this.host.profile();
    if (!p) throw new CloudError('error');
    return p;
  }

  /**
   * Merge the save `remote` (at `revision`) into the local profile and remember it as the
   * new base. The name follows whichever side renamed since the base: the local one if
   * it changed here, else the remote one (mergeProfiles decides when there is no base).
   */
  private adopt(st: CloudState, revision: number, remote: Profile): void {
    const base = st.base === null ? null : parseProfile(st.base).profile;
    this.stored();
    this.host.update((local) => {
      const merged = mergeProfiles(local, remote);
      if (base) merged.name = local.name !== base.name ? local.name : remote.name;
      return merged;
    });
    st.revision = revision;
    st.base = toProfileText(remote);
    this.write(st);
  }

  /**
   * Run a sync `op`, showing Syncing and then the outcome. Never throws: the status shows
   * it, and an offline failure retries after RETRY_MS. A lost session has set its own.
   */
  private async run(op: () => Promise<void>): Promise<void> {
    clearTimeout(this.retry);
    this.setStatus('syncing');
    try {
      await op();
      this.setStatus('synced');
    } catch (e) {
      if (e instanceof CloudError && e.kind === 'lost') return;
      if (e instanceof CloudError && e.kind === 'offline') {
        this.setStatus('offline');
        this.retry = setTimeout(() => void this.sync(), RETRY_MS);
      } else {
        this.setStatus('error');
      }
    }
  }

  private setStatus(s: CloudStatus): void {
    if (s === this.current) return;
    this.current = s;
    this.host.onStatus(s);
  }

  // -------------------------------------------------------------------------
  // Auth

  private async signIn(): Promise<CloudState> {
    const session = this.readSession(await this.call('/auth/v1/signup', 'POST', '{}', null));
    return { on: false, ...session, revision: 0, base: null };
  }

  /**
   * Call `request` with a fresh access token; on a rejected token, refresh once and retry.
   * `keep`: store refreshed tokens (not while signing out).
   */
  private async authed(
    st: CloudState,
    request: (token: string) => Promise<unknown>,
    keep = true,
  ): Promise<unknown> {
    if (st.expires - this.host.now() < REFRESH_EARLY_MS) await this.renew(st, keep);
    try {
      return await request(st.access);
    } catch (e) {
      if (!(e instanceof CloudError) || e.kind !== 'auth') throw e;
      await this.renew(st, keep);
      return request(st.access);
    }
  }

  /**
   * New tokens for `st`, stored at once: the old refresh token is spent. A refused
   * refresh is a lost session: cloud save turns off here (status signed-out), as no retry
   * can bring it back; the player turns it on again or enters a link code.
   */
  private async renew(st: CloudState, keep: boolean): Promise<void> {
    // Another tab may have rotated the token since `st` was read: `st.refresh` is spent.
    const latest = this.read();
    if (latest && latest.refresh !== st.refresh) {
      Object.assign(st, {
        access: latest.access,
        refresh: latest.refresh,
        expires: latest.expires,
      });
      if (st.expires - this.host.now() >= REFRESH_EARLY_MS) return;
    }
    const body = JSON.stringify({ refresh_token: st.refresh });
    let res: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.call('/auth/v1/token?grant_type=refresh_token', 'POST', body, null);
        break;
      } catch (e) {
        if (!(e instanceof CloudError)) throw e;
        // Retry at once: if the lost try rotated the token, this one may still be inside
        // the server's reuse interval (10 s). Never worse than waiting for RETRY_MS.
        if (e.kind === 'offline' && attempt === 0) continue;
        if (e.kind === 'offline') throw e;
        // Only the auth server refusing the token loses the session; anything else (a
        // misconfigured or degraded project) keeps it, to retry on the next trigger.
        if (e.kind !== 'auth' && e.status !== 400 && e.status !== 403)
          throw new CloudError('error');
        if (keep) {
          this.clear();
          clearTimeout(this.retry);
          this.setStatus('signed-out');
        }
        throw new CloudError('lost');
      }
    }
    Object.assign(st, this.readSession(res));
    if (keep) this.write(st);
  }

  private readSession(v: unknown): Pick<CloudState, 'access' | 'refresh' | 'expires'> {
    if (
      !isPlain(v) ||
      typeof v.access_token !== 'string' ||
      !ACCESS.test(v.access_token) ||
      typeof v.refresh_token !== 'string' ||
      !REFRESH.test(v.refresh_token) ||
      !Number.isSafeInteger(v.expires_in) ||
      (v.expires_in as number) < 1 ||
      (v.expires_in as number) > 604_800
    ) {
      throw new CloudError('error');
    }
    return {
      access: v.access_token,
      refresh: v.refresh_token,
      expires: this.host.now() + (v.expires_in as number) * 1000,
    };
  }

  // -------------------------------------------------------------------------
  // Transport

  private rpc(fn: string, body: string, token: string): Promise<unknown> {
    return this.call(`/rest/v1/rpc/${fn}`, 'POST', body, token);
  }

  /**
   * One request to the project. The response is parsed as untrusted JSON, and refused
   * when its declared or actual length is over MAX_RESPONSE. Network failures, timeouts,
   * 408, 429 and 5xx are `offline`; 401 is `auth`; anything else that is not 2xx with
   * JSON is `error`.
   */
  private async call(
    path: string,
    method: 'GET' | 'POST',
    body: string | null,
    token: string | null,
    { timeout = TIMEOUT_MS } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { apikey: this.config.key };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    let status: number;
    let text: string | null = null;
    try {
      const res = await this.host.fetch(this.config.url + path, {
        method,
        headers,
        body,
        signal: abort.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        // A sync started as the page goes away may finish after it.
        keepalive: body !== null && body.length <= KEEPALIVE_MAX,
      });
      status = res.status;
      if (Number(res.headers.get('content-length')) > MAX_RESPONSE)
        await res.body?.cancel().catch(() => undefined);
      else text = await res.text();
    } catch {
      throw new CloudError('offline');
    } finally {
      clearTimeout(timer);
    }
    if (status === 401) throw new CloudError('auth', status);
    if (status === 408 || status === 429 || status >= 500) throw new CloudError('offline');
    if (status < 200 || status > 299 || text === null || text.length > MAX_RESPONSE)
      throw new CloudError('error', status);
    if (text === '') return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new CloudError('error');
    }
  }

  /** Run `fn` after every earlier operation here and in other tabs. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const locks = this.host.locks;
    const go = (): Promise<T> => (locks ? locks.request(LOCK, fn) : fn());
    const p = this.chain.then(go, go);
    this.chain = p.catch(() => undefined);
    return p;
  }

  // -------------------------------------------------------------------------
  // Storage

  /** The stored state, or null when off, unreadable or invalid (all read as off). */
  private read(): CloudState | null {
    let text: string | null | undefined;
    try {
      text = this.host.storage()?.getItem(CLOUD_KEY);
    } catch {
      return null;
    }
    if (text == null || text.length > MAX_PROFILE_CHARS + 8192) return null;
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      return null;
    }
    if (
      !isPlain(v) ||
      v.v !== 1 ||
      typeof v.on !== 'boolean' ||
      typeof v.access !== 'string' ||
      !ACCESS.test(v.access) ||
      typeof v.refresh !== 'string' ||
      !REFRESH.test(v.refresh) ||
      !Number.isSafeInteger(v.expires) ||
      !isRevision(v.revision) ||
      !(v.base === null || (typeof v.base === 'string' && v.base.length <= MAX_PROFILE_CHARS))
    ) {
      return null;
    }
    return {
      on: v.on,
      access: v.access,
      refresh: v.refresh,
      expires: v.expires as number,
      revision: v.revision,
      base: v.base as string | null,
    };
  }

  private write(st: CloudState): void {
    try {
      this.host.storage()?.setItem(CLOUD_KEY, JSON.stringify({ v: 1, ...st }));
    } catch {
      // Full storage: the session lasts this visit only.
    }
  }

  private clear(): void {
    try {
      this.host.storage()?.removeItem(CLOUD_KEY);
    } catch {
      // Nothing stored to clear.
    }
  }
}

/**
 * A save from the server ({revision, profile}, with `status` when given), or null when
 * malformed. The profile is null only where the server may send none (a conflict with
 * no save); otherwise it must pass profileFromCloud.
 */
function readSave(
  v: unknown,
  status: string | null,
): { revision: number; profile: Profile | null } | null {
  if (!isPlain(v) || (status !== null && v.status !== status) || !isRevision(v.revision))
    return null;
  if (v.profile === null) return v.revision === 0 ? { revision: 0, profile: null } : null;
  const profile = profileFromCloud(v.profile);
  return profile && v.revision >= 1 ? { revision: v.revision, profile } : null;
}

/** How a failed operation is reported: offline (try again later) or error. */
function failure(e: unknown): 'offline' | 'error' {
  // A lost session already turned cloud save off and says so in the status.
  if (!(e instanceof CloudError)) throw e;
  return e.kind === 'offline' ? 'offline' : 'error';
}

function isRevision(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}
