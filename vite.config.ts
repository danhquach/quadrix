import { defineConfig, type Plugin } from 'vite';

/**
 * The built page's Content-Security-Policy. GitHub Pages sends no headers, so it
 * rides in a meta tag placed first in `<head>`. `default-src 'none'` makes every
 * kind of load not listed here a violation. The game is same-origin script and
 * style only; widen this list only when a feature needs it.
 *
 * Not settable from a meta tag (accepted): `frame-ancestors`, `report-uri`, `sandbox`.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Build only: the dev server's hot reload needs inline script and a websocket. */
const cspMeta: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  plugins: [cspMeta],
  // Relative asset URLs so the same build works at the site root (local preview)
  // and under the repository sub-path on GitHub Pages.
  base: './',
});
