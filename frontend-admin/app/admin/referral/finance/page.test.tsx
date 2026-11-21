/**
 * The payout queue was one of the four "This page couldn't load" screens.
 *
 * Root cause sat in the service (Go answers `{"payouts": […]}` and the page did
 * `rows.map` on that object), and the fix is the unwrap. What this file pins is
 * the other half: once an array arrives, a row whose fields the backend does not
 * report must say so. `p.beneficiary_name` and `p.risk_flag` have no column in
 * finance.Handler.ListPayouts, so an empty cell would read as "this payout is
 * clean / has no name" — a claim about money — while a 0 would be worse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const { listPayouts, getBudgetBurn } = vi.hoisted(() => ({
  listPayouts: vi.fn(),
  getBudgetBurn: vi.fn(),
}));
vi.mock('@/services/referralAdminOpsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/referralAdminOpsService')>()),
  listPayouts,
  getBudgetBurn,
  approvePayout: vi.fn().mockResolvedValue({ ok: true }),
}));

import FinancePayoutsPage from './page';

// Block bodies: an arrow hook returns the mock, which Vitest then reads as a
// teardown callback and reports the stored rejection as the test's failure.
beforeEach(() => {
  listPayouts.mockReset();
  getBudgetBurn.mockReset();
});

const payout = (o: Record<string, unknown> = {}) => ({
  id: 'po_1',
  beneficiary_id: 'usr_9',
  amount_kobo: 2_500_000,
  currency: 'NGN',
  status: 'pending',
  reward_ids: ['rw_4'],
  requested_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  approved_by: null,
  approved_at: null,
  ...o,
});

const budget = {
  as_of: new Date().toISOString(),
  program_budget_kobo: 100_000_000,
  program_spent_kobo: 40_000_000,
  reward_to_ltv_ratio: 0.12,
  reward_to_ltv_cap_pct: 25,
  lines: [],
  trend: [],
};

describe('referral payout queue', () => {
  it('renders the queue instead of crashing', async () => {
    listPayouts.mockResolvedValue([payout()]);
    getBudgetBurn.mockResolvedValue(budget);
    render(<FinancePayoutsPage />);

    await waitFor(() => expect(screen.getByText('usr_9')).toBeTruthy());
    expect(screen.getByText('₦25,000.00')).toBeTruthy();
  });

  it('dashes the fields the payouts endpoint does not report', async () => {
    // Exactly what the live route returns today: no beneficiary name, no risk flag.
    listPayouts.mockResolvedValue([payout()]);
    getBudgetBurn.mockResolvedValue(budget);
    render(<FinancePayoutsPage />);

    await waitFor(() => expect(screen.getByText('usr_9')).toBeTruthy());
    const row = screen.getByText('usr_9').closest('tr') as HTMLElement;
    // Beneficiary display name + Risk badge: two absences, zero invented values.
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(row.textContent).not.toMatch(/₦0\b/);
  });

  it('shows the backend sentence when the read fails', async () => {
    listPayouts.mockRejectedValue(new Error('No API route matches GET /api/referral/admin/finance/payouts'));
    getBudgetBurn.mockResolvedValue(budget);
    render(<FinancePayoutsPage />);

    await waitFor(() => expect(screen.getByText(/No API route matches GET \/api\/referral\/admin\/finance\/payouts/)).toBeTruthy());
  });
});
