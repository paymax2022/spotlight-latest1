/**
 * Merchant profile — the screen one click below the directory that was in the
 * bug report.
 *
 * GET /api/referral/admin/merchants/:id answers the merchant record alone, so
 * `data.campaign_list.length` threw as soon as the page mounted: the same
 * "This page couldn't load" boundary, from the same wrong assumption about the
 * wire shape. The service now composes the profile with /:id/campaigns and
 * /:id/keys, and this file pins what the page does with the two sections no
 * route serves at all — invoices and audit, which have to stay visibly
 * unreported.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { getMerchant, approveMerchantCampaign } = vi.hoisted(() => ({
  getMerchant: vi.fn(),
  approveMerchantCampaign: vi.fn(),
}));
vi.mock('@/services/referralAdminOpsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/referralAdminOpsService')>()),
  getMerchant,
  approveMerchantCampaign,
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'mer_7' }) }));

import MerchantDetailPage from './page';

beforeEach(() => {
  getMerchant.mockReset();
  approveMerchantCampaign.mockReset();
});

// Exactly what the three live routes leave on the table: no invoices, no audit,
// no category, no KYC, no revenue share.
const detail = (o: Record<string, unknown> = {}) => ({
  id: 'mer_7',
  name: 'Kongapay',
  status: 'active',
  joined_at: '2026-08-01T09:00:00Z',
  campaigns: 2,
  funded_kobo: 10_000_000,
  outstanding_balance_kobo: 5_000_000,
  api_key_active: true,
  campaign_list: [
    { id: 'mc_1', name: 'Q4 air push', status: 'funded', funded_kobo: 8_000_000, spent_kobo: 3_000_000 },
    { id: 'mc_2', name: 'Winter push', status: 'settled', funded_kobo: 2_000_000, spent_kobo: 2_000_000 },
  ],
  ...o,
});

describe('referral merchant profile', () => {
  it('mounts with the campaign rows the sibling route supplied', async () => {
    getMerchant.mockResolvedValue(detail());
    render(<MerchantDetailPage />);

    await waitFor(() => expect(screen.getByText('Q4 air push')).toBeTruthy());
    expect(screen.getByText('Winter push')).toBeTruthy();
    expect(screen.getByText('₦80,000.00')).toBeTruthy();
    expect(screen.getByText('₦30,000.00')).toBeTruthy();
    // Profile totals are summed from the campaign rows: 10M funded, 5M unspent.
    expect(screen.getByText('₦100,000.00')).toBeTruthy();
    expect(screen.getByText('₦50,000.00')).toBeTruthy();
  });

  it('dashes the profile fields no merchant route answers', async () => {
    getMerchant.mockResolvedValue(detail());
    render(<MerchantDetailPage />);

    await waitFor(() => expect(screen.getByText('Q4 air push')).toBeTruthy());
    for (const label of ['Category', 'KYC', 'Take rate', 'Revenue share']) {
      const kpi = (screen.getByText(label).parentElement as HTMLElement).textContent ?? '';
      expect(kpi).toContain('—');
    }
    expect(document.body.textContent).not.toMatch(/undefined%/);
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it('says invoices and audit are unreported instead of rendering empty tables', async () => {
    getMerchant.mockResolvedValue(detail());
    render(<MerchantDetailPage />);

    await waitFor(() => expect(screen.getAllByText(/not reported by the backend/i)).toHaveLength(2));
    // "No invoices." would be a statement about the partner's billing history.
    expect(screen.queryByText('No invoices.')).toBeNull();
  });

  it('shows the real empty state once a route does answer with no rows', async () => {
    getMerchant.mockResolvedValue(detail({ invoices: [], audit: [] }));
    render(<MerchantDetailPage />);

    await waitFor(() => expect(screen.getByText('No invoices.')).toBeTruthy());
    expect(screen.queryByText(/not reported by the backend/i)).toBeNull();
  });

  it('the approve button refuses instead of pretending a campaign was approved', async () => {
    getMerchant.mockResolvedValue(detail({
      campaign_list: [{ id: 'mc_9', name: 'Draft push', status: 'draft', funded_kobo: 0, spent_kobo: 0 }],
    }));
    approveMerchantCampaign.mockRejectedValue(new Error('Approving a merchant campaign has no backend yet.'));
    render(<MerchantDetailPage />);

    await waitFor(() => expect(screen.getByText('Draft push')).toBeTruthy());
    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => expect(screen.getByText(/has no backend yet/i)).toBeTruthy());
    expect(screen.queryByText(/audit event emitted/i)).toBeNull();
  });
});
