/**
 * House ledger: the page that showed "This page couldn't load".
 *
 * Two defects, one screen. The service called `/house` for the account record
 * and returned it as if it were the ledger aggregate, then the page did
 * `data.accounts.map` on that object. And `balance_kobo` is not a column of
 * referral_house_accounts at all: the old fixture printed ₦0.00 for a house
 * account whose balance the API has never reported, which on a money screen is a
 * claim ("the house holds nothing") rather than an absence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { getHouseLedger } = vi.hoisted(() => ({ getHouseLedger: vi.fn() }));
vi.mock('@/services/referralAdminService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/referralAdminService')>()),
  getHouseLedger,
}));

import HouseLedgerPage from './page';

beforeEach(() => { getHouseLedger.mockReset(); });

const ledger = (o: Record<string, unknown> = {}) => ({
  accounts: [
    {
      id: 'house_global',
      code: 'HOUSE-GLOBAL',
      scope: 'global',
      region: null,
      owner_user_id: 'usr_house',
      non_withdrawable: true,
      created_at: new Date().toISOString(),
    },
  ],
  total_house_volume: 41,
  total_house_value_kobo: 6_150_000,
  budget_neutral: true,
  entries: [],
  ...o,
});

describe('referral house ledger', () => {
  it('renders the account row instead of crashing on the aggregate object', async () => {
    getHouseLedger.mockResolvedValue(ledger());
    render(<HouseLedgerPage />);

    await waitFor(() => expect(screen.getByText('HOUSE-GLOBAL')).toBeTruthy());
    expect(screen.getByText('usr_house')).toBeTruthy();
  });

  it('dashes an unreported house balance instead of printing ₦0.00', async () => {
    getHouseLedger.mockResolvedValue(ledger());
    const { container } = render(<HouseLedgerPage />);

    await waitFor(() => expect(screen.getByText('HOUSE-GLOBAL')).toBeTruthy());
    const row = screen.getByText('HOUSE-GLOBAL').closest('tr') as HTMLElement;
    // Column 5 is Balance; column 3 (Region) is legitimately a dash on a
    // global-scope account, so the assertion names the cell rather than counting
    // dashes anywhere in the row.
    expect((row.children[4] as HTMLElement).textContent).toBe('—');
    // ₦0.00 anywhere on this screen would be an invented measurement.
    expect(row.textContent).not.toMatch(/₦0\.00/);
    expect(container.textContent).not.toMatch(/undefined/);
  });

  it('shows a reported balance when the backend sends one', async () => {
    getHouseLedger.mockResolvedValue(ledger({
      accounts: [{ ...ledger().accounts[0], balance_kobo: 1_250_000 }],
    }));
    render(<HouseLedgerPage />);

    await waitFor(() => expect(screen.getByText('HOUSE-GLOBAL')).toBeTruthy());
    expect(screen.getByText('₦12,500.00')).toBeTruthy();
  });

  it('names the endpoint when the read fails', async () => {
    getHouseLedger.mockRejectedValue(new Error('Request failed (404)'));
    render(<HouseLedgerPage />);

    await waitFor(() => expect(screen.getByText(/Request failed \(404\)/)).toBeTruthy());
  });
});
