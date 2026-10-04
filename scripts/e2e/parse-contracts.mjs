#!/usr/bin/env node
// scripts/e2e/parse-contracts.mjs
// Extracts every path+method under `paths:` in each contracts/*.openapi.yaml
// into docs/e2e/inventory-contract-endpoints.csv.
//
// No YAML library is used on purpose (repo has no shared parser dep): the
// `paths:` block is parsed by indentation — path keys sit at indent depth 1
// and start with "/", HTTP verbs at depth 2. Handles `paths: {}` (empty).
//
// Usage: node scripts/e2e/parse-contracts.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACTS_DIR = join(ROOT, "contracts");
const OUT = join(ROOT, "docs", "e2e", "inventory-contract-endpoints.csv");

const HTTP_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "head", "options", "trace",
]);

function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

function stripComment(line) {
  // naive: paths/methods here never contain '#'; good enough for this repo
  const i = line.indexOf(" #");
  return i === -1 ? line : line.slice(0, i);
}

function csvCell(v) {
  if (v == null) v = "";
  v = String(v);
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

const rows = [];
const perFile = {};

const files = readdirSync(CONTRACTS_DIR)
  .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
  .sort();

for (const file of files) {
  const lines = readFileSync(join(CONTRACTS_DIR, file), "utf8").split("\n");
  let inPaths = false;
  let currentPath = null;
  let currentMethod = null;
  let opId = "";
  let tag = "";
  let count = 0;

  const flush = () => {
    if (currentPath && currentMethod) {
      rows.push([file, currentMethod, currentPath, opId, tag]);
      count++;
    }
    currentMethod = null;
    opId = "";
    tag = "";
  };

  for (const raw of lines) {
    const line = stripComment(raw).replace(/\s+$/, "");
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const text = line.trim();

    if (indent === 0) {
      if (/^paths\s*:/.test(text)) {
        flush();
        inPaths = true;
        currentPath = null;
        // `paths: {}` on one line → empty paths block
        if (/\{\s*\}\s*$/.test(text)) inPaths = false;
        continue;
      }
      // any other top-level key ends the paths block
      if (inPaths) { flush(); inPaths = false; currentPath = null; }
      continue;
    }
    if (!inPaths) continue;

    // path key: first non-method indent level after `paths:`, starts with /
    if (text.startsWith("/") && /:\s*$/.test(text)) {
      flush();
      currentPath = text.slice(0, -1).trim();
      currentPath = currentPath.replace(/^["']|["']$/g, "");
      continue;
    }
    const m = text.match(/^([a-zA-Z]+)\s*:/);
    if (currentPath && m && HTTP_METHODS.has(m[1].toLowerCase())) {
      flush();
      currentMethod = m[1].toUpperCase();
      continue;
    }
    if (currentPath && currentMethod) {
      const op = text.match(/^operationId\s*:\s*(.+)$/);
      if (op) { opId = op[1].trim().replace(/^["']|["']$/g, ""); continue; }
      const tg = text.match(/^tags\s*:\s*(.+)$/);
      if (tg) {
        tag = tg[1].trim();
        // collapse inline yaml list [A, B] → A|B
        tag = tag.replace(/^\[/, "").replace(/\]$/, "").split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).join("|");
        continue;
      }
    }
  }
  flush();
  perFile[file] = count;
}

mkdirSync(dirname(OUT), { recursive: true });
const header = "contract_file,method,path,operationId,tag";
writeFileSync(OUT, header + "\n" + rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n");

console.log(`wrote ${OUT}`);
console.log(`total ops: ${rows.length}`);
for (const [f, c] of Object.entries(perFile)) console.log(`  ${c}\t${f}`);
