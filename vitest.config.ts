import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Unit tests cover the pure engine (src/core/**). The DOM layer is kept thin.
      include: ['src/core/**/*.test.ts'],
      environment: 'node',
    },
  }),
);
