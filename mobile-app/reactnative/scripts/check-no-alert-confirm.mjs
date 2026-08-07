#!/usr/bin/env node
/**
 * check-no-alert-confirm — web-safety guard for confirmation dialogs.
 *
 * React Native's `Alert.alert` is a SILENT NO-OP on react-native-web: no dialog
 * renders and button `onPress` handlers never fire. So any *multi-button
 * confirmation* built with raw `Alert.alert` (cast vote, log out, delete
 * account…) silently blocks its action on the web build used for preview/QA.
 *
 * Use `confirmAsync` / `alertAsync` from `src/lib/confirm.ts` instead — they work
 * on both native (Alert.alert) and web (in-app modal). See that file for usage.
 *
 * This guard fails when a raw `Alert.alert(...)` with a button array (contains
 * `style: 'cancel'`, `style: 'destructive'`, or an `onPress`) is found. Plain
 * single-message `Alert.alert(title, message)` calls are NOT flagged here (they
 * render nothing on web but at least don't block an action) — migrate them to
 * `alertAsync` opportunistically.
 *
 * Usage:  node scripts/check-no-alert-confirm.mjs
 * Exit 0 = no raw confirmation alerts; exit 1 = one or more found.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'src'];
// Paths intentionally excluded from the gate:
//  - crowdfunding: its Alert.alert usage is being migrated on a separate branch.
//  - lib/confirm.ts: the helper itself references the words in its own comments.
//  - marketplace/sell.tsx: a 3-option chooser ("Via Paymax escrow" / "Sold
//    elsewhere" / "Cancel") that confirmAsync can't express without dropping the
//    abort path. TODO: migrate once a multi-choice chooser exists in confirm.ts.
const EXCLUDE = [
  join('app', 'crowdfunding'),
  join('src', 'lib', 'confirm.ts'),
  join('app', 'marketplace', 'sell.tsx'),
];

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (EXCLUDE.some((ex) => p === ex || p.startsWith(ex + '/'))) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
}

/** Extract the balanced `Alert.alert( ... )` call text starting at `from`. */
function extractCall(src, from) {
  let depth = 0;
  let i = from;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return src.slice(from);
}

const files = [];
for (const root of ROOTS) {
  try { walk(root, files); } catch { /* root may not exist in some checkouts */ }
}

const offenders = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const re = /Alert\.alert\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const openParen = src.indexOf('(', m.index);
    const call = extractCall(src, openParen);
    const isConfirm = call.includes("style: 'cancel'") || call.includes('style: "cancel"')
      || call.includes("style: 'destructive'") || call.includes('style: "destructive"')
      || /onPress\s*:/.test(call);
    if (isConfirm) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${file}:${line}`);
    }
  }
}

if (offenders.length) {
  console.error(`✗ check-no-alert-confirm — ${offenders.length} raw Alert.alert confirmation(s) found.`);
  console.error('  Alert.alert is a no-op on web; use confirmAsync/alertAsync from src/lib/confirm.ts instead.');
  for (const o of offenders) console.error('   - ' + o);
  process.exit(1);
}

console.log('✓ check-no-alert-confirm — no raw Alert.alert confirmation dialogs found.');
