#!/usr/bin/env node
/**
 * check-web-api — preflight for `npm run web` (Expo web on :8083 by default).
 *
 * The mobile app's axios client (src/api/client.ts) points at
 * EXPO_PUBLIC_API_BASE_URL, defaulting to http://localhost:3000 — the
 * frontend-web Next.js server, NOT a URL this app serves itself. If that
 * server isn't running (e.g. a fresh `git worktree add` never had its
 * `npm install` / `.env.local` bootstrapped, or it just isn't started yet),
 * every request fails with no HTTP response at all, and errorMapper.ts
 * reports that as "No internet connection" — which sends whoever's
 * debugging it looking at their network instead of at a stopped dev server.
 *
 * This is a non-blocking warning, not a gate: it can't tell a genuinely
 * offline machine apart from a merely-not-started server, and blocking
 * `npm run web` on it would make the mobile app impossible to load standalone
 * (e.g. against a deployed staging API). It just makes the common local-dev
 * case diagnosable in the terminal that started Expo, before anyone opens a
 * browser tab and sees the generic message.
 *
 * Usage: node scripts/check-web-api.mjs   (wired as `preweb` in package.json)
 * Always exits 0.
 */

const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';

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

const ok = await reachable(apiBase);
if (!ok) {
  console.warn('');
  console.warn('⚠️  check-web-api: ' + apiBase + ' is not reachable.');
  console.warn('    This app calls it for login/auth and other server-side routes');
  console.warn('    (see src/api/client.ts). If it stays down, the web app will show');
  console.warn('    "No internet connection" on every request — that is this, not your network.');
  console.warn('');
  console.warn('    Fix: in another terminal, `cd frontend-web && npm install && npm run dev`');
  console.warn('    (first time in a fresh checkout/worktree, also copy .env.local from');
  console.warn('    an existing checkout — it is gitignored and not created automatically).');
  console.warn('');
}
