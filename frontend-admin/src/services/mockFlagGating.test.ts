// @vitest-environment node
/**
 * Admin services must not FAIL OPEN into fixtures in production.
 *
 * THE DEFECT. 48 admin services resolved their mock flag as
 *
 *     const USE_MOCK = (process.env.NEXT_PUBLIC_X_USE_MOCK ?? 'true').toLowerCase() !== 'false';
 *
 * which never consults NODE_ENV. A production build with the variable unset —
 * the default state for ~34 of them — served fabricated data to operators, on a
 * console where /admin/creators/dashboard reports ₦603,400,000 of earnings that
 * exist only as literals in the service file.
 *
 * They now route through resolveUseMock, which keeps the convenient default in
 * development and flips it to LIVE in production. A module that genuinely has no
 * backend must opt in by setting its flag to 'true' and appearing on the
 * allowlist in scripts/check-mock-flags.mjs, where it is visible and burned down.
 *
 * These tests exist because the fail-open one-liner is easy to reintroduce by
 * copying any neighbouring service — which is precisely how it reached 48 files.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUseMock } from '@/config/useMock';

const SERVICES = join(process.cwd(), 'src/services');

describe('resolveUseMock', () => {
  // vi.stubEnv, not Object.defineProperty: Node refuses to redefine properties on
  // process.env, and vitest restores the original value for us.
  afterEach(() => { vi.unstubAllEnvs(); });

  const withNodeEnv = (v: string) => vi.stubEnv('NODE_ENV', v);

  it('an explicit flag wins in every environment', () => {
    withNodeEnv('production');
    expect(resolveUseMock('true')).toBe(true);
    expect(resolveUseMock('false')).toBe(false);
    withNodeEnv('development');
    expect(resolveUseMock('true')).toBe(true);
    expect(resolveUseMock('false')).toBe(false);
  });

  it('tolerates casing and padding, which env files collect', () => {
    withNodeEnv('production');
    expect(resolveUseMock('  FALSE ')).toBe(false);
    expect(resolveUseMock(' True')).toBe(true);
  });

  // The whole point: unset must NOT mean fixtures in production.
  it('defaults to LIVE in production when unset', () => {
    withNodeEnv('production');
    expect(resolveUseMock(undefined)).toBe(false);
    expect(resolveUseMock('')).toBe(false);
    expect(resolveUseMock(null)).toBe(false);
  });

  it('still defaults to MOCK in development, so local work needs no backends', () => {
    withNodeEnv('development');
    expect(resolveUseMock(undefined)).toBe(true);
  });
});

describe('no admin service reintroduces the fail-open gate', () => {
  const files = readdirSync(SERVICES).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('finds services to check (guards against an empty-glob false pass)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('no service resolves its mock flag without consulting NODE_ENV', () => {
    // Matches the exact fail-open shape, single- or multi-line, under any flag
    // name (one service calls it USE_FIXTURES).
    const failOpen = /const\s+USE_(?:MOCK|FIXTURES)\s*=\s*\(\s*process\.env\.[A-Z0-9_]+\s*\?\?\s*'true'\s*\)/;
    const offenders = files.filter((f) => failOpen.test(readFileSync(join(SERVICES, f), 'utf8')));
    expect(offenders, `use resolveUseMock(process.env.X) instead: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every service that gates on a flag imports the shared resolver', () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(join(SERVICES, f), 'utf8');
      if (!/const\s+USE_(?:MOCK|FIXTURES)\s*=/.test(src)) return false;
      // A service may legitimately default LIVE with an explicit `?? 'false'`
      // opt-in check; that shape is fail-closed already and needs no resolver.
      if (/\?\?\s*'false'\s*\)\s*\.toLowerCase\(\)\s*===\s*'true'/.test(src)) return false;
      return !src.includes("from '@/config/useMock'");
    });
    expect(offenders, `these gate on a flag but bypass resolveUseMock: ${offenders.join(', ')}`).toEqual([]);
  });
});
