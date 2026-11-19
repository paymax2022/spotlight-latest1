// AI trading is paper/eligibility only in this build (the venue package ships
// only NoopAdapter, so nothing can place a real order). Its mobile fixtures must
// therefore never present a strategy as live/canary or real-capital eligible —
// otherwise a screenshot of the strategies screen reads as real fund status.
// Static-source assertions, matching this repo's mobile unit-test convention
// (see tests/unit/voting/liveEndpoints.spec.ts): the api module has no DI seam
// for the axios client, so the fixture block is asserted at the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const apiSrc = readFileSync(
  join(process.cwd(), 'src/features/aitrading/api.ts'),
  'utf8',
);
const screenSrc = readFileSync(
  join(process.cwd(), 'app/ai-trading/strategies.tsx'),
  'utf8',
);

const mockBlock = apiSrc.slice(
  apiSrc.indexOf('const MOCK_STRATEGIES'),
  apiSrc.indexOf('export async function fetchStrategies'),
);

test('demo strategies never claim a live or canary stage', () => {
  assert.ok(mockBlock.length > 0, 'MOCK_STRATEGIES block not found — update this guard');
  assert.doesNotMatch(
    mockBlock,
    /stage:\s*'(live|canary)'/,
    'demo fixtures must stay at paper/shadow/halted: no real order can be placed, so a ' +
      '"live" fixture misrepresents fund status in any screenshot',
  );
});

test('demo strategies never claim real-capital eligibility', () => {
  assert.doesNotMatch(
    mockBlock,
    /realCapitalEligible:\s*true/,
    'execution is stubbed (venue.NoopAdapter) — nothing may present as real-capital eligible',
  );
});

test('the strategies screen labels mock data as demo', () => {
  assert.match(
    screenSrc,
    /TRADING_USE_MOCK/,
    'the screen must know it is rendering fixtures',
  );
  assert.match(
    screenSrc,
    /Demo data/,
    'mock mode must render an explicit demo banner so it cannot be mistaken for live status',
  );
});
