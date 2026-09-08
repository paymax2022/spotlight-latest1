/**
 * Middleware placement contract.
 *
 * Next.js only loads `middleware.ts` from the directory that holds the routes it
 * is serving. This app has BOTH a root `app/` and a `src/app/`; when both exist
 * Next serves the root one and ignores `src/app`. The implementation lives at
 * `src/middleware.ts`, so for a long time Next was not looking where the file
 * was, and the middleware simply never ran.
 *
 * Nothing errors when that happens — which is what makes it worth a test. The
 * two jobs it silently stopped doing were:
 *
 *   • CORS for /api/* — preflights fell through to Next's automatic OPTIONS
 *     handler, which answers 204 with no Access-Control-Allow-Origin, so every
 *     cross-origin call from the Expo web build failed with net::ERR_FAILED.
 *   • The Supabase session-cookie refresh, and with it the auth redirects for
 *     every PROTECTED_PATTERNS route.
 *
 * This asserts an entry point exists where Next actually reads it, and that it
 * re-exports both symbols Next needs. It deliberately derives the expected
 * location from which app directory is live, so consolidating on `src/app`
 * later makes the test tell you to move the middleware rather than go stale.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_ROOT = join(__dirname, '..', '..', '..');

/** Where Next resolves routes from — root `app/` wins when both are present. */
function liveAppDir(): string {
  return existsSync(join(APP_ROOT, 'app')) ? APP_ROOT : join(APP_ROOT, 'src');
}

/** The middleware entry point Next will actually load, if any. */
function entryPoint(dir: string): string | null {
  for (const ext of ['ts', 'js', 'tsx', 'mjs']) {
    const candidate = join(dir, `middleware.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

describe('middleware placement', () => {
  it('has an entry point in the directory Next serves routes from', () => {
    const dir = liveAppDir();
    const found = entryPoint(dir);

    expect(
      found,
      `No middleware entry point beside the live app directory (${dir}). ` +
        'Next will not load middleware from anywhere else, so CORS for /api/* ' +
        'and the Supabase session refresh will silently stop running.',
    ).not.toBeNull();
  });

  it('exports both symbols Next requires', () => {
    const found = entryPoint(liveAppDir());
    const source = readFileSync(found as string, 'utf8');

    // A `config` that does not reach Next means the matcher is lost and the
    // middleware runs on every request — including static assets.
    expect(source).toMatch(/\bmiddleware\b/);
    expect(source).toMatch(/\bconfig\b/);
  });

  it('keeps the implementation reachable from the entry point', () => {
    // Guards the re-export specifically: an entry point that exists but points
    // at nothing would pass the checks above while still loading no rules.
    const found = entryPoint(liveAppDir()) as string;
    const source = readFileSync(found, 'utf8');
    const isReExport = /from\s+['"](.+)['"]/.exec(source);

    if (isReExport) {
      const target = isReExport[1].replace(/^\.\//, '');
      const resolved = join(APP_ROOT, `${target}.ts`);
      expect(
        existsSync(resolved),
        `Entry point re-exports from '${isReExport[1]}', which does not exist.`,
      ).toBe(true);
    }
  });
});
