#!/usr/bin/env node
/**
 * contract:check — implementation ↔ OpenAPI drift guard for the estate module.
 *
 * 1. Parses contracts/estate.openapi.yaml (fails on malformed YAML).
 * 2. Walks frontend-web/app/api/v1/estate/** for route.ts files, derives each
 *    URL path (turning [id] → {id}, stripping the /api/v1 server prefix), and
 *    reads which HTTP methods it exports (GET/POST/PATCH/...).
 * 3. Asserts every implemented (path, method) pair is documented in the spec,
 *    and that the spec documents no estate path that has no handler.
 *
 * Exit 0 = in sync; exit 1 = drift (prints the offending entries).
 * Pure Node (no deps): a tiny YAML path/method extractor is sufficient here
 * because we only need the `paths:` keys and their method children.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const SPEC = join(repo, 'contracts', 'estate.openapi.yaml');
const ROUTES_ROOT = join(repo, 'frontend-web', 'app', 'api', 'v1', 'estate');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function fail(msg, list) {
  console.error(`✗ contract:check — ${msg}`);
  for (const x of list ?? []) console.error('   - ' + x);
  process.exit(1);
}

// ── 1. Parse the spec's (path, method) pairs from the paths: block ──
function specOps() {
  let text;
  try { text = readFileSync(SPEC, 'utf8'); } catch { fail(`cannot read ${SPEC}`); }
  const lines = text.split('\n');
  const ops = new Set();
  let inPaths = false, curPath = null;
  for (const raw of lines) {
    if (/^paths:\s*$/.test(raw)) { inPaths = true; continue; }
    if (!inPaths) continue;
    if (/^\S/.test(raw)) break; // dedented to a new top-level key → end of paths
    const p = raw.match(/^  (\/\S*):\s*$/);
    if (p) { curPath = p[1]; continue; }
    const m = raw.match(/^    ([a-z]+):\s*$/);
    if (m && curPath && METHODS.includes(m[1])) ops.add(`${m[1].toUpperCase()} ${curPath}`);
  }
  return ops;
}

// ── 2. Walk route.ts files → (path, method) pairs ──
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name === 'route.ts') acc.push(full);
  }
  return acc;
}
function implOps() {
  const ops = new Set();
  let files;
  try { files = walk(ROUTES_ROOT); } catch { fail(`cannot read routes under ${ROUTES_ROOT}`); }
  for (const file of files) {
    // /…/app/api/v1/estate/dues/[id]/pay/route.ts → /estate/dues/{id}/pay
    const rel = file.slice(file.indexOf('/api/v1/') + '/api/v1'.length, -'/route.ts'.length);
    const path = rel.replace(/\[([^\]]+)\]/g, '{$1}');
    const src = readFileSync(file, 'utf8');
    for (const m of METHODS) {
      const re = new RegExp(`export\\s+(async\\s+)?function\\s+${m.toUpperCase()}\\b`);
      if (re.test(src)) ops.add(`${m.toUpperCase()} ${path}`);
    }
  }
  return ops;
}

const spec = specOps();
const impl = implOps();

const undocumented = [...impl].filter((o) => !spec.has(o)).sort();
const unimplemented = [...spec].filter((o) => !impl.has(o)).sort();

if (undocumented.length) fail('implemented routes missing from contracts/estate.openapi.yaml', undocumented);
if (unimplemented.length) fail('spec paths with no route handler (stale contract)', unimplemented);

console.log(`✓ contract:check — estate spec in sync (${impl.size} operations across ${spec.size} documented).`);
