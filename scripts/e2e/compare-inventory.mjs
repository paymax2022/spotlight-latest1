#!/usr/bin/env node
// scripts/e2e/compare-inventory.mjs
// Approximate contract-vs-implementation delta across BOTH surfaces:
//   - Go/Gin backend  (docs/e2e/inventory-backend-routes.csv)
//   - Next.js BFF     (docs/e2e/inventory-bff-routes.csv)
//
// Normalisation: OpenAPI `{id}` params and Gin/Next `:id` params → `:P`.
// Per contract file, candidate mount prefixes = the `servers: - url:` entries
// declared in that file PLUS a generic fallback list.
// An op counts as "implemented" if method+path (or path under any method)
// appears in the backend set OR the BFF path set.
//
// Writes docs/e2e/inventory-delta.txt + prints summary.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const E2E = join(ROOT, "docs", "e2e");
const OUT = join(E2E, "inventory-delta.txt");

const loadCsv = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).slice(1).map(l => l.split(","));

const norm = (p) => (p || "/")
  .replace(/\{[^}]+\}/g, ":P")
  .replace(/:([A-Za-z_][\w()]*)/g, ":P")
  .replace(/\/+/g, "/")
  .replace(/\/$/, "") || "/";

const contracts = loadCsv(join(E2E, "inventory-contract-endpoints.csv")).map(c => ({ file: c[0], method: c[1], path: c[2] }));
const backend = loadCsv(join(E2E, "inventory-backend-routes.csv")).map(c => ({ file: c[0], method: c[1], path: c[2] }));
const bff = loadCsv(join(E2E, "inventory-bff-routes.csv")).map(c => ({ app: c[0], file: c[1], methods: c[2], path: c[3] }));

const backendSet = new Set();
const backendPathOnly = new Set();
for (const b of backend) {
  backendSet.add(`${b.method} ${norm(b.path)}`);
  backendPathOnly.add(norm(b.path));
}
const bffSet = new Set();
const bffPathOnly = new Set();
const wildPrefixes = []; // catch-all prefixes from either surface
for (const b of bff) {
  for (const m of b.methods.split("|")) bffSet.add(`${m} ${norm(b.path)}`);
  const np = norm(b.path);
  bffPathOnly.add(np);
  if (np.includes("*")) wildPrefixes.push(np.split("*")[0].replace(/:P$/, ""));
}

// per-contract-file server prefixes from `servers: - url:` (+ nested per-op servers)
const GENERIC_PREFIXES = ["", "/api", "/api/finance", "/api/v1", "/api/v2", "/api/v1/connect"];
function serverPrefixes(file) {
  const src = readFileSync(join(ROOT, "contracts", file), "utf8");
  const urls = [...src.matchAll(/-\s+url:\s*([^\s#]+)/g)].map(m => m[1].replace(/\/$/, ""));
  return [...new Set([...urls, ...GENERIC_PREFIXES])];
}

const byFile = new Map();
for (const c of contracts) {
  if (!byFile.has(c.file)) byFile.set(c.file, []);
  byFile.get(c.file).push(c);
}

const lines = [];
let totalOps = 0, hitBackend = 0, hitBff = 0, hitWild = 0, miss = 0;
const unmatched = [];
const perFile = [];
for (const [file, ops] of [...byFile.entries()].sort()) {
  const prefixes = serverPrefixes(file);
  let b = 0, f = 0, w = 0, u = 0;
  for (const c of ops) {
    let impl = null;
    const nps = prefixes.map(pre => norm(pre === "" ? c.path : (c.path === "/" ? pre : pre + c.path)));
    for (const np of nps) {
      if (backendSet.has(`${c.method} ${np}`) || backendPathOnly.has(np)) { impl = "backend"; break; }
      if (bffSet.has(`${c.method} ${np}`) || bffPathOnly.has(np)) { impl = "bff"; break; }
    }
    if (!impl && nps.some(np => wildPrefixes.some(w => np.startsWith(w)))) impl = "bff-wildcard";
    if (impl === "backend") b++;
    else if (impl === "bff") f++;
    else if (impl === "bff-wildcard") w++;
    else { u++; unmatched.push({ file, method: c.method, path: c.path }); }
  }
  totalOps += ops.length; hitBackend += b; hitBff += f; hitWild += w; miss += u;
  perFile.push(`${file}: ${ops.length} ops — ${b} backend, ${f} bff-exact, ${w} bff-catchall, ${u} unmatched`);
}
lines.push(...perFile);
lines.push("");
lines.push(`CONTRACT OPS TOTAL: ${totalOps}`);
lines.push(`  implemented in Go backend:  ${hitBackend} (${(100 * hitBackend / totalOps).toFixed(1)}%)`);
lines.push(`  implemented in Next.js BFF: ${hitBff} (${(100 * hitBff / totalOps).toFixed(1)}%)`);
lines.push(`  only via BFF catch-all proxy: ${hitWild} (${(100 * hitWild / totalOps).toFixed(1)}%)`);
lines.push(`  unmatched (neither):        ${miss} (${(100 * miss / totalOps).toFixed(1)}%)`);

// reverse: unique backend paths not in contracts
const contractPaths = new Set();
for (const c of contracts) {
  for (const pre of [...GENERIC_PREFIXES, ...serverPrefixes(c.file)]) {
    contractPaths.add(norm(pre === "" ? c.path : (c.path === "/" ? pre : pre + c.path)));
  }
}
let backendMiss = 0;
const missExamples = [];
const seen = new Set();
for (const b of backend) {
  const np = norm(b.path);
  if (seen.has(np)) continue;
  seen.add(np);
  if (!contractPaths.has(np)) { backendMiss++; if (missExamples.length < 80) missExamples.push(`${b.method} ${np} (${b.file})`); }
}
lines.push(`unique Go-backend paths absent from all contracts: ${backendMiss} (of ${seen.size} unique registered paths)`);
lines.push("");
lines.push("NOTE: approximate — path-shape equality after normalising params; a contract op is");
lines.push("'implemented' if its method+path (or path under any method) is registered anywhere.");
lines.push("");
lines.push("Unmatched contract ops:");
for (const x of unmatched) lines.push(`  ${x.method} ${x.path}   [${x.file}]`);
lines.push("");
lines.push(`Backend paths absent from contracts (first 80 of ${backendMiss}):`);
for (const e of missExamples) lines.push(`  ${e}`);

mkdirSync(E2E, { recursive: true });
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(perFile.join("\n"));
console.log(lines[perFile.length + 1]);
console.log(`backend=${hitBackend} bff=${hitBff} bffWildcard=${hitWild} miss=${miss} backendNotInContracts=${backendMiss}`);
console.log(`wrote ${OUT}`);
