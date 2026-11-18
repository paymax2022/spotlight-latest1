#!/usr/bin/env node
/**
 * check-web-api — preflight for `npm run web` / `npm run start` (Expo on :8083).
 *
 * The mobile app's axios client (src/api/client.ts) points at
 * EXPO_PUBLIC_API_BASE_URL, defaulting to http://localhost:3000 — the
 * frontend-web Next.js server, NOT a URL this app serves itself. That server is
 * a plain `next dev` that dies on its own, and launching Expo by hand (rather
 * than through `make dev`) never starts it, so every request can fail with no
 * HTTP response at all. errorMapper.ts reports that as "No internet connection",
 * which sends whoever's debugging it looking at their network instead of at a
 * stopped dev server.
 *
 * So when the base URL IS that local gateway and nothing answers it, this hook
 * starts frontend-web detached and waits for it instead of only telling the
 * developer to go start it themselves.
 *
 * It asks scripts/dev/web-server-state.mjs first and hands the starting to
 * scripts/dev/web-supervisor.sh, for the reason the supervisor documents: Next 16
 * refuses a second dev server per checkout (.next/dev/lock), so an unanswered
 * :3000 is not proof that starting one is safe. Spawning a bare `next dev` here
 * is how an orphan on :3002 got born on 2026-11-12, and that orphan then blocked
 * every server the app could actually reach.
 *
 * Still non-blocking: every path exits 0. It can't tell a genuinely offline
 * machine apart from a merely-not-started server, and gating `npm run web` on it
 * would make the mobile app impossible to load standalone (e.g. against a
 * deployed staging API). A base URL that is not the local :3000 gateway is never
 * auto-started, so pointing the app at staging can't grow a stray local server.
 *
 * Usage: node scripts/check-web-api.mjs   (wired as `prestart`/`preweb`)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devServerState } from '../../../scripts/dev/web-server-state.mjs';

const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';

// <repo>/mobile-app/reactnative/scripts -> <repo>/frontend-web, so this follows
// the checkout a worktree is actually running from.
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendWebDir = path.resolve(here, '../../../frontend-web');
const supervisor = path.resolve(here, '../../../scripts/dev/web-supervisor.sh');
const logPath = path.join(frontendWebDir, 'dev-server.log');

const POLL_MS = 500;
const SOFT_NOTE_MS = 5_000; // first Turbopack compile of the entry can exceed this
const MAX_WAIT_MS = 45_000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reachable(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    await fetch(url, { method: 'GET', signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

/** The gateway port when `url` is the loopback :3000 dev gateway, otherwise null. */
function localGatewayPort(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || /^127\./.test(host) || host === '::1';
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  return loopback && port === 3000 ? port : null;
}

/** Polls until `url` answers, nudging once after SOFT_NOTE_MS. */
async function waitForReachable(url, timeoutMs) {
  const startedAt = Date.now();
  let noted = false;
  while (Date.now() - startedAt < timeoutMs) {
    await wait(POLL_MS);
    if (await reachable(url)) return true;
    if (!noted && Date.now() - startedAt > SOFT_NOTE_MS) {
      noted = true;
      console.log('check-web-api: still waiting — a first compile can take a minute.');
    }
  }
  return false;
}

function warnNotReachable() {
  console.warn('');
  console.warn('⚠️  check-web-api: ' + apiBase + ' is not reachable.');
  console.warn('    This app calls it for login/auth and other server-side routes');
  console.warn('    (see src/api/client.ts). If it stays down, the web app will show');
  console.warn('    "No internet connection" on every request — that is this, not your network.');
  console.warn('');
}

const gatewayPort = localGatewayPort(apiBase);

if (await reachable(apiBase)) process.exit(0);

if (gatewayPort === null) {
  warnNotReachable();
  console.warn('    That is not the local frontend-web gateway (:3000), so nothing was');
  console.warn('    started. Check the URL and that the target is up.');
  console.warn('');
  process.exit(0);
}

// No answer on :3000 is only half the question. A live .next/dev/lock means a dev
// server already owns this checkout, and a second one lands on its own port where
// the app can never find it.
const state = await devServerState({ webDir: frontendWebDir, port: gatewayPort });
if (state.claimed) {
  console.log('check-web-api: ' + state.detail);
  if (state.reason === 'lock') {
    console.warn('');
    console.warn('    That server is not the URL this app uses, so its requests still fail.');
    console.warn('    Free the checkout instead of stacking a second server on it:');
    console.warn('      kill ' + state.lock.pid + '   # then re-run `make dev` or `npm run web`');
    console.warn('    Leaving it up and pointing EXPO_PUBLIC_API_BASE_URL at it does not work');
    console.warn('    today — the app is pinned to :3000 — so stopping it is usually right.');
    console.warn('');
    process.exit(0);
  }
  // Something holds the gateway port but has not served the entry route yet; let it come up.
  if (await waitForReachable(apiBase, MAX_WAIT_MS)) {
    console.log('check-web-api: ' + apiBase + ' is up.');
  } else {
    warnNotReachable();
  }
  process.exit(0);
}

if (!fs.existsSync(path.join(frontendWebDir, 'node_modules/.bin/next'))) {
  warnNotReachable();
  console.warn('    frontend-web has no node_modules, so it cannot be started here.');
  console.warn('');
  console.warn('    Fix: cd ' + frontendWebDir + ' && npm install && npm run dev');
  console.warn('    (first time in a fresh checkout/worktree, also copy .env.local from');
  console.warn('    an existing checkout — it is gitignored and not created automatically).');
  console.warn('');
  process.exit(0);
}

console.log('check-web-api: ' + apiBase + ' is down — starting the frontend-web supervisor (log: ' + logPath + ')');

let pid;
try {
  const fd = fs.openSync(logPath, 'a');
  // The supervisor rather than `npm run dev`: it re-checks the checkout lock before
  // every start and brings the server back when it dies, so a hand-started Expo
  // session is supervised the way `make dev` supervises one.
  const child = spawn(supervisor, [], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, WEB_DIR: frontendWebDir, WEB_PORT: String(gatewayPort) },
  });
  pid = child.pid;
  child.unref();
  fs.closeSync(fd);
} catch (err) {
  console.warn('check-web-api: could not start frontend-web (' + err.message + ').');
}

if (pid && (await waitForReachable(apiBase, MAX_WAIT_MS))) {
  console.log('check-web-api: frontend-web is up on :3000 (supervisor pid ' + pid + ').');
  process.exit(0);
}

warnNotReachable();
console.warn('    Started it and it never answered: supervisor pid ' + (pid ?? 'unknown') + ', log ' + logPath);
console.warn('    (first time in a fresh checkout/worktree, frontend-web needs');
console.warn('    `npm install` and a gitignored .env.local copied from an existing checkout.)');
console.warn('');
process.exit(0);
