// Integration suite — talks to a REAL Supabase instance.
//
// Kept out of vitest.config.ts on purpose: the unit suite must stay hermetic and
// runnable with no database, while these specs seed and clean up real rows. They
// skip themselves when NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// absent, so running them without a database is a no-op rather than a failure.
//
//   set -a; source frontend-web/.env.local; set +a
//   npm run test:integration
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const src = path.resolve(__dirname, 'src');

export default defineConfig({
  resolve: {
    alias: [
      { find: '@/src', replacement: src },
      { find: '@', replacement: src },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/integration/**/*.spec.ts'],
    // Shared fixtures against one local database — parallel files would race.
    fileParallelism: false,
  },
});
