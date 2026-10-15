import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Unit tests cover the pure engine (src/core/**), the lint guards
      // (src/lint.test.ts), the build's Content-Security-Policy
      // (src/csp.test.ts) and the version checks (src/version-checks.test.ts).
      // The DOM layer is kept thin and is not unit-tested here.
      include: [
        'src/core/**/*.test.ts',
        'src/lint.test.ts',
        'src/csp.test.ts',
        'src/version-checks.test.ts',
      ],
      environment: 'node',
    },
  }),
);
