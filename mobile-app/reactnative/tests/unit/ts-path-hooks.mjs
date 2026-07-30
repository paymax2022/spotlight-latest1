// Node ESM resolve hook for `node --test` unit runs.
//
// Production sources import with the TS `@/` path alias and extensionless
// relative specifiers (resolved by Metro/tsc at build time). Node's default
// ESM resolver understands neither, so pure-logic unit tests can't load the
// modules under test. This hook maps `@/x` → `src/x` and fills in the missing
// file extension / index file, so we can run the real source with
// `node --experimental-strip-types --test` (no bundler, no extra deps).

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// this file lives at <rn>/tests/unit/ → project src is ../../src
const SRC = path.resolve(fileURLToPath(import.meta.url), '../../../src');
const EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json'];

function resolveWithExt(abs) {
  try {
    if (statSync(abs).isFile()) return abs;
  } catch {
    /* not a direct file — fall through to extension/index probing */
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
