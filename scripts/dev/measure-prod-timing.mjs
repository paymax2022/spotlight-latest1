#!/usr/bin/env node
/**
 * Measure what a page on www.spotlightng.com actually costs a visitor, so "the menu is
 * slow on prod" settles as origin throughput rather than bundle size.
 *
 *   node scripts/dev/measure-prod-timing.mjs [url]     # defaults to /
 *
 * Playwright only exists in the frontend-web install, and ESM ignores NODE_PATH, so the
 * resolve below is pinned to it rather than to the caller's cwd.
 *
 * Read the numbers against the 2026-11-14 baseline: HTML lands in 1-6 s, then ~216 KB of
 * JS keeps arriving for another 30-50 s because the LiteSpeed origin streams about 5 KB/s
 * per stream. The drawer answers clicks from an inline script in the SSR'd HTML, so the
 * "hydrated" line is when React takes over, NOT when the menu starts working.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', {
  paths: [path.join(here, '../../frontend-web/node_modules'), path.join(here, '../../node_modules')],
}));

const url = process.argv[2] || 'https://www.spotlightng.com/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(url, { waitUntil: 'commit' });

const t0 = Date.now();
let hydrated = null;
for (let i = 0; i < 120; i += 1) {
  if (await page.evaluate(() => !!window.__spotlightDrawerReact)) { hydrated = Date.now() - t0; break; }
  await page.waitForTimeout(500);
}
// Read the navigation entry only once it has closed: at 'commit' responseEnd is still 0.
await page.waitForLoadState('load').catch(() => {});
const nav = await page.evaluate(
  () => JSON.parse(JSON.stringify(performance.getEntriesByType('navigation')[0])));

const done = await page.evaluate(() => {
  const e = performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script');
  const bytes = e.reduce((n, r) => n + (r.encodedBodySize || 0), 0);
  return { count: e.length, bytes, lastEnd: Math.round(Math.max(0, ...e.map((r) => r.responseEnd))) / 1000 };
});

console.log(url);
console.log('  html              ', (nav.responseEnd / 1000).toFixed(1), 's');
console.log('  script resources  ', done.count, '=', (done.bytes / 1024).toFixed(0), 'KB');
console.log('  last script done  ', done.lastEnd.toFixed(1), 's');
console.log('  hydrated          ', hydrated === null ? '>60s' : (hydrated / 1000).toFixed(1) + 's');
await browser.close();
