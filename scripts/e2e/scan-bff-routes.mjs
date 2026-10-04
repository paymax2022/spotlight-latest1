#!/usr/bin/env node
// scripts/e2e/scan-bff-routes.mjs
// Enumerates Next.js App-Router API route handlers:
//   frontend-web/app/api/**/route.ts  and  frontend-admin/app/api/**/route.ts
// Each exported HTTP verb function (export function GET / export const POST /
// export async function PUT …) counts as one endpoint.
// Output: docs/e2e/inventory-bff-routes.csv
//   app,route_file,exported_methods,proxied_path_inferred
// proxied_path_inferred is derived from the folder path: app/api/x/[id]/route.ts
//   → /api/x/:id ; [...slug] → /:slug* ; [[...slug]] → optional catch-all.
// Also records the upstream the file appears to proxy to (env var / URL literal)
// in a comment-only trailing column? No — spec fixes 4 columns; the upstream is
// discoverable per-file. We keep the 4 required columns.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "e2e", "inventory-bff-routes.csv");

const APPS = [
  { app: "frontend-web", dir: join(ROOT, "frontend-web", "app", "api"), strip: "app/api" },
  { app: "frontend-admin", dir: join(ROOT, "frontend-admin", "app", "api"), strip: "app/api" },
];

const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith(".") && e.name !== "node_modules") yield* walk(p); }
    else if (e.name === "route.ts" || e.name === "route.tsx" || e.name === "route.js") yield p;
  }
}

function exportedMethods(src) {
  const found = new Set();
  // export [async] function VERB | export const VERB = | export { X as VERB }
  for (const v of VERBS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${v}\\b|export\\s+const\\s+${v}\\b|export\\s*\\{[^}]*\\bas\\s+${v}\\b|export\\s*\\{[^}]*\\b${v}\\b`);
    if (re.test(src)) found.add(v);
  }
  return [...found].sort();
}

function routePath(file, apiDir) {
  // app/api/x/[id]/route.ts → /api/x/:id ; [...slug] → * ; [[...slug]] → (*)
  let p = relative(apiDir, dirname(file)).replace(/\\/g, "/");
  if (p === ".") p = "";
  p = p.replace(/\[\[\.\.\.(\w+)\]\]/g, ":$1(*)")
       .replace(/\[\.\.\.(\w+)\]/g, ":$1*")
       .replace(/\[(\w+)\]/g, ":$1");
  return "/api/" + p;
}

const rows = [];
for (const { app, dir } of APPS) {
  for (const f of walk(dir)) {
    const rel = relative(join(dir, "..", ".."), f).replace(/\\/g, "/");
    const src = readFileSync(f, "utf8");
    const methods = exportedMethods(src);
    if (!methods.length) methods.push("(none exported?)");
    rows.push([app, rel, methods.join("|"), routePath(f, dir)]);
  }
}
rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, "app,route_file,exported_methods,proxied_path_inferred\n" +
  rows.map(r => r.map(v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n");
console.log(`wrote ${OUT}`);
const byApp = {};
for (const r of rows) byApp[r[0]] = (byApp[r[0]] || 0) + 1;
console.log(byApp);
