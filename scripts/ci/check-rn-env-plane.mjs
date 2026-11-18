#!/usr/bin/env node
/**
 * check-rn-env-plane — regression test for mobile-app/reactnative's plane interlock.
 *
 * Lives here, in scripts/ci, rather than beside the RN app's own specs because it is
 * the one guard in this pair that CI can actually run: the RN suites need
 * `--experimental-strip-types` (Node 22+; CI pins Node 20) and no RN unit spec runs
 * in CI at all. Plain .mjs + the preinstalled node is the difference between an
 * enforced guard and one that rots until the next store build.
 *
 * RN-PLANE-001: `.env.production` is gitignored, and build-aab.sh / build-apk.sh run
 * local Gradle — so eas.json's `production` profile never applies to a store build,
 * Expo selects the env file purely by NODE_ENV, and the artifact is stamped
 * app-release-production whatever it holds. The on-disk file carried the staging API
 * host, the staging Supabase project and EXPO_PUBLIC_APP_ENV=staging (which re-enables
 * the on-device server switch, src/lib/serverProfile.ts), so the production module
 * registry — the admin readiness portal — governed nothing a store user would see.
 * scripts/check-env-plane.mjs is the interlock; this proves it bites.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RN = join(REPO_ROOT, 'mobile-app/reactnative');
const GUARD = join(RN, 'scripts/check-env-plane.mjs');

const PROD_API = 'https://frontend-web-production-9259.up.railway.app';
const PROD_SB = 'https://nmseefdlliejmdbxytej.supabase.co';
const STAGING_API = 'https://frontend-web-staging-new.up.railway.app';
const STAGING_SB = 'https://wnicsubiznmishkmunsv.supabase.co';

// A reference of our own, so the fixtures assert against known values instead of
// coupling every case to whatever the repo's eas.json says today.
const dir = mkdtempSync(join(tmpdir(), 'rn-plane-'));
const easPath = join(dir, 'eas.json');
writeFileSync(easPath, JSON.stringify({
  build: {
    production: {
      env: {
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_BASE_URL: PROD_API,
        EXPO_PUBLIC_SUPABASE_URL: PROD_SB,
      },
    },
    bare: { env: { SENTRY_DISABLE_AUTO_UPLOAD: 'true' } },
  },
}));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Run the guard over an env file written from `lines`. */
function run(name, lines, eas = easPath) {
  const file = join(dir, name);
  writeFileSync(file, lines.join('\n') + '\n');
  const r = spawnSync(process.execPath, [GUARD, file, '--eas', eas], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const agreeing = [
  `EXPO_PUBLIC_API_BASE_URL=${PROD_API}`,
  `EXPO_PUBLIC_SUPABASE_URL=${PROD_SB}`,
  'EXPO_PUBLIC_APP_ENV=production',
];

test('the guard exists and an agreeing file passes', () => {
  const { code, out } = run('.env.production', agreeing);
  assert.equal(code, 0, out);
  assert.match(out, /3\/3 markers/);
});

test('the real defect — staging values in .env.production — fails on all three markers', () => {
  const { code, out } = run('.env.production', [
    `EXPO_PUBLIC_API_BASE_URL=${STAGING_API}`,
    `EXPO_PUBLIC_SUPABASE_URL=${STAGING_SB}`,
    'EXPO_PUBLIC_APP_ENV=staging',
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /EXPO_PUBLIC_API_BASE_URL → frontend-web-staging-new\.up\.railway\.app/s);
  assert.match(out, /EXPO_PUBLIC_SUPABASE_URL → wnicsubiznmishkmunsv\.supabase\.co/s);
  assert.match(out, /EXPO_PUBLIC_APP_ENV → "staging"/);
  // The consequence, not just the mismatch: this line is what tells an operator why
  // a build named production must not say staging.
  assert.match(out, /server switch/);
});

test('APP_ENV alone is enough to fail, and matching is exact rather than prefix-based', () => {
  const { code, out } = run('.env.production', [agreeing[0], agreeing[1], 'EXPO_PUBLIC_APP_ENV=prd']);
  assert.equal(code, 1, out);
  assert.match(out, /EXPO_PUBLIC_APP_ENV → "prd"/);
  assert.doesNotMatch(out, /EXPO_PUBLIC_API_BASE_URL/);
});

test('a marker the profile sets but the file omits fails closed', () => {
  const { code, out } = run('.env.production', [agreeing[0], agreeing[2]]);
  assert.equal(code, 1, out);
  assert.match(out, /EXPO_PUBLIC_SUPABASE_URL is MISSING/);
});

test('a trailing slash or padding is not a plane change', () => {
  const { code, out } = run('.env.production', [
    `${agreeing[0]}/ `,
    ` ${agreeing[1]}`,
    agreeing[2],
  ]);
  assert.equal(code, 0, out);
});

test('a commented-out marker is not read as a value', () => {
  const { code, out } = run('.env.production', ['# EXPO_PUBLIC_API_BASE_URL=https://elsewhere.example.com', ...agreeing]);
  assert.equal(code, 0, out);
});

test('an unknown profile is skipped aloud, never as a silent pass', () => {
  const { code, out } = run('.env.review', ['EXPO_PUBLIC_API_BASE_URL=https://whatever.example.com']);
  assert.equal(code, 0, out);
  assert.match(out, /no "review" profile/);
});

test('a profile declaring no markers is skipped aloud', () => {
  const { code, out } = run('.env.bare', agreeing);
  assert.equal(code, 0, out);
  assert.match(out, /declares none of the plane markers/);
});

test('an unreadable env file fails rather than passing', () => {
  const r = spawnSync(process.execPath, [GUARD, join(dir, '.env.missing'), '--eas', easPath], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match((r.stdout ?? '') + (r.stderr ?? ''), /cannot read env file/);
});

test('both build paths call the guard before any Gradle work', () => {
  // The interlock only exists if it runs on the path that produces store artifacts.
  for (const script of ['build-aab.sh', 'build-apk.sh']) {
    const text = readFileSync(join(RN, script), 'utf8');
    const at = text.indexOf('check-env-plane.mjs');
    assert.ok(at > 0, `${script} does not call check-env-plane.mjs`);
    const gradle = text.indexOf('gradlew');
    assert.ok(gradle > at, `${script} runs Gradle before the plane check`);
  }
});

test('the production template agrees with the tracked production profile', () => {
  // The trap is a file that looks filled in but names the wrong plane, so the copy
  // step must not reintroduce it by default. Values, not the guard, are compared
  // here: the guard derives its profile from the filename, and this file is
  // `.env.production.example`.
  const values = {};
  for (const line of readFileSync(join(RN, '.env.production.example'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !/^\s*#/.test(line)) values[m[1]] = m[2];
  }
  const profile = JSON.parse(readFileSync(join(RN, 'eas.json'), 'utf8')).build.production.env;
  for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_APP_ENV']) {
    assert.equal(values[key], profile[key], `.env.production.example ${key} drifted from eas.json's production profile`);
  }
});

test('eas.json still states the whole production plane', () => {
  // The guard compares against whatever the profile declares; if those three markers
  // ever leave it, the comparison silently narrows to nothing and passes.
  const profile = JSON.parse(readFileSync(join(RN, 'eas.json'), 'utf8')).build.production.env;
  for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_APP_ENV']) {
    assert.ok(String(profile[key] ?? '').trim(), `eas.json's production profile no longer sets ${key} — check-env-plane would compare nothing`);
  }
});
