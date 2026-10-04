#!/usr/bin/env node
/**
 * contract:check — OpenAPI contract guard.
 *
 * 1. Validates EVERY contracts/*.openapi.yaml parses and carries
 *    openapi+paths (AUD-DOC-003: 18 contract files existed but only estate
 *    was ever validated — a malformed contract was silently deployable).
 * 2. Estate conformance (unchanged): walks app/api/v1/estate/** route.ts
 *    files, derives (path, method) pairs, and asserts both directions of the
 *    implementation ↔ spec mapping hold. Impl-conformance for the other
 *    contracts needs a module↔route-prefix mapping — follow-up work; this
 *    script reports their op counts so the surface is at least visible.
 *
 * Exit 0 = all contracts valid + estate in sync; exit 1 = drift (prints
 * offending entries).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const CONTRACTS_DIR = join(repo, 'contracts');
const SPEC = join(CONTRACTS_DIR, 'estate.openapi.yaml');
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

// ── 0. Validate every contract file parses and is structurally OpenAPI ──
function validateAllContracts() {
  const files = readdirSync(CONTRACTS_DIR).filter((f) => /\.(yaml|yml)$/.test(f));
  const bad = [];
  let totalOps = 0;
  for (const f of files) {
    try {
      const doc = parseYaml(readFileSync(join(CONTRACTS_DIR, f), 'utf8'));
      if (!doc?.openapi || typeof doc.paths !== 'object' || doc.paths === null) {
        throw new Error('missing openapi version or paths block');
      }
      for (const ops of Object.values(doc.paths)) {
        if (ops && typeof ops === 'object') {
          totalOps += Object.keys(ops).filter((m) => METHODS.includes(m)).length;
        }
      }
    } catch (e) {
      bad.push(`${f}: ${e.message}`);
    }
  }
  if (bad.length) fail('invalid contract files in contracts/', bad);
  console.log(`✓ ${files.length} contract files valid (${totalOps} documented operations)`);
}

validateAllContracts();

const spec = specOps();
const impl = implOps();

const undocumented = [...impl].filter((o) => !spec.has(o)).sort();
const unimplemented = [...spec].filter((o) => !impl.has(o)).sort();

if (undocumented.length) fail('implemented routes missing from contracts/estate.openapi.yaml', undocumented);
if (unimplemented.length) fail('spec paths with no route handler (stale contract)', unimplemented);

console.log(`✓ contract:check — estate spec in sync (${impl.size} operations across ${spec.size} documented).`);
