import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * The built page's Content-Security-Policy. GitHub Pages sends no headers, so it
 * rides in a meta tag placed first in `<head>`. `default-src 'none'` makes every
 * kind of load not listed here a violation. The game is same-origin script and
 * style only; widen this list only when a feature needs it. With cloud save
 * configured, `cloud` (the Supabase project's origin) is added to connect-src.
 *
 * Not settable from a meta tag (accepted): `frame-ancestors`, `report-uri`, `sandbox`.
 */
export function csp(cloud: string | null): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    cloud ? `connect-src 'self' ${cloud}` : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The CSP of a build without cloud save. */
export const CSP = csp(null);

/**
 * The cloud save project's origin, from VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * (GitHub Actions variables, public by design: see supabase/README.md). Null when
 * neither is set: the build ships without cloud save. Throws when only one is set, the
 * URL is not a bare https origin (http only for a local Supabase), or the key is not a
 * public one, so a `service_role` or secret key can never ship in the page.
 */
export function cloudOrigin(env: Record<string, string | undefined>): string | null {
  const rawUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!rawUrl && !key) return null;
  if (!rawUrl || !key) {
    throw new Error(
      'Cloud save: set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or neither.',
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Cloud save: VITE_SUPABASE_URL is not a URL.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  // Host names only: `;`, `*` or spaces would change the CSP the origin is put into.
  const bare =
    /^[a-z0-9.-]+$/.test(url.hostname) &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash;
  if (!bare || !(url.protocol === 'https:' || (local && url.protocol === 'http:'))) {
    throw new Error('Cloud save: VITE_SUPABASE_URL must be a bare https origin.');
  }
  if (!isPublicKey(key)) {
    throw new Error('Cloud save: VITE_SUPABASE_ANON_KEY must be the anon or publishable key.');
  }
  return url.origin;
}

/** A publishable key, or a legacy JWT key whose role is `anon`. */
function isPublicKey(key: string): boolean {
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload === 'object' && payload !== null && 'role' in payload
      ? payload.role === 'anon'
      : false;
  } catch {
    return false;
  }
}

/** Build only: the dev server's hot reload needs inline script and a websocket. */
const cspMeta = (content: string): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content },
      injectTo: 'head-prepend',
    },
  ],
});

export default defineConfig(({ mode }) => ({
  plugins: [cspMeta(csp(cloudOrigin(loadEnv(mode, '.', 'VITE_SUPABASE_'))))],
  // Relative asset URLs so the same build works at the site root (local preview)
  // and under the repository sub-path on GitHub Pages.
  base: './',
}));
