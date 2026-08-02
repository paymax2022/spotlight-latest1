// Registers the TS path/extension resolve hook for `node --test`.
// Usage: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "<glob>"
import { register } from 'node:module';

register('./ts-path-hooks.mjs', import.meta.url);
