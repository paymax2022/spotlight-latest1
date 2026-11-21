#!/usr/bin/env node
/**
 * Measure what a page on www.spotlightng.com actually costs a visitor, so "the menu is
 * slow on prod" settles as origin throughput rather than bundle size.
 *
 *   node scripts/dev/measure-prod-timing.mjs [url]     # defaults to /
 *
 * Playwright lives in the frontend-web install and ESM ignores NODE_PATH, so the resolve
 * below tries this checkout's install, then a normal lookup, before giving up.
 *
 * The arrival time is not a constant of this host: the same 216 KB measured 30-50 s in the
 * morning and 6-7 s the same evening, so quote a number only from a fresh run. The drawer
 * answers clicks from an inline script in the SSR'd HTML, which means the "hydrated" line
 * is when React takes over, NOT the moment the menu starts working.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let playwright;
for (const attempt of [
  () => require.resolve('playwright', {
    paths: [path.join(here, '../../frontend-web/node_modules'), path.join(here, '../../node_modules')],
  }),
  () => require.resolve('playwright'),
  () => require.resolve('playwright-core'),
].map((f) => { try { return f(); } catch { return null; } })) {
  if (attempt) { playwright = require(attempt); break; }
}
if (!playwright) {
  console.error('Playwright not found. Run `npm ci` in frontend-web, or `npm i -g playwright`.');
  process.exit(1);
}
const { chromium } = playwright;

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
