/**
 * Merchant directory: the five columns the list route does not answer.
 *
 * merchant.Handler.List returns id/name/slug/status/owner_user_id/created_at.
 * The table also asks for category, KYC status, campaign count, funded volume
 * and take rate, which come from other surfaces (campaign rows, merchant_kyc,
 * revenue share) and are not in that query. Rendering an empty cell for those
 * reads as "no campaigns, ₦0 funded, 0% take rate"; the directory then looks
 * like a partner list of unfunded merchants, and an operator decides on it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const { listMerchants } = vi.hoisted(() => ({ listMerchants: vi.fn() }));
vi.mock('@/services/referralAdminOpsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/referralAdminOpsService')>()),
  listMerchants,
}));

import ReferralMerchantsPage from './page';

beforeEach(() => { listMerchants.mockReset(); });

// One row exactly as /merchants answers it — the joined date is created_at.
const merchant = (o: Record<string, unknown> = {}) => ({
  id: 'mer_7',
  name: 'Kongapay',
  status: 'active',
  joined_at: new Date().toISOString(),
  ...o,
});

describe('referral merchant directory', () => {
  it('renders the rows the endpoint reports', async () => {
    listMerchants.mockResolvedValue([merchant(), merchant({ id: 'mer_8', name: 'Verto Foods' })]);
    render(<ReferralMerchantsPage />);

    await waitFor(() => expect(screen.getByText('Kongapay')).toBeTruthy());
    expect(screen.getByText('Verto Foods')).toBeTruthy();
    // 'active' also appears as a filter option, so assert it inside the row.
    const row = screen.getByText('Kongapay').closest('tr') as HTMLElement;
    expect(row.textContent).toContain('active');
  });

  it('dashes the columns the list route does not answer and says why', async () => {
    listMerchants.mockResolvedValue([merchant()]);
    render(<ReferralMerchantsPage />);

    await waitFor(() => expect(screen.getByText('Kongapay')).toBeTruthy());
    const row = screen.getByText('Kongapay').closest('tr') as HTMLElement;
    // Category, KYC, campaigns, funded, take rate.
    expect(within(row).getAllByText('—')).toHaveLength(5);
    expect(row.textContent).not.toMatch(/₦0\.00/);
    expect(row.textContent).not.toMatch(/undefined/);
    expect(screen.getByText(/not reported by the merchants endpoint/i)).toBeTruthy();
  });

  it('shows sourced values when a wider surface supplies them', async () => {
    listMerchants.mockResolvedValue([merchant({
      category: 'fintech',
      kyc_status: 'verified',
      campaigns: 3,
      funded_kobo: 5_000_000,
      take_rate_pct: 2.5,
    })]);
    render(<ReferralMerchantsPage />);

    await waitFor(() => expect(screen.getByText('Kongapay')).toBeTruthy());
    const row = screen.getByText('Kongapay').closest('tr') as HTMLElement;
    expect(row.textContent).toContain('fintech');
    expect(row.textContent).toContain('₦50,000.00');
    expect(row.textContent).toContain('2.5%');
  });

  it('names the failure instead of showing an empty directory', async () => {
    listMerchants.mockRejectedValue(new Error('No API route matches GET /api/referral/admin/merchants'));
    render(<ReferralMerchantsPage />);

    await waitFor(() => expect(screen.getByText(/No API route matches GET \/api\/referral\/admin\/merchants/)).toBeTruthy());
  });
});
