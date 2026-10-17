// Node ESM resolve hook for the pharmacy customer-api suite. Identical `@/`
// alias resolution to tests/unit/ts-path-hooks.mjs, plus one extra rule: the
// '@/api/client' specifier is redirected to stub-api-client.ts so the suite
// can exercise the real src/features/health/pharmacy/api.ts against a fake
// HTTP layer instead of the real axios+Supabase+expo-router client (which does
// not resolve under plain `node --test`).
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../../src');
const STUB_CLIENT = path.join(HERE, 'stub-api-client.ts');
const EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'];

function resolveWithExt(abs) {
  try {
    if (statSync(abs).isFile()) return abs;
  } catch {
    /* probe extensions/index below */
  }
  for (const ext of EXTS) if (existsSync(abs + ext)) return abs + ext;
  for (const ext of EXTS) {
    const idx = path.join(abs, `index${ext}`);
    if (existsSync(idx)) return idx;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/api/client') {
    return { url: pathToFileURL(STUB_CLIENT).href, shortCircuit: true };
  }
  let abs = null;
  if (specifier.startsWith('@/')) {
    abs = path.join(SRC, specifier.slice(2));
  } else if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:')
  ) {
    abs = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (abs) {
    const file = resolveWithExt(abs);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
