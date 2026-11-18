// The wire→domain mapping for three batch-6 doctor reads: records dashboard,
// earnings breakdown, wallet balance.
//
// The bug these guard: `doctor.batch6.api.ts` cast each live payload straight
// into the screen's type (`doctorGet<DoctorRecordsDashboard>('/records/dashboard')`),
// but the Go projection is a different shape entirely, and it answers 200:
//
//   GET /records/dashboard  → {totalShares, activeShares, shares[]}
//       (service_clinical.go GetRecordsDashboard — projects doctor_record_shares)
//   GET /earnings/breakdown → {currency, ledgerBalanceKobo, grossKobo, commissionKobo,
//       vatKobo, netKobo, invoiceCount}  (service_tail2.go GetEarningsBreakdown)
//   GET /wallet/balance     → {availableKobo, currency, source}
//       (service_tail2.go GetWalletBalance — a ledger projection)
//
// So `isLoading`/`isError`/`!dashboard` all passed and the first unguarded array
// access threw: `dashboard.recentPatients.length` at app/(doctor)/(tabs)/records.tsx:61
// and `breakdown.periods.find(...)` at app/(doctor)/(tabs)/earnings.tsx:36. Both tabs
// crashed on tap. `contracts/doctor.openapi.yaml` types every batch-6 response as
// `Generic`, so the wire shape is the backend's to choose and the client must adapt —
// the same way getDashboard (doctor.batch1.api.ts) already normalizes its flat
// DashboardSummary instead of casting it.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapRecordsDashboardWire,
  mapEarningsBreakdownWire,
  mapWalletBalanceWire,
} from '../batch6Wire.ts';

// ─── Records dashboard ───────────────────────────────────────────────────────

test('the shares-only records projection yields arrays, not undefined', () => {
  // The literal body for a doctor with no shares.
  const dashboard = mapRecordsDashboardWire({ totalShares: 0, activeShares: 0, shares: [] });
  assert.equal(dashboard.recentPatients.length, 0);
  assert.equal(dashboard.categoryCounts.length, 0);
  assert.equal(dashboard.pendingShares, 0);
  assert.equal(dashboard.totalPatients, 0);
});

test('a records body with the fields absent cannot crash the screen', () => {
  const dashboard = mapRecordsDashboardWire({});
  assert.deepEqual(dashboard, {
    totalPatients: 0,
    recentPatients: [],
    categoryCounts: [],
    pendingShares: 0,
  });
});

test('patients are counted once each, however many records were shared', () => {
  const dashboard = mapRecordsDashboardWire({
    totalShares: 3,
    activeShares: 3,
    shares: [
      { patientId: 'p-1', status: 'active' },
      { patientId: 'p-1', status: 'active' },
      { patientId: 'p-2', status: 'active' },
    ],
  });
  assert.equal(dashboard.totalPatients, 2);
});

test('a share with no patient behind it is not a patient', () => {
  const dashboard = mapRecordsDashboardWire({ shares: [{ status: 'active' }, {}] });
  assert.equal(dashboard.totalPatients, 0);
});

test('only a share awaiting a decision counts as pending', () => {
  // The Go insert writes 'active' and never transitions (repository_clinical.go
  // InsertRecordShare), so a real doctor's tile stays at zero — which is the
  // honest reading of "requests in flight", unlike totalShares - activeShares,
  // which would count every revoked or expired grant as pending.
  const dashboard = mapRecordsDashboardWire({
    shares: [
      { patientId: 'p-1', status: 'active' },
      { patientId: 'p-2', status: 'pending' },
      { patientId: 'p-3', status: 'expired' },
    ],
  });
  assert.equal(dashboard.pendingShares, 1);
});

// ─── Earnings breakdown ──────────────────────────────────────────────────────

test('every period the earnings toggle offers exists, even with no money behind it', () => {
  // The literal body for a doctor with no invoices. earnings.tsx reads
  // breakdown.periods.find(...) for the selected period before it renders.
  const breakdown = mapEarningsBreakdownWire({
    currency: 'NGN',
    ledgerBalanceKobo: 0,
    grossKobo: 0,
    commissionKobo: 0,
    vatKobo: 0,
    netKobo: 0,
    invoiceCount: 0,
  });
  for (const period of ['today', 'week', 'month'] as const) {
    const totals = breakdown.periods.find((p) => p.period === period);
    assert.ok(totals, `period ${period} is missing`);
    assert.deepEqual(totals.bySource, []);
    assert.equal(totals.grossKobo, 0);
  }
});

test('the lifetime sum is the ledger balance, as GetEarnings defines it', () => {
  // service.go GetEarnings reports LifetimeKobo = ledger.GetBalance, so the
  // breakdown must not invent a different lifetime number from the invoice sums.
  const breakdown = mapEarningsBreakdownWire({ ledgerBalanceKobo: 4_250_000, netKobo: 3_900_000 });
  assert.equal(breakdown.lifetimeKobo, 4_250_000);
});

test('an empty earnings body leaves every tile at zero', () => {
  assert.deepEqual(mapEarningsBreakdownWire({}), {
    todayKobo: 0,
    weekKobo: 0,
    monthKobo: 0,
    lifetimeKobo: 0,
    periods: [
      { period: 'today', grossKobo: 0, bySource: [] },
      { period: 'week', grossKobo: 0, bySource: [] },
      { period: 'month', grossKobo: 0, bySource: [] },
    ],
  });
});

// ─── Wallet balance ──────────────────────────────────────────────────────────

test('the wallet ledger is an array the screen can map over', () => {
  // The literal body: GetWalletBalance projects a single balance, so earnings.tsx
  // reading wallet.ledger.length threw right after the periods crash.
  const wallet = mapWalletBalanceWire({ availableKobo: 0, currency: 'NGN', source: 'ledger' });
  assert.deepEqual(wallet.ledger, []);
  assert.equal(wallet.availableKobo, 0);
});

test('pending is zero because the backend has no pending projection', () => {
  // service.go GetEarnings hardcodes PendingKobo: 0 — nothing clears a payout
  // into a pending bucket yet, so the balance card must not imply a number it
  // does not have.
  const wallet = mapWalletBalanceWire({ availableKobo: 1_500_000 });
  assert.equal(wallet.pendingKobo, 0);
  assert.equal(wallet.ledgerKobo, 1_500_000);
});

test('an empty wallet body still renders the balance card', () => {
  assert.deepEqual(mapWalletBalanceWire({}), {
    availableKobo: 0,
    pendingKobo: 0,
    ledgerKobo: 0,
    ledger: [],
  });
});
