// Logic tests for the swap quote/confirmation screens (Phase 2 Task 1.1).
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/crypto/*.test.ts"
// The repo has no jest/vitest/RNTL, so render behaviour is pinned through the pure
// functions the components delegate to (countdown state, labels, fee lines, status machine).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  secondsRemaining, countdownState, formatUnits, quoteLabel, receiveLabel,
  expiryLabel, feeLabel, spreadLabel, nextSwapStatus,
} from '../../src/features/crypto/utils/swapDisplay.ts';

const NOW = Date.parse('2026-10-28T10:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe('QuoteDisplay logic', () => {
  test('renders quote details with expiry countdown', () => {
    const q = { from_asset_id: 'usdt', to_asset_id: 'ngn', from_units: 100, to_units: 15000000, expires_at: at(15000) };
    assert.match(quoteLabel(q.from_units, q.from_asset_id), /100.*USDT/);
    assert.match(quoteLabel(q.to_units, q.to_asset_id), /15,000,000.*NGN/);
    assert.match(expiryLabel(secondsRemaining(q.expires_at, NOW)), /Expires in 15 seconds/);
  });

  test('shows expired state when expires_at < now', () => {
    const s = secondsRemaining(at(-1000), NOW);
    assert.equal(s, 0);
    assert.equal(countdownState(s), 'expired');
    assert.match(expiryLabel(s), /Quote expired/);
  });

  test('countdown turns red when < 5 seconds remaining', () => {
    assert.equal(countdownState(secondsRemaining(at(4000), NOW)), 'urgent');
    assert.equal(countdownState(secondsRemaining(at(5000), NOW)), 'normal');
    assert.equal(countdownState(secondsRemaining(at(15000), NOW)), 'normal');
  });

  test('invalid expires_at is treated as expired (fail closed)', () => {
    assert.equal(secondsRemaining('garbage', NOW), 0);
  });
});

describe('Confirmation logic', () => {
  test('displays final swap amount and fee breakdown', () => {
    assert.match(receiveLabel(15000000, 'ngn'), /You will receive.*15,000,000.*NGN/);
    assert.match(feeLabel(50000), /Fee.*50,000.*kobo/);
    assert.match(spreadLabel(25), /0\.25%/);
  });

  test('formatUnits groups integers and rejects non-integers', () => {
    assert.equal(formatUnits(1234567), '1,234,567');
    assert.throws(() => formatUnits(1.5));
  });
});

describe('swap status machine', () => {
  test('idle -> confirming -> executing -> complete', () => {
    let s = nextSwapStatus('idle', 'confirm');
    assert.equal(s, 'confirming');
    s = nextSwapStatus(s, 'accepted');
    assert.equal(s, 'executing');
    assert.equal(nextSwapStatus(s, 'settled'), 'complete');
  });
  test('failure from confirming or executing; illegal transitions ignored', () => {
    assert.equal(nextSwapStatus('confirming', 'error'), 'failed');
    assert.equal(nextSwapStatus('executing', 'error'), 'failed');
    assert.equal(nextSwapStatus('idle', 'settled'), 'idle');
    assert.equal(nextSwapStatus('complete', 'confirm'), 'complete');
    assert.equal(nextSwapStatus('failed', 'reset'), 'idle');
  });
});
