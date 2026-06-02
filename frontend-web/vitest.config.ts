import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = path.resolve(__dirname);
const src = path.resolve(__dirname, 'src');

export default defineConfig({
  resolve: {
    alias: [
      // @/src/… → src/… (e.g. @/src/features/voting/types)
      { find: '@/src', replacement: src },
      // @/… → src/… (e.g. @/lib/supabase/server → src/lib/supabase/server)
      { find: '@', replacement: src },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
