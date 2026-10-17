// Usage: node --experimental-strip-types --import ./tests/unit/pharmacy/register-pharmacy-test-hooks.mjs --test "tests/unit/pharmacy/*.spec.ts"
import { register } from 'node:module';

// Must land before any spec file imports src/features/health/pharmacy/api.ts,
// which reads USE_MOCK from this env var at module-evaluation time — setting
// it inside a spec file is too late because ESM hoists imports above it.
process.env.EXPO_PUBLIC_HEALTH_USE_MOCK = 'false';
process.env.EXPO_PUBLIC_APP_ENV = 'development';

register('./pharmacy-test-hooks.mjs', import.meta.url);
