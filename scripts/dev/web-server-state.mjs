#!/usr/bin/env node
/**
 * web-server-state — one answer to "does something already own this frontend-web
 * dev server?", for both the `make dev` supervisor and the Expo preflight hook.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * The two callers are written in different languages (bash and node) and had
 * drifted: each decided "is :3000 taken?" by probing :3000. That is not the
 * question Next 16 asks. Next refuses a second dev server per CHECKOUT, keyed by
 * frontend-web/.next/dev/lock — `{"pid":…,"port":…,"appUrl":…}` — so a leftover
 * server that slid to :3002 blocks a new one while :3000 is genuinely free. On
 * 2026-11-12 the supervisor restarted into "Another next dev server is already
 * running" three times and then told the developer their checkout was broken and
 * needed `npm install`. It was not broken; the port probe simply could not see
 * the thing that was holding the checkout.
 *
 * A lock is only meaningful while its pid lives, and Next cleans the file up on a
 * clean exit, so a dead pid is stale state and must NOT block a start. A live pid
 * that is no longer a node process is a recycled pid, treated the same way.
 *
 * Usage:
 *   node scripts/dev/web-server-state.mjs [--web-dir DIR] [--port N]
 * Exit:  0 = claimed (do not start another), 1 = free, 2 = probe itself failed.
 * stdout is one human-readable line; callers quote it rather than re-deriving it.
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ATTEMPTS = 2;
const CONNECT_TIMEOUT_MS = 2500;
const RETRY_GAP_MS = 1000;

export function parseArgs(argv) {
  const opts = { webDir: null, port: 3000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--web-dir') opts.webDir = argv[++i];
    else if (argv[i] === '--port') opts.port = Number(argv[i + 1]);
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0 || opts.port > 65535) {
    throw new Error(`invalid --port ${opts.port}`);
  }
  return opts;
}

/** Next's own per-checkout record of which dev server won. Null when absent/unreadable. */
export function readDevLock(webDir) {
  const lockPath = path.join(webDir, '.next', 'dev', 'lock');
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid !== 'number') return null;
    return { ...parsed, lockPath };
  } catch {
    // Half-written file: Next will replace it, so treat it as absent.
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true; // EPERM (another user's pid) still counts as alive
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Guards against a recycled pid: the lock only means something if that pid is still a node process. */
function pidIsNode(pid) {
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
  if (r.status !== 0) return null; // cannot tell
  const comm = (r.stdout || '').trim().toLowerCase();
  if (!comm) return null;
  return comm.includes('node') || comm.includes('next');
}

function connectOnce(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (result) => {
      sock.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => done('timeout'), CONNECT_TIMEOUT_MS);
    sock.once('connect', () => {
      clearTimeout(timer);
      done('connected');
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      done(err.code === 'ECONNREFUSED' || err.code === 'EADDRNOTAVAIL' ? 'refused' : 'error:' + err.code);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Only a refused connection proves the port is unclaimed. A slow or refused-then-
 * retried answer is Next mid-compile holding the port, and reading that as "free"
 * is how a duplicate gets born.
 */
export async function probePort(port) {
  let last = 'refused';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    last = await connectOnce(port);
    if (last !== 'refused') break;
    if (attempt < ATTEMPTS) await sleep(RETRY_GAP_MS);
  }
  return last;
}

/**
 * @returns {{claimed: boolean, reason: string, detail: string, port: number, lock?: object}}
 * `reason` is 'lock' | 'stale-lock' | 'port' | 'free' | 'probe-error'.
 */
export async function devServerState({ webDir, port }) {
  const lock = readDevLock(webDir);
  if (lock) {
    const alive = pidAlive(lock.pid);
    const isNode = alive ? pidIsNode(lock.pid) : false;
    if (alive && isNode !== false) {
      const where = lock.appUrl || `http://localhost:${lock.port}`;
      return {
        claimed: true,
        reason: 'lock',
        port,
        lock,
        detail: `claimed: next dev already owns this checkout — pid ${lock.pid} on ${where} (lock ${lock.lockPath})`,
      };
    }
    // Stale or recycled: fall through to the port, Next clears this file itself.
    const why = alive ? `pid ${lock.pid} is alive but is not node (recycled pid)` : `pid ${lock.pid} is gone`;
    const portResult = await probePort(port);
    if (portResult === 'refused') {
      return {
        claimed: false,
        reason: 'free',
        port,
        lock,
        detail: `stale: dev lock left behind, ${why} — and :${port} refused — free to start`,
      };
    }
    return portVerdict(port, portResult, ` (${why})`);
  }

  const portResult = await probePort(port);
  if (portResult === 'refused') {
    return { claimed: false, reason: 'free', port, detail: `free: no dev lock for ${webDir} and :${port} refused` };
  }
  return portVerdict(port, portResult, '');
}

function portVerdict(port, portResult, note) {
  if (portResult === 'connected') {
    return { claimed: true, reason: 'port', port, detail: `claimed: :${port} answers — a dev server is already on it${note}` };
  }
  // Anything else (timeout, socket error, ps unreadable) is not evidence of a free port.
  return {
    claimed: true,
    reason: 'probe-error',
    port,
    detail: `claimed: could not prove :${port} is free (${portResult}${note}) — not starting a duplicate`,
  };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error('web-server-state: ' + err.message);
    process.exit(2);
  }
  const webDir = opts.webDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend-web');
  const state = await devServerState({ webDir, port: opts.port });
  console.log(state.detail);
  if (state.reason === 'probe-error') process.exit(2);
  process.exit(state.claimed ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
