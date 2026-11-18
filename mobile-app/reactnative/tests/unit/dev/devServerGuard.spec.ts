// Pins the guard that stopped `make dev` from stacking duplicate frontend-web
// servers on 2026-11-12. Next 16 refuses a second dev server per CHECKOUT, not
// per port: .next/dev/lock names the live pid and the port it actually took, so
// an orphaned server on :3002 blocks a new one even while :3000 is free. The
// supervisor probed :3000 only, so it restarted into "Another next dev server is
// already running" three times and then blamed a checkout that was fine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const STATE_CLI = path.join(REPO, 'scripts', 'dev', 'web-server-state.mjs');
const SUPERVISOR = path.join(REPO, 'scripts', 'dev', 'web-supervisor.sh');
const PREFLIGHT = path.join(REPO, 'mobile-app', 'reactnative', 'scripts', 'check-web-api.mjs');

const FREE_PORT = 3998; // nothing listens here on a dev laptop or in CI

function mkWebDir(devScript: string, lock?: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-guard-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'fake-frontend-web',
    private: true,
    scripts: { dev: devScript },
  }));
  fs.mkdirSync(path.join(dir, '.next', 'dev'), { recursive: true });
  if (lock !== undefined) {
    fs.writeFileSync(path.join(dir, '.next', 'dev', 'lock'), JSON.stringify(lock));
  }
  return dir;
}

function probe(webDir: string, port = FREE_PORT) {
  const r = spawnSync(process.execPath, [STATE_CLI, '--web-dir', webDir, '--port', String(port)], {
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function runSupervisor(webDir: string) {
  const r = spawnSync('bash', [SUPERVISOR], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      WEB_DIR: webDir,
      WEB_PORT: String(FREE_PORT),
      RETRY_DELAY: '0',
      FAST_FAILURE_SECONDS: '30',
      MAX_FAST_FAILURES: '2',
    },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A pid that is guaranteed gone: spawnSync reaps the child before returning. */
function deadPid() {
  return spawnSync('sleep', ['0']).pid as number;
}

test('the shared state CLI exists — one probe, not one per language', () => {
  assert.ok(fs.existsSync(STATE_CLI), 'scripts/dev/web-server-state.mjs must be the single source of this answer');
  const supervisor = fs.readFileSync(SUPERVISOR, 'utf8');
  const preflight = fs.readFileSync(PREFLIGHT, 'utf8');
  assert.match(supervisor, /web-server-state\.mjs/, 'supervisor must ask the shared CLI');
  assert.match(preflight, /web-server-state\.mjs/, 'the Expo preflight must ask the shared CLI');
  // The old hand-rolled curl probe is what drifted from Next's own rule.
  assert.doesNotMatch(supervisor, /curl -s -o/);
});

test('no live lock and nothing listening reads as free', () => {
  const dir = mkWebDir('node -e 0');
  try {
    const { status, out } = probe(dir);
    assert.equal(status, 1, `expected exit 1 (free), got ${status}: ${out}`);
    assert.match(out, /free/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stale lock left by a dead server does not block a start', () => {
  const dir = mkWebDir('node -e 0', {
    pid: deadPid(),
    port: 3000,
    hostname: 'localhost',
    appUrl: 'http://localhost:3000',
    startedAt: Date.now(),
  });
  try {
    const { status, out } = probe(dir);
    assert.equal(status, 1, 'a lock whose pid is gone is leftover state, not a running server');
    assert.match(out, /stale/i, `it must say why an old lock is being ignored: ${out}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a live lock owns the checkout even while :3000 is free — the 2026-11-12 incident', () => {
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  const dir = mkWebDir('node -e 0');
  try {
    fs.writeFileSync(path.join(dir, '.next', 'dev', 'lock'), JSON.stringify({
      pid: holder.pid,
      port: 3002,
      hostname: 'localhost',
      appUrl: 'http://localhost:3002',
      startedAt: Date.now(),
    }));
    const { status, out } = probe(dir);
    assert.equal(status, 0, `a live lock pid must read as claimed: ${out}`);
    // The answer has to name who owns it and where, or the advice is unusable.
    assert.match(out, new RegExp(String(holder.pid)));
    assert.match(out, /3002/);
  } finally {
    holder.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a port that answers counts as claimed without a lock file', async () => {
  const server = net.createServer((sock) => sock.end('HTTP/1.1 200 OK\r\n\r\n'));
  const dir = mkWebDir('node -e 0');
  try {
    // listen() is async: address() is null until the 'listening' callback fires.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    const { status, out } = probe(dir, port);
    assert.equal(status, 0, `a listening port must read as claimed: ${out}`);
    assert.match(out, /answers/i);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the supervisor stands down when another dev server owns the checkout', () => {
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  const dir = mkWebDir('node -e \'console.log("SHOULD NOT RUN")\'', {
    pid: holder.pid,
    port: 3002,
    hostname: 'localhost',
    appUrl: 'http://localhost:3002',
    startedAt: Date.now(),
  });
  try {
    const { status, out } = runSupervisor(dir);
    assert.equal(status, 0, `standing down for another server is not a failure, got ${status}: ${out}`);
    assert.doesNotMatch(out, /SHOULD NOT RUN/, 'it must not start a duplicate at all');
    assert.match(out, /already|another/i, `it must say why it did not start: ${out}`);
    assert.match(out, /3002/, 'it must name the port the other server is actually on');
  } finally {
    holder.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a crash loop still restarts and bails, but the bail names both causes', () => {
  const dir = mkWebDir('node -e \'console.error("TypeError: read ECONNRESET"); process.exit(1)\'');
  const { status, out } = runSupervisor(dir);
  assert.match(out, /restarting/, 'a plain crash must still be retried');
  assert.match(out, /giving up/, 'and must still stop after enough fast failures');
  // The old text asserted "broken checkout, not a crash" — which was wrong the
  // first time it fired. A bail is a guess between two causes, so say both.
  assert.match(out, /lock|duplicate|another dev/i, `bail must mention the duplicate-server cause: ${out}`);
  assert.match(out, /npm install/, 'and still mention the broken-checkout cause');
  assert.equal(status, 1, `bailing is an error, got ${status}: ${out}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
