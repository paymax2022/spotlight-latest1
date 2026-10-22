/**
 * Deposits (money-IN) tab. Read-only: it lists settled crypto credits and the deposit
 * reconciler's sweep counters. Nothing here moves money — a row is already-credited history.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CryptoDeposit, CryptoDepositReconcilerStatus } from '@/types/cryptoAdmin';

const mockList = vi.fn();
const mockStatus = vi.fn();
vi.mock('@/services/cryptoAdminService', async () => ({
  ...(await vi.importActual<typeof import('@/services/cryptoAdminService')>('@/services/cryptoAdminService')),
  adminListDeposits: (...a: unknown[]) => mockList(...a),
  adminGetDepositReconcilerStatus: (...a: unknown[]) => mockStatus(...a),
}));

import DepositsPage from './page';

const dep = (over: Partial<CryptoDeposit> = {}): CryptoDeposit => ({
  id: 'dep_1', provider: 'quidax', provider_op_id: 'qdx_dep_9001', user_id: 'usr_7f2a',
  symbol: 'BTC', network: 'bitcoin', address: 'bc1qseed', units: 500_000, minor_unit_scale: 100_000_000,
  confirmations: 6, required_confs: 3, tx_hash: '0x9f8e7d6c', created_at: '2026-10-14T08:00:00Z', credited_at: '2026-10-14T08:05:00Z',
  ...over,
});

const status = (over: Partial<CryptoDepositReconcilerStatus['replica']> = {}): CryptoDepositReconcilerStatus => ({
  success: true,
  note: 'the deposit reconciler sweeps provider deposits into the once-only settler; it can never double-credit.',
  replica: {
    started_at: '', runs: 3, led_runs: 3, skipped_runs: 0, last_run_at: '', last_led_at: '', last_led: true, last_error: '',
    last_result: { accounts: 2, scanned: 5, settled: 1, duplicates: 4, awaiting: 0, ignored: 0, truncated: false, errors: 0 },
    totals: { settled: 2, duplicates: 7, awaiting: 1, ignored: 0, errors: 0 },
    recent_alerts: [], ...over,
  },
});

async function mounted(deps: CryptoDeposit[], s: CryptoDepositReconcilerStatus | null) {
  mockList.mockResolvedValue(deps);
  mockStatus.mockResolvedValue(s);
  render(<DepositsPage />);
  await waitFor(() => expect(mockList).toHaveBeenCalled());
}

beforeEach(() => { mockList.mockReset(); mockStatus.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Deposits tab', () => {
  it('lists a settled credit with its whole-unit amount, confirmations and provider op id', async () => {
    await mounted([dep()], status());
    // The amount appears in both the per-asset KPI and the table row.
    expect((await screen.findAllByText('0.005 BTC')).length).toBeGreaterThan(0);
    expect(screen.getByText('qdx_dep_9001')).toBeTruthy();
    expect(screen.getByText('6/3')).toBeTruthy();
    expect(screen.getByText('usr_7f2a')).toBeTruthy();
  });

  it('shows the deposit reconciler sweep counters', async () => {
    await mounted([], status());
    // KPI labels render; the settled total is 2 for this fixture.
    expect(await screen.findByText('Settled (total)')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('surfaces money-IN history without a reconciler wired (null status)', async () => {
    await mounted([dep()], null);
    expect(await screen.findByText('qdx_dep_9001')).toBeTruthy();
    expect(screen.queryByText('Settled (total)')).toBeNull();
  });

  it('shows an empty state when there are no credits', async () => {
    await mounted([], status());
    expect(await screen.findByText(/no settled deposits/i)).toBeTruthy();
  });

  it('refetches on Refresh', async () => {
    await mounted([dep()], status());
    await screen.findByText('qdx_dep_9001');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('states that awaiting/unmapped transfers are not listed here', async () => {
    await mounted([dep()], status());
    expect(await screen.findByText(/NOT credited and\s*\n?\s*are not listed here/i)).toBeTruthy();
  });
});
