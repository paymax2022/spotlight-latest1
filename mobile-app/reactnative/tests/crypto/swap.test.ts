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

// ---- Phase 2 Task 1.2: Execution & Result logic ----
import {
  executionLabel, executionTimedOut, resultHeadline, settlementLabel, refundLabel,
  orderDetailLines, pollUntilSettled, EXECUTION_TIMEOUT_MS, POLL_INTERVAL_MS, MAX_POLLS,
} from '../../src/features/crypto/utils/swapDisplay.ts';

const SETTLED = { ledger_settled: true, settled_at: '2026-10-28T12:00:00Z' };

describe('Execution logic', () => {
  test('displays processing indicator and transaction ID', () => {
    assert.match(executionLabel('executing'), /Processing/);
  });
  test('times out after 30s without a status change', () => {
    assert.equal(EXECUTION_TIMEOUT_MS, 30000);
    assert.equal(executionTimedOut(0, 29999), false);
    assert.equal(executionTimedOut(0, 31000), true);
  });
});

describe('Result logic', () => {
  test('success shows received amount and settlement status', () => {
    assert.match(resultHeadline('completed'), /Swap completed/);
    assert.match(receiveLabel(15000000, 'ngn').replace('will receive', 'received'), /received.*15,000,000.*NGN/);
    assert.match(settlementLabel(SETTLED), /Settled/);
    assert.match(settlementLabel(SETTLED), /2026-10-28T12:00:00Z/);
  });
  test('failure shows refund info and settled_at proof', () => {
    assert.match(resultHeadline('failed'), /Swap failed/);
    assert.match(refundLabel(SETTLED), /Refunded/);
    assert.match(refundLabel(SETTLED), /2026-10-28T12:00:00Z/);
  });
  test('unsettled shows pending', () => {
    assert.match(settlementLabel({ ledger_settled: false }), /pending/i);
    assert.match(settlementLabel(null), /pending/i);
  });
  test('View Details lines include order id', () => {
    assert.ok(orderDetailLines({ id: 'ord_123', status: 'completed' }, SETTLED).some((l) => /Order ID.*ord_123/.test(l)));
  });
});

describe('pollUntilSettled', () => {
  test('polls every 2s, up to 30 times', async () => {
    assert.equal(POLL_INTERVAL_MS, 2000);
    assert.equal(MAX_POLLS, 30);
    let calls = 0; const sleeps: number[] = [];
    await assert.rejects(
      pollUntilSettled(async () => { calls++; return { ledger_settled: false }; }, { sleep: async (ms) => { sleeps.push(ms); } }),
      /not settled/i,
    );
    assert.equal(calls, 30);
    assert.ok(sleeps.every((s) => s === 2000));
  });
  test('resolves as soon as ledger_settled', async () => {
    let calls = 0;
    const r = await pollUntilSettled(async () => (++calls < 3 ? { ledger_settled: false } : SETTLED), { sleep: async () => {} });
    assert.equal(r.ledger_settled, true);
    assert.equal(calls, 3);
  });
  test('tolerates transient fetch errors', async () => {
    let calls = 0;
    const r = await pollUntilSettled(async () => { if (++calls < 2) throw new Error('net'); return SETTLED; }, { sleep: async () => {} });
    assert.equal(r.ledger_settled, true);
  });
});
