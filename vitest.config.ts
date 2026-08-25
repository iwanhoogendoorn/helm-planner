import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    alias: { obsidian: new URL('./tests/stubs/obsidian.ts', import.meta.url).pathname },
  },
});
