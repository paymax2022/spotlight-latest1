#!/usr/bin/env node
//
// Guard: every BACKEND module flag in the registry must be set by the staging
// module-flags workflow.
//
// WHY THIS EXISTS
// A module is only visible when its env flag is set AND lifecycle is active AND
// it is published for the environment. The flags default to false/off, so a
// module whose flag is simply absent from the staging workflow is invisible —
// and nothing fails. Every layer reports success. It has now happened twice:
//
//   * 24 -> 29: the list was derived from the backend ROUTE MAP, but the mobile
//     grid gates on a different set (serviceModuleKeys.ts); five keys were in
//     neither, so those tiles silently vanished.
//   * 29 -> 31: the list had the three health VERTICALS but not their PARENT.
//     finance_routes.go mounts the whole health tree under FeatureHealthEnabled,
//     which defaults FALSE — so staging rendered pharmacy/lab/vet tiles while the
//     backend never registered a single health route.
//
// Both were invisible failures. This makes the third one loud.
//
// Only BACKEND-owned flags are required: ownership is derived from
// backend/internal/config/config.go rather than hardcoded, so a flag that moves
// between services does not silently fall out of scope.

import { readFileSync } from 'node:fs';

const REGISTRY = 'supabase/migrations/20261210000000_platform_module_registry.sql';
const WORKFLOW = '.github/workflows/staging-module-flags.yml';
const CONFIG   = 'backend/internal/config/config.go';

// Flags that are in the registry, backend-owned, and deliberately NOT set here.
// Each needs a reason; an unexplained entry is how a gap becomes permanent.
const ALLOWED_ABSENT = new Map([
  ['FEATURE_CHECKOUT_TOPUP_TIER0',
   'ADR-042 risk relaxation (unverified Tier-0 card pay), Accepted but default OFF ' +
   'with Tier-0 caps not signed off by compliance. Must never be bulk-enabled.'],
  ['FEATURE_TIER_LIMITS_ENABLED',
   'getEnvBool default is TRUE — limits are fail-closed without being set, and ' +
   'setting it here would only create a way to turn them off.'],
]);

const registry = readFileSync(REGISTRY, 'utf8');
const workflow = readFileSync(WORKFLOW, 'utf8');
const config   = readFileSync(CONFIG, 'utf8');

// key -> env_flag, from the seed rows.
const modules = [...registry.matchAll(/^ {2}\('([A-Za-z0-9_]+)', '[^']*', '[a-z]+', '([A-Z0-9_]+)'/gm)]
  .map(m => ({ key: m[1], flag: m[2] }));

const setByWorkflow = new Set(
  [...workflow.matchAll(/^\s+([A-Z][A-Z0-9_]+)=true \\$/gm)].map(m => m[1])
);

// Backend-owned == read by the Go config loader.
const backendOwned = f => config.includes(`"${f}"`);

const missing = modules.filter(m =>
  backendOwned(m.flag) && !setByWorkflow.has(m.flag) && !ALLOWED_ABSENT.has(m.flag));

const staleAllow = [...ALLOWED_ABSENT.keys()].filter(
  f => !modules.some(m => m.flag === f));

let bad = false;

if (missing.length) {
  bad = true;
  console.error(`::error::${missing.length} backend module flag(s) in the registry are NOT set by ${WORKFLOW}:`);
  for (const m of missing) console.error(`  ${m.flag}   (module "${m.key}")`);
  console.error('::error::Add them to the `railway variable set` list, or add an ALLOWED_ABSENT entry WITH a reason.');
}

if (staleAllow.length) {
  bad = true;
  console.error(`::error::ALLOWED_ABSENT lists flag(s) that are no longer in the registry — remove them:`);
  for (const f of staleAllow) console.error(`  ${f}`);
}

if (!bad) {
  const n = modules.filter(m => backendOwned(m.flag)).length;
  console.log(`OK: ${n} backend module flag(s) in the registry; ` +
              `${setByWorkflow.size} set by the workflow, ` +
              `${ALLOWED_ABSENT.size} deliberately absent with a stated reason.`);
}
process.exit(bad ? 1 : 0);
