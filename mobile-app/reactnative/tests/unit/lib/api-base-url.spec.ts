// AUD-FE-001: release builds shipped without EXPO_PUBLIC_API_BASE_URL and
// silently pointed every API client at the device's own loopback. The resolver
// must warn loudly in non-dev builds while keeping the dev fallback quiet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBaseUrl } from '@/lib/apiBaseUrl';

const ENV_KEY = 'EXPO_PUBLIC_API_BASE_URL';

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of [ENV_KEY, 'NODE_ENV']) {
    saved[k] = process.env[k];
    if (k in vars) {
      if (vars[k] === undefined) delete process.env[k];
      else process.env[k] = vars[k];
    }
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function captureConsoleError(fn: () => void): string[] {
  const calls: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { calls.push(args.join(' ')); };
  try { fn(); } finally { console.error = orig; }
  return calls;
}

test('returns the configured URL when EXPO_PUBLIC_API_BASE_URL is set', () => {
  withEnv({ [ENV_KEY]: 'https://api.example.com' }, () => {
    assert.equal(resolveApiBaseUrl(), 'https://api.example.com');
  });
});

test('dev build falls back quietly', () => {
  withEnv({ [ENV_KEY]: undefined, NODE_ENV: 'development' }, () => {
    const errors = captureConsoleError(() => {
      assert.equal(resolveApiBaseUrl(), 'http://localhost:3000');
      assert.equal(resolveApiBaseUrl('http://localhost:8091'), 'http://localhost:8091');
    });
    assert.deepEqual(errors, []);
  });
});

test('production build with no env var logs loudly and still returns the fallback', () => {
  withEnv({ [ENV_KEY]: undefined, NODE_ENV: 'production' }, () => {
    let result = '';
    const errors = captureConsoleError(() => {
      result = resolveApiBaseUrl();
    });
    assert.equal(result, 'http://localhost:3000');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /EXPO_PUBLIC_API_BASE_URL/);
  });
});
