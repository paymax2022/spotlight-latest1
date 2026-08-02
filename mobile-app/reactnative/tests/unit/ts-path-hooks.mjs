// Node ESM resolve hook for `node --test` unit runs.
// Maps the TS `@/` path alias → `src/` and fills in missing file extensions /
// index files, so pure-logic modules (which use extensionless + `@/` imports,
// resolved by Metro/tsc at build time) load under
// `node --experimental-strip-types --test` with no bundler.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(fileURLToPath(import.meta.url), '../../../src');
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
