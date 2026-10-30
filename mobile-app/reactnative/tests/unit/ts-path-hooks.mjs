// Node ESM resolve hook for `node --test` unit runs.
// Maps the TS `@/` path alias → `src/`, fills in missing file extensions /
// index files, and swaps the native modules node cannot parse (react-native's
// Flow types, and lucide-react-native, which require()s it through the CJS
// loader) for the stubs in tests/unit/stubs — so pure-logic modules (which use
// extensionless + `@/` imports, resolved by Metro/tsc at build time) load under
// `node --experimental-strip-types --test` with no bundler.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(fileURLToPath(import.meta.url), '../../../src');
const RN_STUB = path.resolve(fileURLToPath(import.meta.url), '../stubs/react-native.mjs');
const LUCIDE_STUB = path.resolve(fileURLToPath(import.meta.url), '../stubs/lucide-react-native.mjs');
const STUBS = { 'react-native': RN_STUB, 'lucide-react-native': LUCIDE_STUB };
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
  const stub = STUBS[specifier];
  if (stub) {
    return { url: pathToFileURL(stub).href, shortCircuit: true };
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
