#!/usr/bin/env node
// scripts/e2e/scan-gin-routes.mjs
// Inventories Gin route registrations under backend/ (internal + cmd, tests excluded)
// into docs/e2e/inventory-backend-routes.csv.
//
// What it does:
//   * Finds `.GET/.POST/.PUT/.PATCH/.DELETE/.HEAD/.OPTIONS/.Any("path")` and
//     `.Handle("METHOD","path")` / `.Handle(http.MethodX,"path")` calls.
//   * Reconstructs group prefixes:
//       - `v := expr.Group("/lit")` assignments (nested `.Group("").Group("")` too)
//       - `v := groupishHelper(base, "/lit")` (name contains "group", e.g. adminGroupTop5)
//       - `expr.Group("/lit").Use(mw).METHOD("/sub", h)` inline chains
//       - `*gin.RouterGroup` / `*gin.Engine` function parameters: call sites like
//         `RegisterEvents(finance.Group("/events"), eventsAdmin, ...)` are matched to the
//         callee's group params (in declaration order) so routes inside Register* bodies
//         resolve to their real prefix. Package-qualified calls (`webhooks.Register`) are
//         resolved via the import path tail; unqualified calls resolve within the same dir.
//   * Where a prefix can't be resolved the raw registered path is emitted and the
//     route_group column records UNRESOLVED(<receiver>) / UNRESOLVED_ARG(func:param).
//
// It is a heuristic source scanner, not a Go compiler — comments/strings are masked
// before regexing so URLs like "http://x" don't break comment stripping.
//
// Usage: node scripts/e2e/scan-gin-routes.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKEND = join(ROOT, "backend");
const OUT = join(ROOT, "docs", "e2e", "inventory-backend-routes.csv");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// ── walk .go files ──────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "vendor" || e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(p, out);
    } else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) {
      out.push(p);
    }
  }
  return out;
}
const files = [...walk(join(BACKEND, "internal")), ...walk(join(BACKEND, "cmd"))];

// ── mask comments + string literal contents (positions preserved) ────────────
function mask(src) {
  const a = src.split("");
  let i = 0, state = "code";
  while (i < a.length) {
    const c = a[i], n = a[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") { state = "line"; a[i] = a[i + 1] = " "; i += 2; continue; }
      if (c === "/" && n === "*") { state = "block"; a[i] = a[i + 1] = " "; i += 2; continue; }
      if (c === '"') { state = "dq"; i++; continue; }
      if (c === "`") { state = "raw"; i++; continue; }
      if (c === "'") { state = "char"; i++; continue; }
      i++; continue;
    }
    if (state === "line") { if (c === "\n") state = "code"; else a[i] = " "; i++; continue; }
    if (state === "block") {
      if (c === "*" && n === "/") { a[i] = a[i + 1] = " "; i += 2; state = "code"; continue; }
      if (c !== "\n") a[i] = " "; i++; continue;
    }
    // string states: blank contents, keep delimiters, respect escapes
    if (state === "dq" || state === "char") {
      if (c === "\\") { a[i] = " "; if (a[i + 1] && a[i + 1] !== "\n") a[i + 1] = " "; i += 2; continue; }
      if ((state === "dq" && c === '"') || (state === "char" && c === "'")) { state = "code"; i++; continue; }
      if (c !== "\n") a[i] = " "; i++; continue;
    }
    if (state === "raw") {
      if (c === "`") { state = "code"; i++; continue; }
      if (c !== "\n") a[i] = " "; i++; continue;
    }
    i++;
  }
  return a.join("");
}
const litAt = (src, quotePos) => {
  // quotePos points at the opening `"` or '`' in ORIGINAL src; return inner text
  const q = src[quotePos];
  const end = src.indexOf(q, quotePos + 1);
  return end === -1 ? "" : src.slice(quotePos + 1, end);
};

function matchBraces(m, openPos) {
  let depth = 0;
  for (let i = openPos; i < m.length; i++) {
    if (m[i] === "{") depth++;
    else if (m[i] === "}") { depth--; if (depth === 0) return i; }
  }
  return m.length;
}
function matchParens(m, openPos) {
  let depth = 0;
  for (let i = openPos; i < m.length; i++) {
    if (m[i] === "(") depth++;
    else if (m[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return m.length;
}
function splitTopLevel(s) {
  const parts = []; let depth = 0, cur = "";
  for (const c of s) {
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map(p => p.trim());
}
const lineOf = (src, pos) => src.slice(0, pos).split("\n").length;

// ── pass 1: parse files, collect func defs with *gin group params ────────────
const parsed = [];   // {path, rel, dir, pkg, masked, orig, funcs:[{name,start,end,grpParams:[names]}]}
const funcsByDirName = new Map(); // `${relDir}:${name}` -> func  (relDir = path under backend/)
const funcsByDirRecv = new Map(); // `${relDir}:${recvType}:${name}` -> method func
const funcsByName = new Map();    // name -> [func,...]
const FUNC_RE = /func\s+(?:\(([^)]*)\)\s*)?([A-Za-z_]\w*)\s*\(/g;

for (const path of files) {
  const orig = readFileSync(path, "utf8");
  const masked = mask(orig);
  const rel = relative(BACKEND, path);
  const dir = basename(dirname(path));
  const pkgM = masked.match(/^\s*package\s+(\w+)/);
  const pkg = pkgM ? pkgM[1] : dir;
  const relDir = relative(BACKEND, dirname(path));
  const rec = { path, rel, dir, relDir, pkg, masked, orig, funcs: [] };

  // import aliases: `alias "path"` and bare `"path"` → relative dir under backend/
  rec.imports = new Map();
  const impRe = /(?:^|\n)\s*(?:(\w+)\s+)?"(spotlight\/backend\/[^"]+|internal\/[^"]+)"/g;
  let im;
  while ((im = impRe.exec(orig))) {
    const ipath = im[2].replace(/^spotlight\/backend\//, "");
    rec.imports.set(im[1] || ipath.split("/").pop(), ipath);
  }

  let fm;
  FUNC_RE.lastIndex = 0;
  while ((fm = FUNC_RE.exec(masked))) {
    const name = fm[2];
    const paramsOpen = masked.indexOf("(", fm.index + fm[0].length - 1);
    const paramsClose = matchParens(masked, paramsOpen);
    const paramsSrc = masked.slice(paramsOpen + 1, paramsClose);
    const bodyOpen = masked.indexOf("{", paramsClose);
    if (bodyOpen === -1 || bodyOpen - paramsClose > 400) continue;
    const bodyEnd = matchBraces(masked, bodyOpen);
    // group params: `x *gin.RouterGroup|*gin.Engine` (incl. shared-type `a, b *gin.RouterGroup`)
    const grpParams = [];
    let pending = [];
    for (const p of splitTopLevel(paramsSrc)) {
      const pm = p.match(/^([A-Za-z_]\w*)\s+(?:\*?gin\.(?:RouterGroup|Engine)|gin\.IRouters?|gin\.IRoutes?)\s*$/);
      if (pm) { grpParams.push(...pending, pm[1]); pending = []; continue; }
      if (/^[A-Za-z_]\w*$/.test(p)) { pending.push(p); continue; }
      pending = [];
    }
    const recvM = fm[1] ? fm[1].match(/\*?(\w+)\s*$/) : null;
    const fn = { name, file: rec, start: bodyOpen, end: bodyEnd, grpParams, recv: recvM ? recvM[1] : null };
    rec.funcs.push(fn);
    // prefer funcs that take gin groups when same name exists in the dir
    const k1 = `${relDir}:${name}`, k2 = `${dir}:${name}`;
    if (!funcsByDirName.has(k1) || (funcsByDirName.get(k1).grpParams.length === 0 && fn.grpParams.length > 0)) funcsByDirName.set(k1, fn);
    if (!funcsByDirName.has(k2) || (funcsByDirName.get(k2).grpParams.length === 0 && fn.grpParams.length > 0)) funcsByDirName.set(k2, fn); // basename fallback
    if (fn.recv) funcsByDirRecv.set(`${relDir}:${fn.recv}:${name}`, fn);
    if (!funcsByName.has(name)) funcsByName.set(name, []);
    funcsByName.get(name).push(fn);
  }
  parsed.push(rec);
}

// ── prefix resolution helpers ────────────────────────────────────────────────
// prefix values are strings; ARG::funcFile::funcName::param marks a group param
// that must be substituted from call-site data at emit time.
const argRef = (fn, param, suffix) => `ARG::${fn.file.rel}::${fn.name}::${param}${suffix || ""}`;

function resolveExpr(expr, vars, curFn) {
  // expr is masked receiver text, e.g. `finance`, `r.Group("").Use(mw)`, `h.g`
  expr = expr.trim();
  const groupSegs = [];
  let base = expr;
  // peel trailing `.Group("")` / `.Use(...)` / `.METHOD("")` chains is NOT needed here —
  // callers pass the base before `.METHOD`. Extract every Group segment.
  const gRe = /\.Group\(\s*"[^"\n]*"\s*[^)]*\)/g;
  let gm, litPositions = [];
  while ((gm = gRe.exec(expr))) groupSegs.push({ masked: gm[0], pos: gm.index });
  if (groupSegs.length) base = expr.slice(0, groupSegs[0].pos).trim();
  // recover literals from original source — but expr is a substring of masked, we
  // need absolute positions; callers pass {expr, absPos}
  return { base, groupSegs };
}

// ── pass 2: per-file sequential scan ─────────────────────────────────────────
// callSitePrefixes: Map<func, Map<paramName, Set<prefix>>>
const callSitePrefixes = new Map();
const registrations = []; // {file, method, rawPath, prefixSpec, receiver}

// helper call: v := ident(base, "lit") where ident contains "group"
const ASSIGN_HELPER_RE = /([A-Za-z_]\w*)\s*:=\s*([A-Za-z_]\w*(?:group|Group)\w*)\(\s*([A-Za-z_]\w*)\s*,\s*"[^"\n]*"/g;
const ASSIGN_GROUP_RE = /([A-Za-z_]\w*)\s*:=\s*([A-Za-z_][\w.()\[\]]*?)\.Group\(\s*"[^"\n]*"/g;
const ASSIGN_ALIAS_RE = /^\s*([A-Za-z_]\w*)\s*:=\s*([A-Za-z_]\w*)\s*$/gm;
const METHOD_RE = /([A-Za-z_][\w.()\[\]]*?)\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any)\(\s*"[^"\n]*"/g;
const HANDLE_STR_RE = /([A-Za-z_][\w.()\[\]]*?)\.Handle\(\s*"[^"\n]*"\s*,\s*"[^"\n]*"/g;
const HANDLE_HTTP_RE = /([A-Za-z_][\w.()\[\]]*?)\.Handle\(\s*http\.Method([A-Za-z]+)\s*,\s*"[^"\n]*"/g;

function fnAt(rec, pos) {
  for (const f of rec.funcs) if (pos >= f.start && pos <= f.end) return f;
  return null;
}

function basePrefix(base, vars, curFn, orig, maskedAbsOffset) {
  // base: masked expr like `r`, `member`, `x.y`, `r.Group("").Use(z)` (already peeled? no—base only)
  base = base.trim();
  const idm = base.match(/^([A-Za-z_]\w*)$/);
  if (idm) {
    const nm = idm[1];
    if (vars.has(nm)) return vars.get(nm);
    if (curFn && curFn.grpParams.includes(nm)) return argRef(curFn, nm, "");
    if (["r", "router", "e", "engine", "srv", "g", "api", "root", "mux"].includes(nm)) return "";
    return `UNRESOLVED:${nm}`;
  }
  // qualified ident like h.engine / s.router — try last segment
  const tail = base.match(/\.([A-Za-z_]\w*)$/);
  if (tail) {
    const nm = tail[1];
    if (vars.has(nm)) return vars.get(nm);
    if (curFn && curFn.grpParams.includes(nm)) return argRef(curFn, nm, "");
    return `UNRESOLVED:${base}`;
  }
  return `UNRESOLVED:${base}`;
}

// resolve a masked receiver expression (may contain .Group("")/.Use(...) chains)
// absStart = position of expr in masked file (to recover literals from orig)
function resolveReceiver(exprMasked, absStart, vars, curFn, orig) {
  let prefix = "";
  const segRe = /\.Group\(\s*"[^"\n]*"/g;
  let firstSeg = exprMasked.search(/\.Group\(\s*"[^"\n]*"/) ;
  let baseEnd = firstSeg === -1 ? exprMasked.length : firstSeg;
  const base = exprMasked.slice(0, baseEnd).trim();
  prefix = basePrefix(base, vars, curFn, orig);
  let sm;
  while ((sm = segRe.exec(exprMasked))) {
    const qPos = orig.indexOf('"', absStart + sm.index);
    const lit = litAt(orig, qPos);
    prefix += lit;
  }
  return prefix;
}

for (const rec of parsed) {
  const { masked: m, orig } = rec;
  const vars = new Map();

  // collect events in source order
  const events = [];
  let mm;
  ASSIGN_GROUP_RE.lastIndex = 0;
  while ((mm = ASSIGN_GROUP_RE.exec(m))) events.push({ kind: "groupAssign", pos: mm.index, mm });
  ASSIGN_ALIAS_RE.lastIndex = 0;
  while ((mm = ASSIGN_ALIAS_RE.exec(m))) events.push({ kind: "aliasAssign", pos: mm.index, mm });
  ASSIGN_HELPER_RE.lastIndex = 0;
  while ((mm = ASSIGN_HELPER_RE.exec(m))) events.push({ kind: "helperAssign", pos: mm.index, mm });
  METHOD_RE.lastIndex = 0;
  while ((mm = METHOD_RE.exec(m))) events.push({ kind: "method", pos: mm.index, mm });
  HANDLE_STR_RE.lastIndex = 0;
  while ((mm = HANDLE_STR_RE.exec(m))) events.push({ kind: "handleStr", pos: mm.index, mm });
  HANDLE_HTTP_RE.lastIndex = 0;
  while ((mm = HANDLE_HTTP_RE.exec(m))) events.push({ kind: "handleHttp", pos: mm.index, mm });
  events.sort((a, b) => a.pos - b.pos);

  for (const ev of events) {
    const curFn = fnAt(rec, ev.pos);
    if (ev.kind === "groupAssign") {
      const [, v, baseExpr] = ev.mm;
      // literal of THIS Group call is the last "" before closing paren region
      const qPos = orig.indexOf('"', ev.mm.index + ev.mm[0].indexOf('.Group('));
      const lit = litAt(orig, qPos);
      // baseExpr may itself contain .Group("") chains
      const prefix = resolveReceiver(baseExpr, ev.mm.index + ev.mm[0].indexOf(baseExpr), vars, curFn, orig);
      vars.set(v, prefix + lit);
      continue;
    }
    if (ev.kind === "aliasAssign") {
      const [, v, src] = ev.mm;
      if (vars.has(src)) vars.set(v, vars.get(src));
      else if (curFn && curFn.grpParams.includes(src)) vars.set(v, argRef(curFn, src, ""));
      else if (["r", "router", "e", "engine", "srv", "api", "mux", "root"].includes(src)) vars.set(v, "");
      continue;
    }
    if (ev.kind === "helperAssign") {
      const [, v, fnName, baseIdent] = ev.mm;
      // only treat as group-returning helper
      const qPos = orig.indexOf('"', ev.mm.index + ev.mm[0].indexOf('('));
      const lit = litAt(orig, qPos);
      let base;
      if (vars.has(baseIdent)) base = vars.get(baseIdent);
      else if (curFn && curFn.grpParams.includes(baseIdent)) base = argRef(curFn, baseIdent, "");
      else if (["r", "router", "e", "engine", "api"].includes(baseIdent)) base = "";
      else base = `UNRESOLVED:${baseIdent}`;
      vars.set(v, base + lit);
      continue;
    }
    if (ev.kind === "method") {
      const [whole, recvExpr, method] = ev.mm;
      const qPos = orig.indexOf('"', ev.pos + whole.indexOf('.') + 1);
      const rawPath = litAt(orig, qPos);
      const absStart = ev.pos + whole.indexOf(recvExpr);
      const prefix = resolveReceiver(recvExpr, absStart, vars, curFn, orig);
      registrations.push({ file: rec.rel, method, rawPath, prefixSpec: prefix, receiver: recvExpr.trim() });
      continue;
    }
    if (ev.kind === "handleStr") {
      const [whole, recvExpr] = ev.mm;
      // two literals: method then path
      const handlePos = ev.pos + whole.indexOf(".Handle(");
      const methQ = orig.indexOf('"', handlePos);
      const method = litAt(orig, methQ);
      const pathQ = orig.indexOf('"', orig.indexOf('"', methQ + 1) + 1);
      const rawPath = litAt(orig, pathQ);
      const absStart = ev.pos + whole.indexOf(recvExpr);
      const prefix = resolveReceiver(recvExpr, absStart, vars, curFn, orig);
      registrations.push({ file: rec.rel, method: method.toUpperCase() || "HANDLE", rawPath, prefixSpec: prefix, receiver: recvExpr.trim() });
      continue;
    }
    if (ev.kind === "handleHttp") {
      const [whole, recvExpr, mName] = ev.mm;
      const qPos = orig.indexOf('"', ev.pos + whole.indexOf(".Handle("));
      const rawPath = litAt(orig, qPos);
      const absStart = ev.pos + whole.indexOf(recvExpr);
      const prefix = resolveReceiver(recvExpr, absStart, vars, curFn, orig);
      registrations.push({ file: rec.rel, method: mName.toUpperCase(), rawPath, prefixSpec: prefix, receiver: recvExpr.trim() });
      continue;
    }
  }

  // ── call sites → propagate prefixes to callee group params ────────────────
  // var→package tracking: `v := pkgIdent.NewX(...)` ties receiver vars to a pkg
  // dir so `v.Register(g)` / `v.RegisterExtranet(g)` method calls resolve.
  // Position-aware: the same var name is reused for different packages across
  // functions (handler := savings.NewHandler … handler := social.NewHandler).
  const varType = new Map(); // name -> [{pos, dir, ctorType}] sorted by pos
  const vtRe = /([A-Za-z_]\w*)\s*:=\s*(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\(/g;
  let vt;
  const ctorType = (ctor) => ctor.replace(/^New/, "");
  while ((vt = vtRe.exec(m))) {
    const dir = vt[2] && rec.imports.has(vt[2]) ? rec.imports.get(vt[2])
              : vt[2] === undefined && /^New[A-Z]/.test(vt[3]) ? rec.relDir : undefined;
    if (dir) {
      if (!varType.has(vt[1])) varType.set(vt[1], []);
      varType.get(vt[1]).push({ pos: vt.index, dir, ctorType: ctorType(vt[3]) });
    }
  }
  const varTypeAt = (name, pos) => {
    const list = varType.get(name);
    if (!list) return undefined;
    let best;
    for (const e of list) if (e.pos <= pos) best = e;
    return best;
  };
  // names of funcs that take gin groups
  const candNames = new Set([...funcsByName.keys()]);
  const callRe = /([A-Za-z_]\w*)\s*(?:\.\s*([A-Za-z_]\w*))?\s*\(/g;
  let cm;
  while ((cm = callRe.exec(m))) {
    const qual = cm[2] ? cm[1] : null;      // pkg qualifier if `a.b(`
    const name = cm[2] || cm[1];
    if (!candNames.has(name)) continue;
    // skip func declarations
    const before = m.slice(Math.max(0, cm.index - 8), cm.index);
    if (/func\s*$/.test(before)) continue;
    let fn = null;
    if (qual) {
      const vtHit = varTypeAt(qual, cm.index);
      const dirTail = rec.imports.get(qual) || (vtHit && vtHit.dir);
      if (dirTail && vtHit && vtHit.ctorType && funcsByDirRecv.has(`${dirTail}:${vtHit.ctorType}:${name}`)) {
        fn = funcsByDirRecv.get(`${dirTail}:${vtHit.ctorType}:${name}`);
      } else if (dirTail && funcsByDirName.has(`${dirTail}:${name}`)) fn = funcsByDirName.get(`${dirTail}:${name}`);
      if (!fn && funcsByDirName.has(`${qual}:${name}`)) fn = funcsByDirName.get(`${qual}:${name}`);
      if (!fn) {
        // qual may be a receiver var for a method call (ariHandler.RegisterExtranet)
        // or an unaliased package whose import regex missed — last-resort name search
        const cands = funcsByName.get(name) || [];
        if (cands.length === 1) fn = cands[0];
      }
      if (!fn) continue; // qualified call we can't map — don't guess
    } else {
      if (funcsByDirName.has(`${rec.relDir}:${name}`)) fn = funcsByDirName.get(`${rec.relDir}:${name}`);
      else if (funcsByDirName.has(`${rec.dir}:${name}`)) fn = funcsByDirName.get(`${rec.dir}:${name}`);
      else {
        const cands = funcsByName.get(name) || [];
        if (cands.length === 1) fn = cands[0];
        else continue;
      }
    }
    if (!fn || !fn.grpParams.length) { if (process.env.DEBUG_ONE===name) console.log("skip", name, "qual=",qual, "fn?", !!fn, "grpParams=", fn&&fn.grpParams); continue; }
    if (process.env.DEBUG_ONE===name) console.log("CALL", name, "in", rec.rel, "args>");
    if (fn.file === rec) { /* same file */ }
    const parenOpen = m.indexOf("(", cm.index + cm[0].length - 1);
    const parenClose = matchParens(m, parenOpen);
    const args = splitTopLevel(m.slice(parenOpen + 1, parenClose));
    const curFn = fnAt(rec, cm.index);
    // map args to group params in order: count only args that look group-ish
    const resolvedArgs = [];
    for (const arg of args) {
      let p = null;
      const gChain = arg.match(/^([A-Za-z_][\w.()\[\]]*?)\.Group\(\s*"[^"\n]*"/);
      if (gChain) {
        const absStart = parenOpen + 1 + m.slice(parenOpen + 1, parenClose).indexOf(arg);
        const qPos = orig.indexOf('"', absStart + gChain[0].indexOf('.Group('));
        const lit = litAt(orig, qPos);
        const baseP = resolveReceiver(gChain[1], absStart, vars, curFn, orig);
        p = baseP + lit;
      } else if (/^[A-Za-z_]\w*$/.test(arg)) {
        if (vars.has(arg)) p = vars.get(arg);
        else if (curFn && curFn.grpParams.includes(arg)) p = argRef(curFn, arg, "");
        else if (["r", "router", "e", "engine", "srv", "api", "mux", "root"].includes(arg)) p = "";
      } else {
        const helper = arg.match(/^[A-Za-z_]\w*(?:group|Group)\w*\(\s*([A-Za-z_]\w*)\s*,\s*"[^"\n]*"/);
        if (helper) {
          const qIdx = arg.indexOf('"', arg.indexOf(helper[1]));
          const absStart = parenOpen + 1 + m.slice(parenOpen + 1, parenClose).indexOf(arg);
          const lit = litAt(orig, absStart + qIdx);
          let base;
          if (vars.has(helper[1])) base = vars.get(helper[1]);
          else if (["r", "router", "e", "engine"].includes(helper[1])) base = "";
          else if (curFn && curFn.grpParams.includes(helper[1])) base = argRef(curFn, helper[1], "");
          else base = `UNRESOLVED:${helper[1]}`;
          p = base + lit;
        }
      }
      if (process.env.DEBUG_ONE===name) console.log("  arg:", JSON.stringify(arg).slice(0,80), "->", p);
      resolvedArgs.push(p);
    }
    // assign resolved args to group params in order
    let gi = 0;
    const perParam = new Map();
    if (!callSitePrefixes.has(fn)) callSitePrefixes.set(fn, new Map());
    const pmap = callSitePrefixes.get(fn);
    for (const p of resolvedArgs) {
      if (gi >= fn.grpParams.length) break;
      if (p === null) { continue; } // non-group arg: don't consume a param slot? risky.
      // We can't always tell which arg maps to which param. Heuristic: only consume
      // a param slot when we resolved something; skip nulls without consuming only
      // if the NEXT resolved arg still fits. Simple approach: null args DO consume a
      // slot when they're literals/ctx-ish? Safer: null does NOT consume.
      const param = fn.grpParams[gi++];
      if (!pmap.has(param)) pmap.set(param, new Set());
      pmap.get(param).add(p);
      if (process.env.DEBUG_STORE && fn.file.rel.includes(process.env.DEBUG_STORE)) console.log("STORE", fn.file.rel, fn.name, param, "<-", p);
    }
    void perParam;
  }
}

// ── pass 3: expand ARG refs and emit rows ────────────────────────────────────
function expandPrefix(spec, depth = 0) {
  if (depth > 4) return [spec];
  const re = /ARG::([^:]+)::([^:]+)::(\w+)/;
  const match = spec.match(re);
  if (!match) return [spec];
  const [whole, fRel, fName, param] = match;
  // find the func
  const f = parsed.find(r => r.rel === fRel)?.funcs.find(x => x.name === fName);
  let subs = null;
  if (process.env.DEBUG_STORE && fRel.includes(process.env.DEBUG_STORE)) console.log("LOOKUP", fRel, fName, param, "f?", !!f, "has?", f && callSitePrefixes.has(f), "keys?", f && callSitePrefixes.has(f) ? [...callSitePrefixes.get(f).keys()] : null);
  if (f && callSitePrefixes.has(f) && callSitePrefixes.get(f).has(param)) {
    subs = [...callSitePrefixes.get(f).get(param)];
  }
  if (!subs || !subs.length) {
    if (process.env.DEBUG_EXPAND) console.log("EXPAND-FAIL", spec, "| f found:", !!f, "| pmap:", f && callSitePrefixes.has(f) ? [...callSitePrefixes.get(f).keys()] : "none");
    return [spec.replace(whole, `UNRESOLVED_ARG(${fName}:${param})`)];
  }
  const out = [];
  for (const s of subs) {
    for (const e of expandPrefix(spec.replace(whole, s), depth + 1)) out.push(e);
  }
  return out;
}

const seen = new Set();
const rows = [];
let unresolved = 0;
for (const reg of registrations) {
  const prefixes = expandPrefix(reg.prefixSpec);
  for (const p of prefixes) {
    const unresolvedTag = p.includes("UNRESOLVED");
    let full;
    if (unresolvedTag) {
      unresolved++;
      full = reg.rawPath; // record raw path as required
    } else {
      full = (p + reg.rawPath).replace(/\/{2,}/g, "/") || "/";
    }
    const group = unresolvedTag ? p : (p || "(root)");
    const key = `${reg.file}|${reg.method}|${full}|${group}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([reg.file, reg.method, full, group]);
  }
}

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
const csvCell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, "source_file,method,path,route_group\n" + rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n");

console.log(`wrote ${OUT}`);
if (process.env.DEBUG_CALLS) {
  let dbg = 0;
  for (const [fn, pmap] of callSitePrefixes) {
    console.log(`FUNC ${fn.file.rel}:${fn.name} params=[${fn.grpParams}]`);
    for (const [p, set] of pmap) console.log(`   ${p} <- ${[...set].slice(0,6).join(" | ")}`);
    if (++dbg > 60) break;
  }
  console.log(`total funcs with callsite data: ${callSitePrefixes.size}`);
}
console.log(`registrations found: ${registrations.length}, rows emitted: ${rows.length}, unresolved-prefix registrations: ${unresolved}`);
const byFile = {};
for (const r of rows) byFile[r[0]] = (byFile[r[0]] || 0) + 1;
for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${c}\t${f}`);
}
