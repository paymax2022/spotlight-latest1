#!/usr/bin/env node
// scripts/e2e/coverage-analyze.mjs
// API coverage gap analysis: classifies every backend (Go/Gin) route, BFF
// (Next.js route.ts) handler and contract operation as
//   exercised-by-live-e2e | exercised-by-unit-or-integration-test |
//   internal-or-infra-only | uncovered
//
// Inputs (read-only):
//   docs/e2e/inventory-backend-routes.csv
//   docs/e2e/inventory-bff-routes.csv
//   docs/e2e/inventory-contract-endpoints.csv
//   frontend-web/tests/e2e/**/*.ts        (live e2e call sites)
//   docs/e2e/results/*.md                 (recorded live traffic, secondary)
//   backend/**/*_test.go                  (unit/integration path literals)
//   frontend-web/tests/{unit,integration}/**  (BFF route imports + literals)
//   frontend-web/app/api/**/route.ts      (proxyToGoBackend upstream map)
//
// Outputs:
//   docs/e2e/api-coverage.csv   (path,method,source,coverage_class,evidence)
//   docs/e2e/API-COVERAGE.md    (human report)
//
// No servers started, no source files modified.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const E2E_DIR = join(ROOT, "docs", "e2e");
const HTTP_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

// ───────────────────────── helpers ─────────────────────────

function* walk(dir, pred) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".") && e.name !== "node_modules") yield* walk(p, pred);
    } else if (pred(e.name)) yield p;
  }
}

function readCsv(file) {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const header = lines[0].split(",");
  return lines.slice(1).map((l) => {
    // inventory CSVs contain no quoted commas (verified by generator)
    const cols = l.split(",");
    const o = {};
    header.forEach((h, i) => (o[h] = cols[i] ?? ""));
    return o;
  });
}

function csvEsc(s) {
  s = String(s);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const segSplit = (p) => p.split("?")[0].split("#")[0].split("/").filter(Boolean);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function calledSegIsDynamic(s) {
  return (
    s.includes("${") ||
    UUID_RE.test(s) ||
    /^\d{4,}$/.test(s) ||                       // long numeric ids
    /^[0-9a-f]{16,}$/i.test(s) ||               // hex ids
    /^[0-9a-f]{8,}$/i.test(s) && /[a-f]/i.test(s) && /\d/.test(s) // hex-ish
  );
}
function invSegIsWild(s) {
  return s.startsWith(":") || (s.startsWith("{") && s.endsWith("}")) || s === "*";
}
// bidirectional-tolerant segment compare: a literal only fails against a literal
function segCompatible(called, inv) {
  if (invSegIsWild(inv)) return true;
  if (calledSegIsDynamic(called)) return true;
  return called === inv;
}
function pathsMatch(calledPath, invPath) {
  const a = segSplit(calledPath), b = segSplit(invPath);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!segCompatible(a[i], b[i])) return false;
  return true;
}

// canonical key for dedupe: wild/id-like segs → *
function canonKey(path) {
  return segSplit(path)
    .map((s) => (invSegIsWild(s) || calledSegIsDynamic(s) ? "*" : s.toLowerCase()))
    .join("/");
}

// ───────────────────────── load inventories ─────────────────────────

const backendRows = readCsv(join(E2E_DIR, "inventory-backend-routes.csv"));
const bffRows = readCsv(join(E2E_DIR, "inventory-bff-routes.csv"));
const contractRows = readCsv(join(E2E_DIR, "inventory-contract-endpoints.csv"));

// unique backend (path,method) endpoints
const backendMap = new Map(); // key `${method} ${path}` -> row info
for (const r of backendRows) {
  const key = `${r.method} ${r.path}`;
  if (!backendMap.has(key)) {
    backendMap.set(key, { method: r.method, path: r.path, sourceFile: r.source_file, group: r.route_group, evidence: [], e2eMethods: new Set(), unitHit: false });
  }
}
const backendPaths = [...new Set(backendRows.map((r) => r.path))];

// BFF route files → patterns + methods
const bffRoutes = bffRows.map((r) => {
  const pattern = r.proxied_path_inferred;
  return { app: r.app, file: r.route_file, pattern, methods: r.exported_methods.split("|").filter(Boolean), evidence: [], e2eMethods: new Set(), unitHit: false };
});

// contract ops
const contractOps = contractRows.map((r) => ({ file: r.contract_file, method: r.method, path: r.path, tag: r.tag, evidence: [] }));

// Mount-prefix expansion identical to compare-inventory.mjs: per-file
// `servers: - url:` values plus generic prefixes. Used both for the
// "documented" check and for attributing exercise to contract ops.
const GENERIC_PREFIXES = ["", "/api", "/api/finance", "/api/v1", "/api/v2", "/api/v1/connect"];
const serverPrefixCache = new Map();
function serverPrefixes(file) {
  if (serverPrefixCache.has(file)) return serverPrefixCache.get(file);
  let urls = [];
  try {
    const src = readFileSync(join(ROOT, "contracts", file), "utf8");
    urls = [...src.matchAll(/-\s+url:\s*([^\s#]+)/g)].map((m) => m[1].replace(/\/$/, ""));
  } catch {}
  const out = [...new Set([...urls, ...GENERIC_PREFIXES])];
  serverPrefixCache.set(file, out);
  return out;
}
function contractPathVariants(op) {
  return serverPrefixes(op.file).map((pre) => (pre === "" ? op.path : op.path === "/" ? pre : pre + op.path));
}
const contractCanon = new Set();          // `${method} ${canonKey}` — for risk flag
const contractPathCanon = new Set();      // canonKey only — for the undocumented check
for (const o of contractOps) {
  for (const v of contractPathVariants(o)) {
    contractCanon.add(`${o.method} ${canonKey(v)}`);
    contractPathCanon.add(canonKey(v));
  }
}

// ───────────────────────── BFF route file parsing ─────────────────────────
// parse pattern segments; build proxy upstream templates per route file

function bffSegs(pattern) {
  return pattern.split("/").filter(Boolean).map((s) => {
    if (s.endsWith("(*)")) return { type: "splat-opt", name: s.slice(1, -4) };
    if (s.endsWith("*")) return { type: "splat", name: s.slice(1, -1) };
    if (s.startsWith(":")) return { type: "param", name: s.slice(1) };
    return { type: "lit", name: s };
  });
}
for (const r of bffRoutes) r.segs = bffSegs(r.pattern);

// Inventory drift: route.ts files on disk that postdate the BFF inventory.
// They are still real endpoints — include them as bff rows and flag them.
const bffInventoryFiles = new Set(bffRows.map((r) => `${r.app}/${r.route_file}`));
const bffDrift = [];
for (const { app, apiDir } of [
  { app: "frontend-web", apiDir: join(ROOT, "frontend-web", "app", "api") },
  { app: "frontend-admin", apiDir: join(ROOT, "frontend-admin", "app", "api") },
]) {
  for (const f of [...walk(apiDir, (n) => /^route\.(ts|tsx|js)$/.test(n))]) {
    const rel = `${app}/${relative(join(ROOT, app), f)}`;
    if (bffInventoryFiles.has(rel)) continue;
    const src = readFileSync(f, "utf8");
    const methods = [...HTTP_VERBS].filter((v) =>
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${v}\\b|export\\s+const\\s+${v}\\b|export\\s*\\{[^}]*\\b${v}\\b`).test(src));
    let p = relative(apiDir, dirname(f)).replace(/\\/g, "/");
    if (p === ".") p = "";
    p = "/" + p.replace(/\[\[\.\.\.(\w+)\]\]/g, ":$1(*)")
      .replace(/\[\.\.\.(\w+)\]/g, ":$1*")
      .replace(/\[(\w+)\]/g, ":$1");
    const pattern = "/api" + p;
    const route = { app, file: relative(join(ROOT, app), f), pattern, methods, evidence: [], e2eMethods: new Set(), unitHit: false, segs: bffSegs(pattern), drift: true };
    bffRoutes.push(route);
    bffDrift.push(rel);
  }
}

// match a called path against a bff route; returns capture map or null
function bffMatch(route, path) {
  const ps = segSplit(path);
  const caps = {};
  let i = 0, j = 0;
  while (i < route.segs.length) {
    const s = route.segs[i];
    if (s.type === "lit") {
      if (ps[j] !== s.name) return null;
      i++; j++;
    } else if (s.type === "param") {
      if (j >= ps.length) return null;
      caps[s.name] = ps[j]; i++; j++;
    } else if (s.type === "splat" || s.type === "splat-opt") {
      const rest = ps.slice(j);
      if (s.type === "splat" && rest.length === 0) return null;
      caps[s.name] = rest;
      j = ps.length; i++;
    }
  }
  return j === ps.length ? caps : null;
}
function bffSpecificity(route) {
  return route.segs.reduce((n, s) => n + (s.type === "lit" ? 4 : s.type === "param" ? 2 : 0), 0) - route.segs.length;
}
function findBffRoute(app, path) {
  let best = null, bestScore = -1, bestCaps = null;
  for (const r of bffRoutes) {
    if (r.app !== app) continue;
    const caps = bffMatch(r, path);
    if (caps) {
      const sc = bffSpecificity(r);
      if (sc > bestScore) { best = r; bestScore = sc; bestCaps = caps; }
    }
  }
  return best ? { route: best, caps: bestCaps } : null;
}

// upstream templates per route file: proxyToGoBackend(request, `<tpl>`)
const upstreamCache = new Map();
function upstreamTemplatesFor(app, routeFile) {
  const key = `${app}/${routeFile}`;
  if (upstreamCache.has(key)) return upstreamCache.get(key);
  let tpls = [];
  try {
    const src = readFileSync(join(ROOT, app, routeFile), "utf8");
    const re = /proxyToGoBackend\s*\(\s*request\s*,\s*([`'"])(.*?)\1/gs;
    let m;
    while ((m = re.exec(src))) tpls.push(m[2]);
  } catch {}
  upstreamCache.set(key, tpls);
  return tpls;
}

// substitute captured values into an upstream template → candidate Go path
function buildUpstream(tpl, caps) {
  let out = tpl;
  // `${x.join('/')}` and bare splat names get the remainder
  out = out.replace(/\$\{\s*([\w.]+)\s*\.join\([^)]*\)\s*\}/g, (_, n) => {
    const base = n.split(".").pop();
    const v = caps[base] ?? caps.path ?? caps.sub;
    return Array.isArray(v) ? v.join("/") : (v ?? "*");
  });
  out = out.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const e = expr.trim();
    // ternary / complex → wildcard the last identifier
    const ids = e.match(/[A-Za-z_$][\w$]*/g) || [];
    const last = ids.filter((x) => !["encodeURIComponent", "String", "sub", "join"].includes(x)).pop();
    if (e === "sub" || e === "rest" || e === "splat") {
      const v = caps[e] ?? caps.path ?? caps.sub;
      return Array.isArray(v) ? v.join("/") : (v ?? "*");
    }
    if (caps[e] !== undefined) return Array.isArray(caps[e]) ? caps[e].join("/") : caps[e];
    const prop = e.match(/\.(\w+)$/);
    if (prop && caps[prop[1]] !== undefined) {
      const v = caps[prop[1]];
      return Array.isArray(v) ? v.join("/") : v;
    }
    if (last && caps[last] !== undefined) {
      const v = caps[last];
      return Array.isArray(v) ? v.join("/") : v;
    }
    return "*";
  });
  return out.replace(/\?.*$/, "");
}

// ───────────────────────── e2e call extraction ─────────────────────────

const e2eCalls = []; // {path, method, surface, file, via}

const GO_FNS = new Set(["goFetch", "goAdminFetch", "adminGo", "adminGoAs", "adminApiGet", "apiGetAs", "adminApiSend"]);
const BFF_FNS = new Set(["bffFetch"]);
const REQ_RE = /(?<![\w$.])(request|page\.request|context\.request)\.(get|post|put|patch|delete|fetch|head)\s*\(|(?<![\w$])(goFetch|bffFetch|goAdminFetch|adminGo|adminGoAs|adminApiGet|apiGetAs|adminApiSend)\s*\(/g;

// find balanced parens and split top-level args
function argList(src, openIdx) {
  let depth = 0, i = openIdx, inStr = null, tplDepth = 0;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (inStr === "`" && c === "$" && src[i + 1] === "{") { tplDepth++; i++; continue; }
      if (tplDepth > 0 && c === "}") { tplDepth--; continue; }
      if (c === inStr && tplDepth === 0) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return src.slice(start + 1, i); }
  }
  return src.slice(start + 1);
}
function splitTop(args) {
  const out = [];
  let depth = 0, inStr = null, tplDepth = 0, cur = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (inStr) {
      cur += c;
      if (c === "\\") { cur += args[++i] ?? ""; continue; }
      if (inStr === "`" && c === "$" && args[i + 1] === "{") { tplDepth++; cur += args[++i]; continue; }
      if (tplDepth > 0 && c === "}") tplDepth--;
      else if (c === inStr && tplDepth === 0) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; cur += c; continue; }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function literalOf(arg, consts) {
  arg = arg.trim();
  const m = arg.match(/^(['"`])([\s\S]*)\1$/);
  if (m) return { lit: m[2], quote: m[1] };
  const id = arg.match(/^([A-Za-z_$][\w$]*)$/);
  if (id && consts && consts.strings.has(id[1])) return { lit: consts.strings.get(id[1]), quote: "'" };
  return null;
}

function collectConsts(src) {
  const strings = new Map(), arrays = new Map();
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*)\2/g)) strings.set(m[1], m[3]);
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\];/g)) {
    const items = [...m[2].matchAll(/(['"`])(\/[^'"`]*)\1/g)].map((x) => x[2]);
    const objs = [...m[2].matchAll(/method:\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*url:\s*'([^']+)'/g)].map((x) => ({ method: x[1], url: x[2] }));
    arrays.set(m[1], { items, objs });
  }
  return { strings, arrays };
}

function stripBase(lit) {
  // `${BASE}/rest` or absolute URL → {base, path}
  let m = lit.match(/^\$\{([A-Za-z_$][\w$]*)\}([\s\S]*)$/);
  if (m) return { base: m[1], path: m[2] || "/" };
  m = lit.match(/^https?:\/\/[^/]+(\/[\s\S]*)?$/);
  if (m) return { base: "ABSOLUTE", path: m[1] || "/" };
  return { base: null, path: lit };
}

function pushCall(path, method, surface, file, via) {
  if (!path || !path.startsWith("/") || path === "/") return;
  e2eCalls.push({ path, method: method ?? "?", surface, file: relative(ROOT, file), via });
}

const e2eFiles = [...walk(join(ROOT, "frontend-web", "tests", "e2e"), (n) => n.endsWith(".ts"))];

for (const f of e2eFiles) {
  const src = readFileSync(f, "utf8");
  const consts = collectConsts(src);
  const rel = relative(ROOT, f);

  // A) explicit call sites
  let m;
  const re = new RegExp(REQ_RE.source, "g");
  while ((m = re.exec(src))) {
    const reqObj = m[1], verb = m[2], helper = m[3];
    const parenIdx = src.indexOf("(", m.index + m[0].length - 1);
    const args = splitTop(argList(src, parenIdx));
    const lits = args.map((a) => literalOf(a, consts)).filter(Boolean);
    let method = null, pathLit = null, tplConstArr = null;
    if (verb && verb !== "fetch") method = verb.toUpperCase();
    // verb literal arg
    for (const l of lits) if (HTTP_VERBS.has(l.lit.trim().toUpperCase())) method = l.lit.trim().toUpperCase();
    // method: 'X' inside opts object
    const mm = args.join(",").match(/method:\s*'(GET|POST|PUT|PATCH|DELETE|HEAD)'/);
    if (mm) method = mm[1];
    for (const a of args) {
      const lo = literalOf(a, consts);
      if (lo && stripBase(lo.lit).path.startsWith("/") && !HTTP_VERBS.has(stripBase(lo.lit).path.trim().toUpperCase())) {
        pathLit = lo.lit;
        break;
      }
      // ${GO_BACKEND_URL}${path} or ${ARR[0]}
      const tc = a.match(/^\s*`?\s*\$\{([A-Za-z_$][\w$]*)\}\s*\$\{([A-Za-z_$][\w$]*)(\[(\d+)\])?\}/);
      if (tc) {
        const base = tc[1], name = tc[2], idx = tc[4] ? Number(tc[4]) : null;
        if (consts.arrays.has(name)) {
          const arr = consts.arrays.get(name);
          tplConstArr = { base, items: idx !== null ? [arr.items[idx]].filter(Boolean) : arr.items, objs: arr.objs };
        } else if (consts.strings.has(name)) {
          pathLit = `\${${base}}${consts.strings.get(name)}`;
        }
        break;
      }
    }
    let surface = null;
    if (helper && GO_FNS.has(helper)) surface = "backend";
    else if (helper && BFF_FNS.has(helper)) surface = "bff";
    else if (reqObj) {
      if (pathLit) {
        const { base } = stripBase(pathLit);
        if (base === "GO_BACKEND_URL") surface = "backend";
        else if (base === "ADMIN_WEB_URL") surface = "admin";
        else if (base === "MAILPIT_URL" || base === "SUPABASE_URL") continue;
        else surface = "bff";
      } else if (tplConstArr) {
        surface = tplConstArr.base === "GO_BACKEND_URL" ? "backend" : tplConstArr.base === "ADMIN_WEB_URL" ? "admin" : "bff";
      }
    }
    if (!surface) continue;
    if (tplConstArr) {
      for (const it of tplConstArr.items) pushCall(it, method, surface, f, helper || `request.${verb}`);
      for (const o of tplConstArr.objs) pushCall(o.url, o.method, surface, f, helper || `request.${verb}`);
      continue;
    }
    if (!pathLit) continue;
    const { base, path } = stripBase(pathLit);
    if (base === "MAILPIT_URL" || base === "SUPABASE_URL") continue;
    pushCall(path, method, surface, f, helper || `request.${verb}`);
  }

  // B) fallback sweep: every remaining path literal in the file is a probed/
  //    exercised surface (assertion paths filtered by prefix allowlist).
  for (const s of iterStrings(src)) {
    const lit = s.content;
    if (!lit) continue;
    const { base, path } = stripBase(lit);
    if (!path.startsWith("/")) continue;
    if (base === "MAILPIT_URL" || base === "SUPABASE_URL") continue;
    const p0 = path;
    if (!/^\/(api|v1|v2|internal|healthz|readyz|metrics)\b/.test(p0) && !base) continue;
    if (p0 === "/" || p0.endsWith("/")) continue; // `.includes()` prefix markers, not calls
    if (/\.(ts|tsx|md|json|yaml|yml|spec)/.test(p0)) continue;
    // method hints on the same line / enclosing object literal
    const lineStart = src.lastIndexOf("\n", s.start) + 1;
    const lineEnd = src.indexOf("\n", s.end);
    const ctx = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd);
    const mh = ctx.match(/method:\s*'(GET|POST|PUT|PATCH|DELETE)'/);
    const method = mh ? mh[1] : null;
    let surface = "auto";
    if (base === "GO_BACKEND_URL") surface = "backend";
    else if (base === "ADMIN_WEB_URL") surface = "admin";
    pushCall(p0, method, surface, f, "literal");
  }
}

// Proper string-literal tokenizer: skips // and /* */ comments, honours
// escapes and ${...} nesting inside backticks. Naive regex pairing desyncs
// on apostrophes in comments (e.g. "A's wallet" in fin-007) and silently
// drops whole literal runs — that's how real probed endpoints were missed.
function* iterStrings(src) {
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const q = c, start = i;
      i++;
      let content = "", depth = 0;
      while (i < n) {
        const ch = src[i];
        if (ch === "\\") { content += ch + src[i + 1]; i += 2; continue; }
        if (q === "`" && ch === "$" && src[i + 1] === "{") { depth++; content += "${"; i += 2; continue; }
        if (depth > 0) {
          content += ch; i++;
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          continue;
        }
        if (ch === q) { i++; break; }
        content += ch; i++;
      }
      yield { quote: q, content, start, end: i };
      continue;
    }
    i++;
  }
}

// de-dup calls
const seenCall = new Set();
const calls = e2eCalls.filter((c) => {
  const k = `${c.surface}|${c.method}|${c.path}|${c.file}`;
  if (seenCall.has(k)) return false;
  seenCall.add(k);
  return true;
});

// ───────────────────────── results docs (secondary e2e evidence) ─────────────────────────

const resultsCalls = [];
for (const f of [...walk(join(E2E_DIR, "results"), (n) => n.endsWith(".md"))]) {
  const src = readFileSync(f, "utf8");
  const rel = relative(ROOT, f);
  for (const m of src.matchAll(/(GET|POST|PUT|PATCH|DELETE)\s+(\/(?:api|v1|v2|internal)[^\s`,)\]}'"`]*)/g)) {
    resultsCalls.push({ path: m[2], method: m[1], surface: "auto", file: rel, via: "results-doc" });
  }
  for (const m of src.matchAll(/`(\/(?:api|v1|v2|internal)[^\s`,)\]}'"`]*)`/g)) {
    if (/\.(ts|md|json|yaml)$/.test(m[1])) continue;
    resultsCalls.push({ path: m[1], method: null, surface: "auto", file: rel, via: "results-doc" });
  }
}

// ───────────────────────── unit/integration evidence ─────────────────────────

const unitCalls = []; // {path, method, file}
const GO_METHOD_PAIR = new Map(); // path-literal start index -> method (from same-line pairing)
for (const f of [...walk(join(ROOT, "backend"), (n) => n.endsWith("_test.go"))]) {
  const src = readFileSync(f, "utf8");
  const rel = relative(ROOT, f);
  // "GET", "/path"  or  http.MethodX, "/path" — line-local pairs for method info
  for (const m of src.matchAll(/"(GET|POST|PUT|PATCH|DELETE|HEAD)"\s*,\s*"(\/[^"]*)"/g))
    unitCalls.push({ path: m[2], method: m[1], file: rel });
  for (const m of src.matchAll(/http\.Method(Get|Post|Put|Patch|Delete|Head)\s*,\s*"(\/[^"]*)"/g))
    unitCalls.push({ path: m[2], method: m[1].toUpperCase(), file: rel });
  // comment-aware literal sweep (Go strings: "...", `...`, runes 'x')
  for (const s of iterStrings(src)) {
    const lit = s.content;
    if (/^\/(api|v1|v2|internal|healthz|readyz|metrics)/.test(lit) && !lit.includes("\n")) {
      unitCalls.push({ path: lit.replace(/\?.*$/, ""), method: null, file: rel });
    }
  }
}

// frontend unit specs: route-file imports + literals
const bffUnitImports = new Set(); // route_file suffixes
const bffUnitLits = [];
const unitDirs = [join(ROOT, "frontend-web", "tests", "unit"), join(ROOT, "frontend-web", "tests", "integration"), join(ROOT, "frontend-admin", "tests")];
for (const d of unitDirs) {
  for (const f of [...walk(d, (n) => n.endsWith(".ts") || n.endsWith(".tsx"))]) {
    const src = readFileSync(f, "utf8");
    const rel = relative(ROOT, f);
    for (const m of src.matchAll(/from\s+['"]([^'"]*app\/api\/[^'"]*?)\/?(?:route)?['"]/g)) {
      let p = m[1].replace(/^\.+\//g, "");
      const idx = p.indexOf("app/api/");
      if (idx >= 0) bffUnitImports.add(p.slice(idx) + (p.endsWith("route") ? ".ts" : "/route.ts"));
    }
    for (const s of iterStrings(src)) {
      const lit = s.content;
      if (lit.startsWith("/api/") && !/\.(ts|tsx)$/.test(lit) && !lit.includes("\n")) {
        bffUnitLits.push({ path: lit, file: rel });
      }
      const abs = lit.match(/^https?:\/\/[^/]+(\/api\/[^\s]*)/);
      if (abs) bffUnitLits.push({ path: abs[1], file: rel });
    }
  }
}

// ───────────────────────── internal-only predicate ─────────────────────────

function isInternal(path) {
  const segs = segSplit(path);
  if (path.startsWith("/internal/")) return true;
  if (segs.includes("webhooks") || segs.includes("webhook")) return true;
  const last = segs[segs.length - 1] || "";
  if (["healthz", "readyz", "livez", "metrics", "health", "ready"].includes(last)) return true;
  return false;
}

// ───────────────────────── apply evidence ─────────────────────────

function markBackend(path, method, evidenceTag, file) {
  let hit = false;
  for (const [key, row] of backendMap) {
    if (!pathsMatch(path, row.path)) continue;
    if (method && HTTP_VERBS.has(method) && row.method !== method) continue;
    hit = true;
    row.evidence.push(`${evidenceTag}:${file}`);
    row.e2eMethods.add(method && HTTP_VERBS.has(method) ? method : "*");
  }
  return hit;
}

function markBackendCanon(path, method, evidenceTag, file) {
  // faster path: exact canonical equality first
  const ck = canonKey(path);
  let hit = false;
  for (const [key, row] of backendMap) {
    if (canonKey(row.path) !== ck) continue;
    if (method && HTTP_VERBS.has(method) && row.method !== method) continue;
    hit = true;
    row.evidence.push(`${evidenceTag}:${file}`);
    row.e2eMethods.add(method && HTTP_VERBS.has(method) ? method : "*");
  }
  return hit;
}

// backend exercised marking from a call
function exerciseBackend(path, method, tag, file) {
  return markBackendCanon(path, method, tag, file) || markBackend(path, method, tag, file);
}

const unmatchedCalls = [];

function exerciseCall(c) {
  const p = c.path;
  if (c.surface === "backend") {
    if (!exerciseBackend(p, c.method, "e2e", c.file)) unmatchedCalls.push({ ...c, why: "no-backend-match" });
    return;
  }
  if (c.surface === "admin") {
    if (!p.startsWith("/api/")) return; // page.goto / page fetches — UI routes, not API
    // frontend-admin :3001
    if (p.startsWith("/api/admin-proxy/")) {
      const up = "/" + p.slice("/api/admin-proxy/".length);
      markBff("frontend-admin", "/api/admin-proxy/:path*", c.method, "e2e", c.file);
      if (!exerciseBackend(up, c.method, "e2e-via-admin-proxy", c.file)) unmatchedCalls.push({ ...c, path: up, why: "admin-proxy-upstream-no-backend-match" });
      return;
    }
    if (p.startsWith("/api/web-proxy/")) {
      const up = "/" + p.slice("/api/web-proxy/".length);
      markBff("frontend-admin", "/api/web-proxy/:path*", c.method, "e2e", c.file);
      exerciseBffPath("frontend-web", up, c.method, c.file);
      return;
    }
    const hit = markBff("frontend-admin", p, c.method, "e2e", c.file);
    if (!hit) unmatchedCalls.push({ ...c, why: "no-admin-bff-match" });
    return;
  }
  // surface bff or auto → try backend first for /v1|/internal style, else bff
  let hitBackend = false;
  if (c.surface === "auto" || /^\/(v1|v2|internal)\//.test(p) || (c.surface === "bff" && !p.startsWith("/api"))) {
    hitBackend = exerciseBackend(p, c.method, "e2e", c.file);
  }
  const hitBff = p.startsWith("/api") ? exerciseBffPath("frontend-web", p, c.method, c.file) : false;
  if (!hitBackend && !hitBff) {
    // last chance: maybe the raw path is a Go path not under /api
    if (exerciseBackend(p, c.method, "e2e", c.file)) return;
    unmatchedCalls.push({ ...c, why: "no-match" });
  }
}

function markBff(app, pathOrPattern, method, tag, file) {
  let hit = false;
  for (const r of bffRoutes) {
    if (r.app !== app) continue;
    const caps = bffMatch(r, pathOrPattern) || (r.pattern === pathOrPattern ? {} : null);
    if (!caps && r.pattern !== pathOrPattern) continue;
    hit = true;
    r.evidence.push(`${tag}:${file}`);
    r.e2eMethods.add(method && HTTP_VERBS.has(method) ? method : "*");
  }
  return hit;
}

function exerciseBffPath(app, calledPath, method, file) {
  const found = findBffRoute(app, calledPath);
  if (!found) return false;
  const { route, caps } = found;
  route.evidence.push(`e2e:${file}`);
  route.e2eMethods.add(method && HTTP_VERBS.has(method) ? method : "*");
  // upstream attribution via proxyToGoBackend templates
  const tpls = upstreamTemplatesFor(app, route.file);
  for (const tpl of tpls) {
    const up = buildUpstream(tpl, caps);
    if (up && up.startsWith("/")) exerciseBackend(up, method, `e2e-via-bff(${route.file})`, file);
  }
  // catch-alls proxying verbatim (no tpl captured): try called path as upstream too
  if (route.pattern.includes(":path")) {
    exerciseBackend(calledPath, method, `e2e-via-bff(${route.file})`, file);
    // admin-proxy remainder semantics are handled in exerciseCall
  }
  return true;
}

for (const c of calls) exerciseCall(c);
for (const c of resultsCalls) {
  const hit = exerciseBackend(c.path, c.method, "e2e-results", c.file) || exerciseBffPath("frontend-web", c.path, c.method, c.file);
  void hit;
}

// unit evidence
for (const u of unitCalls) {
  for (const row of backendMap.values()) {
    if (pathsMatch(u.path, row.path) || canonKey(u.path) === canonKey(row.path)) {
      if (u.method && u.method !== row.method) continue;
      row.unitHit = true;
      row.evidence.push(`unit:${u.file}`);
    }
  }
}
for (const r of bffRoutes) {
  if (bffUnitImports.has(r.file)) {
    r.unitHit = true;
    r.evidence.push("unit:route-import");
  }
}
for (const l of bffUnitLits) {
  const found = findBffRoute("frontend-web", l.path) || findBffRoute("frontend-admin", l.path);
  if (found) {
    found.route.unitHit = true;
    found.route.evidence.push(`unit:${l.file}`);
  }
  for (const row of backendMap.values()) {
    if (canonKey(l.path) === canonKey(row.path)) {
      row.unitHit = true;
      row.evidence.push(`unit-ref:${l.file}`);
    }
  }
}

// ───────────────────────── classify ─────────────────────────

function methodCovered(row, method) {
  return row.e2eMethods.has(method) || row.e2eMethods.has("*");
}

function classifyBackend() {
  const out = [];
  for (const row of backendMap.values()) {
    const internal = isInternal(row.path);
    let cls;
    if (internal) cls = "internal-or-infra-only";
    else if (methodCovered(row, row.method)) cls = "exercised-by-live-e2e";
    else if (row.unitHit) cls = "exercised-by-unit-or-integration-test";
    else cls = "uncovered";
    const ev = [...new Set(row.evidence)].slice(0, 4).join("|");
    out.push({ path: row.path, method: row.method, source: "backend", cls, evidence: ev, module: backendModule(row.sourceFile), sourceFile: row.source_file });
  }
  return out;
}
function backendModule(src) {
  if (src.startsWith("internal/app/")) {
    const base = src.split("/").pop().replace(/\.go$/, "").replace(/_(routes|rails|webhooks|handlers?)$/, "");
    return `app:${base}`;
  }
  if (src.startsWith("internal/")) return src.split("/")[1];
  return src.split("/").slice(0, 2).join("/");
}
function classifyBff() {
  const out = [];
  for (const r of bffRoutes) {
    const internal = isInternal(r.pattern);
    const methods = r.methods.length ? r.methods : ["GET"];
    for (const m of methods) {
      let cls;
      if (internal) cls = "internal-or-infra-only";
      else if (methodCovered(r, m)) cls = "exercised-by-live-e2e";
      else if (r.unitHit) cls = "exercised-by-unit-or-integration-test";
      else cls = "uncovered";
      out.push({ path: r.pattern, method: m, source: "bff", cls, evidence: [...new Set(r.evidence)].slice(0, 4).join("|"), module: `${r.app}:${segSplit(r.pattern).slice(0, 2).join("/")}`, sourceFile: r.file });
    }
  }
  return out;
}
function classifyContract() {
  const out = [];
  for (const o of contractOps) {
    const variants = contractPathVariants(o).map(canonKey);
    // exercised if any backend row or bff route with a matching expanded
    // canonical path was e2e-covered
    let exercised = false, unit = false;
    const ev = [];
    for (const row of backendMap.values()) {
      const rk = canonKey(row.path);
      if (variants.includes(rk) || variants.some((v) => pathsMatch(v, row.path))) {
        if (row.e2eMethods.size) { exercised = true; ev.push(...row.evidence); }
        if (row.unitHit) unit = true;
      }
    }
    for (const r of bffRoutes) {
      if (r.segs.some((s) => s.type === "splat" || s.type === "splat-opt")) continue; // catch-all proxies don't evidence a specific op
      const matched = variants.some((v) => bffMatch(r, v));
      if (matched && r.e2eMethods.size) { exercised = true; ev.push(...r.evidence); }
      if (matched && r.unitHit) unit = true;
    }
    let cls = exercised ? "exercised-by-live-e2e" : unit ? "exercised-by-unit-or-integration-test" : isInternal(o.path) ? "internal-or-infra-only" : "uncovered";
    out.push({ path: o.path, method: o.method, source: "contract", cls, evidence: [...new Set(ev)].slice(0, 3).join("|"), module: `${o.file}${o.tag ? ":" + o.tag : ""}`, sourceFile: o.file });
  }
  return out;
}

const beOut = classifyBackend();
const bffOut = classifyBff();
const ctOut = classifyContract();
const all = [...beOut, ...bffOut, ...ctOut];

// ───────────────────────── write CSV ─────────────────────────

mkdirSync(E2E_DIR, { recursive: true });
const csv = ["path,method,source,coverage_class,evidence"];
for (const r of all) csv.push([r.path, r.method, r.source, r.cls, r.evidence].map(csvEsc).join(","));
writeFileSync(join(E2E_DIR, "api-coverage.csv"), csv.join("\n") + "\n");

// ───────────────────────── analytics for report ─────────────────────────

const tally = (rows) => {
  const t = { total: rows.length, e2e: 0, unit: 0, internal: 0, uncovered: 0 };
  for (const r of rows) t[r.cls === "exercised-by-live-e2e" ? "e2e" : r.cls === "exercised-by-unit-or-integration-test" ? "unit" : r.cls === "internal-or-infra-only" ? "internal" : "uncovered"]++;
  return t;
};
const beT = tally(beOut), bffT = tally(bffOut), ctT = tally(ctOut);

// unique-path coverage for backend (a path covered if ANY method covered e2e)
const bePathCov = new Map();
for (const r of beOut) {
  const cur = bePathCov.get(r.path) || { cls: r.cls };
  if (cur.cls === "uncovered" && r.cls !== "uncovered") cur.cls = r.cls;
  bePathCov.set(r.path, cur);
}

// per-module table (backend + bff)
const modules = new Map();
for (const r of [...beOut, ...bffOut]) {
  const m = modules.get(r.module) || { total: 0, e2e: 0, unit: 0, internal: 0, uncovered: 0 };
  m.total++;
  m[r.cls === "exercised-by-live-e2e" ? "e2e" : r.cls === "exercised-by-unit-or-integration-test" ? "unit" : r.cls === "internal-or-infra-only" ? "internal" : "uncovered"]++;
  modules.set(r.module, m);
}
const modRows = [...modules.entries()].sort((a, b) => b[1].total - a[1].total);

// risk-ranked uncovered backend paths
const MONEY = /wallet|ledger|transfer|payment|payout|withdraw|deposit|savings|topup|top-up|refund|settle|paystack|bank|va-|virtual|fund|debit|credit|kobo|fee|tuition|installment|escrow|order/i;
const AUTHK = /auth|login|session|token|password|otp|mfa|sso/i;
const USERD = /profile|\/me\b|kyc|user|account|identity|pii|document|photo|upload/i;
const ADMINK = /admin/;
function risk(r) {
  let s = 0;
  if (MONEY.test(r.path)) s += 100;
  if (AUTHK.test(r.path)) s += 90;
  if (USERD.test(r.path)) s += 70;
  if (ADMINK.test(r.path)) s += 40;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(r.method)) s += 15;
  if (contractCanon.has(`${r.method} ${canonKey(r.path)}`)) s += 25;
  return s;
}
const uncoveredProd = beOut.filter((r) => r.cls === "uncovered").map((r) => ({ ...r, score: risk(r) })).sort((a, b) => b.score - a.score);

// contract-undocumented backend paths exercised anyway
// "documented" = path appears in the contract set under ANY mount prefix
// (path-only match, same rule as compare-inventory.mjs's reverse delta).
const beNotInContract = beOut.filter((r) => !contractPathCanon.has(canonKey(r.path)));
const undocumentedExercised = beNotInContract.filter((r) => r.cls === "exercised-by-live-e2e");
const undocumentedPaths = new Set(beNotInContract.map((r) => r.path));

// anomalies: e2e-called literals matching nothing
const anomalies = [...new Map(unmatchedCalls.map((c) => [`${c.path}|${c.method}`, c])).values()].sort((a, b) => a.path.localeCompare(b.path));

// ───────────────────────── write report ─────────────────────────

const uniqBePaths = new Set(beOut.map((r) => r.path)).size;
const beE2ePaths = new Set(beOut.filter((r) => r.cls === "exercised-by-live-e2e").map((r) => r.path)).size;
const beUnitPaths = new Set(beOut.filter((r) => r.cls === "exercised-by-unit-or-integration-test").map((r) => r.path)).size;
const beIntPaths = new Set(beOut.filter((r) => r.cls === "internal-or-infra-only").map((r) => r.path)).size;
const beUncPaths = new Set(beOut.filter((r) => r.cls === "uncovered").map((r) => r.path)).size;

const lines = [];
lines.push("# API coverage gap report");
lines.push("");
lines.push(`Generated by \`scripts/e2e/coverage-analyze.mjs\`. Machine-readable rows: \`docs/e2e/api-coverage.csv\`.`);
lines.push("");
lines.push("Coverage classes: `exercised-by-live-e2e` (a Playwright spec or results-doc shows the path was called against the live stack), `exercised-by-unit-or-integration-test` (path literal in backend `*_test.go` or frontend unit spec / route import), `internal-or-infra-only` (`/internal/*` hooks, webhooks, `/healthz`, `/readyz`, metrics, `*/health`), `uncovered`.");
lines.push("");
lines.push("Method caveat: many e2e helpers carry the verb in an `opts` object the extractor could not always resolve; an exercise with unknown method covers every registered method row of that path (`*` evidence). Contract rows share method+canonical-path matching.");
lines.push("");
lines.push("Upstream-attribution caveat: `e2e-via-bff` evidence assumes the BFF proxy forwarded to Go. Feature-flag-gated proxies that short-circuit (503 before `proxyToGoBackend`) may inflate via-BFF coverage slightly; direct `e2e:` evidence (goFetch/adminGo/request against `:8080` or results-doc recorded traffic) is unaffected.");
lines.push("");
lines.push("Probe coverage note: auth/authZ negative probes (anon → 401, wrong-user → 403) count as exercised — the route's middleware/handler chain ran live.");
lines.push("");
lines.push("## Headline counts");
lines.push("");
lines.push("| Surface | Endpoints (path+method) | e2e | unit/integration | internal | uncovered |");
lines.push("|---|---|---|---|---|---|");
lines.push(`| Backend Go routes | ${beT.total} (${uniqBePaths} unique paths) | ${beT.e2e} | ${beT.unit} | ${beT.internal} | ${beT.uncovered} |`);
lines.push(`| BFF route handlers | ${bffT.total} | ${bffT.e2e} | ${bffT.unit} | ${bffT.internal} | ${bffT.uncovered} |`);
lines.push(`| Contract operations | ${ctT.total} | ${ctT.e2e} | ${ctT.unit} | ${ctT.internal} | ${ctT.uncovered} |`);
lines.push("");
lines.push(`Backend unique-path view: ${beE2ePaths} e2e / ${beUnitPaths} unit-only / ${beIntPaths} internal / ${beUncPaths} uncovered of ${uniqBePaths}.`);
lines.push("");
lines.push("## Contract cross-tab (backend)");
lines.push("");
lines.push(`- Backend endpoints matching a contract operation: ${beOut.length - beNotInContract.length} of ${beOut.length} rows.`);
lines.push(`- Backend unique paths absent from all contracts: ${undocumentedPaths.size} (inventory says ~1,698).`);
lines.push(`- Contract-undocumented backend paths exercised by e2e anyway: ${[...new Set(undocumentedExercised.map((r) => r.path))].length}.`);
for (const p of [...new Set(undocumentedExercised.map((r) => r.path))].sort()) lines.push(`  - \`${p}\``);
lines.push("");
lines.push("## Top 20 highest-risk uncovered backend endpoints (all surfaces)");
lines.push("");
lines.push("| # | Method | Path | Module | Risk score | Why |");
lines.push("|---|---|---|---|---|---|");
uncoveredProd.slice(0, 20).forEach((r, i) => {
  const why = [MONEY.test(r.path) && "money", AUTHK.test(r.path) && "auth", USERD.test(r.path) && "user-data", ADMINK.test(r.path) && "admin", contractCanon.has(`${r.method} ${canonKey(r.path)}`) && "contracted"].filter(Boolean).join(",");
  lines.push(`| ${i + 1} | ${r.method} | \`${r.path}\` | ${r.module} | ${r.score} | ${why} |`);
});
lines.push("");
lines.push("## Top 20 member-facing uncovered backend endpoints (admin paths excluded)");
lines.push("");
lines.push("| # | Method | Path | Module | Risk score | Why |");
lines.push("|---|---|---|---|---|---|");
uncoveredProd.filter((r) => !ADMINK.test(r.path)).slice(0, 20).forEach((r, i) => {
  const why = [MONEY.test(r.path) && "money", AUTHK.test(r.path) && "auth", USERD.test(r.path) && "user-data", contractCanon.has(`${r.method} ${canonKey(r.path)}`) && "contracted"].filter(Boolean).join(",");
  lines.push(`| ${i + 1} | ${r.method} | \`${r.path}\` | ${r.module} | ${r.score} | ${why} |`);
});
lines.push("");
lines.push("## Per-module coverage (backend + bff rows)");
lines.push("");
lines.push("| Module | Endpoints | e2e | unit | internal | uncovered | % covered (non-internal) |");
lines.push("|---|---|---|---|---|---|---|");
for (const [m, t] of modRows) {
  const denom = t.total - t.internal;
  const pct = denom ? Math.round(((t.e2e + t.unit) / denom) * 100) : 100;
  lines.push(`| ${m} | ${t.total} | ${t.e2e} | ${t.unit} | ${t.internal} | ${t.uncovered} | ${pct}% |`);
}
lines.push("");
lines.push("## Anomalies");
lines.push("");
lines.push(`**Inventory drift:** ${bffDrift.length} route.ts files exist on disk but are absent from \`inventory-bff-routes.csv\` (added after the inventory was generated; both are untracked in git). They are included above as supplemental \`bff\` rows:`);
for (const d of bffDrift) lines.push(`- \`${d}\``);
lines.push("");
lines.push(`**Unmatched e2e literals:** ${anomalies.length} distinct called literals matched neither the backend route inventory nor a BFF route pattern:`);
lines.push("");
for (const a of anomalies.slice(0, 60)) lines.push(`- \`${a.method ?? "?"}\` \`${a.path}\` — ${a.why} (${a.file})`);
if (anomalies.length > 60) lines.push(`- …and ${anomalies.length - 60} more`);
lines.push("");
lines.push("## Uncovered production-facing clusters (backend, by module)");
lines.push("");
const uncByMod = new Map();
for (const r of uncoveredProd) {
  const arr = uncByMod.get(r.module) || [];
  arr.push(r);
  uncByMod.set(r.module, arr);
}
for (const [m, arr] of [...uncByMod.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
  const money = arr.filter((r) => MONEY.test(r.path)).length;
  lines.push(`- **${m}** — ${arr.length} uncovered (${money} money-path)`);
}
lines.push("");
writeFileSync(join(E2E_DIR, "API-COVERAGE.md"), lines.join("\n") + "\n");

// ───────────────────────── console summary ─────────────────────────
console.log(JSON.stringify({
  backend: { ...beT, uniquePaths: uniqBePaths, e2ePaths: beE2ePaths, unitPaths: beUnitPaths, internalPaths: beIntPaths, uncoveredPaths: beUncPaths },
  bff: bffT,
  contract: ctT,
  undocumentedBackendPathsExercised: [...new Set(undocumentedExercised.map((r) => r.path))].length,
  undocumentedBackendPathsTotal: undocumentedPaths.size,
  anomalies: anomalies.length,
  bffDrift,
  e2eCallsExtracted: calls.length,
  resultsDocRefs: resultsCalls.length,
  unitLiterals: unitCalls.length,
  bffUnitImports: bffUnitImports.size,
}, null, 1));
