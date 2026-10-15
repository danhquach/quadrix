import { describe, expect, it } from 'vitest';
import { CSP } from '../vite.config.ts';

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
