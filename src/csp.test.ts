import { describe, expect, it } from 'vitest';
import { CSP, cloudOrigin, csp } from '../vite.config.ts';

describe('Content-Security-Policy', () => {
  const directives = new Map(
    CSP.split(';').map((d) => {
      const [name = '', ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );

  it('denies everything not listed', () => {
    expect(directives.get('default-src')).toEqual(["'none'"]);
  });

  it('allows same-origin script and style only', () => {
    expect(directives.get('script-src')).toEqual(["'self'"]);
    expect(directives.get('style-src')).toEqual(["'self'"]);
  });

  it('never allows inline or eval', () => {
    expect(CSP).not.toMatch(/unsafe-|data:.*script|\*/);
  });

  it('locks down objects, base and forms', () => {
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
  });
});

/** A JWT-shaped key whose payload is `payload` (signature not checked). */
const jwt = (payload: object) =>
  ['eyJhbGciOiJIUzI1NiJ9', btoa(JSON.stringify(payload)).replace(/=+$/, ''), 'sig'].join('.');
const ANON = jwt({ iss: 'supabase', role: 'anon' });
const PROJECT = 'https://abcdefghijklmnop.supabase.co';

describe('cloud save settings', () => {
  it('without them, the build has no cloud save and the CSP is unchanged', () => {
    expect(cloudOrigin({})).toBeNull();
    expect(cloudOrigin({ VITE_SUPABASE_URL: ' ', VITE_SUPABASE_ANON_KEY: '' })).toBeNull();
    expect(CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });

  it('with them, only connect-src gains the project origin', () => {
    const origin = cloudOrigin({ VITE_SUPABASE_URL: PROJECT, VITE_SUPABASE_ANON_KEY: ANON });
    expect(origin).toBe(PROJECT);
    expect(csp(origin)).toBe(CSP.replace("connect-src 'self'", `connect-src 'self' ${PROJECT}`));
    expect(
      cloudOrigin({
        VITE_SUPABASE_URL: `${PROJECT}/`,
        VITE_SUPABASE_ANON_KEY: 'sb_publishable_x-1',
      }),
    ).toBe(PROJECT);
    expect(
      cloudOrigin({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: ANON }),
    ).toBe('http://127.0.0.1:54321');
  });

  it('refuses only one of the two', () => {
    expect(() => cloudOrigin({ VITE_SUPABASE_URL: PROJECT })).toThrow(/both/);
    expect(() => cloudOrigin({ VITE_SUPABASE_ANON_KEY: ANON })).toThrow(/both/);
  });

  it.each([
    'abcdefghijklmnop.supabase.co',
    'http://abcdefghijklmnop.supabase.co',
    `${PROJECT}/rest/v1`,
    `${PROJECT}?x=1`,
    `${PROJECT}#x`,
    'https://user:pw@abcdefghijklmnop.supabase.co',
    "https://x.supabase.co; script-src 'unsafe-inline'",
    'https://x.supabase.co;script-src',
    'https://*.supabase.co',
    'javascript:alert(1)',
  ])('refuses the PROJECT %s', (url) => {
    expect(() => cloudOrigin({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: ANON })).toThrow();
  });

  it.each([
    ['a service_role key', jwt({ role: 'service_role' })],
    ['a secret key', 'sb_secret_abc'],
    ['a key with no role', jwt({ iss: 'supabase' })],
    ['a non-JSON payload', 'a.b.c'],
    ['a key with spaces', 'sb_publishable_a b'],
    ['anything else', 'hunter2'],
  ])('refuses %s', (_, key) => {
    expect(() => cloudOrigin({ VITE_SUPABASE_URL: PROJECT, VITE_SUPABASE_ANON_KEY: key })).toThrow(
      /anon or publishable/,
    );
  });

  it('never puts the key in an error', () => {
    const key = jwt({ role: 'service_role', marker: 'LEAK-CHECK' });
    expect(() => cloudOrigin({ VITE_SUPABASE_URL: PROJECT, VITE_SUPABASE_ANON_KEY: key })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(key) }),
    );
  });
});
