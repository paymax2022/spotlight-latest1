/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react';

vi.mock('@/services/usersService', () => ({
  AdminUsersRequestError: class extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
}));

const mockCode = vi.fn();
const mock360 = vi.fn();
const mockLedger = vi.fn();
vi.mock('@/services/userReferralActivityService', () => ({
  getUserReferralCode: (...a: unknown[]) => mockCode(...a),
  getReferral360: (...a: unknown[]) => mock360(...a),
  getReferralLedger: (...a: unknown[]) => mockLedger(...a),
}));

import { ReferralActivityPanel } from './ReferralActivityPanel';
import { AdminUsersRequestError } from '@/services/usersService';

const panel = () => within(screen.getByTestId('referral-activity-panel'));
const err = (status: number, msg = 'boom') => new (AdminUsersRequestError as unknown as new (s: number, m: string) => Error)(status, msg);

const sum = { referrer_id: 'r1', referred_count: 3, total_earned_kobo: 150000, paid_kobo: 50000, clawed_back_kobo: 2500, fraud_standing: 'under_review' };
const entry = (o: Record<string, unknown> = {}) => ({ id: 'e1', kind: 'reward', state: 'paid', amount_kobo: 12345, currency: 'NGN', is_house: false, referred_user_id: 'abcdef1234567890', ...o });

describe('ReferralActivityPanel', () => {
  beforeEach(() => {
    mockCode.mockReset().mockResolvedValue({ code: 'K7QX2', source: 'finance_referral_codes' });
    mock360.mockReset().mockResolvedValue(sum);
    mockLedger.mockReset().mockResolvedValue([entry()]);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the code with its source, the 360 figures and the ledger', async () => {
    render(<ReferralActivityPanel userId="u1" />);
    await waitFor(() => expect(panel().getByTestId('referral-code').textContent).toBe('K7QX2'));
    expect(panel().getByTestId('referral-code-source').textContent).toContain('finance_referral_codes');
    expect(mockCode).toHaveBeenCalledWith('u1');
    expect(await panel().findByText('₦1,500.00')).toBeTruthy();
    expect(panel().getByText('₦500.00')).toBeTruthy();
    expect(panel().getByText('₦25.00')).toBeTruthy();
    expect(panel().getByTestId('fraud-standing').textContent).toContain('under_review');
    expect(await panel().findByText(/most recent 200/i)).toBeTruthy();
    expect(panel().getByText('₦123.45')).toBeTruthy();
    expect(panel().getByText('abcdef12')).toBeTruthy();
    expect(panel().queryByText('abcdef1234567890')).toBeNull();
    expect(panel().queryByRole('link')).toBeNull();
  });

  it('copy uses the clipboard and shows a transient Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ReferralActivityPanel userId="u1" />);
    fireEvent.click(await panel().findByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('K7QX2');
    expect(await panel().findByText('Copied')).toBeTruthy();
  });

  it('copy survives a missing or rejecting clipboard', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<ReferralActivityPanel userId="u1" />);
    fireEvent.click(await panel().findByRole('button', { name: /copy/i }));
    await waitFor(() => expect(panel().queryByText('Copied')).toBeNull());
    expect(panel().getByTestId('referral-code').textContent).toBe('K7QX2');
  });

  it('a user without a code shows the empty state and no Retry for that section', async () => {
    mockCode.mockResolvedValue(null);
    render(<ReferralActivityPanel userId="u1" />);
    expect(await panel().findByText('No referral code yet')).toBeTruthy();
    expect(panel().queryByRole('button', { name: /copy/i })).toBeNull();
    expect(panel().queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('empty ledger', async () => {
    mockLedger.mockResolvedValue([]);
    render(<ReferralActivityPanel userId="u1" />);
    expect(await panel().findByText('No referral ledger entries')).toBeTruthy();
  });

  it('each section fails independently', async () => {
    mockCode.mockRejectedValue(err(403));
    mock360.mockRejectedValue(err(500, 'server exploded'));
    render(<ReferralActivityPanel userId="u1" />);
    expect(await panel().findByText(/permission/i)).toBeTruthy();
    expect(await panel().findByText(/server exploded/)).toBeTruthy();
    // The ledger still rendered.
    expect(await panel().findByText('₦123.45')).toBeTruthy();
    expect(panel().getAllByRole('button', { name: /retry/i })).toHaveLength(1);
  });

  it('Retry reloads only the failed section', async () => {
    mock360.mockRejectedValueOnce(err(500, 'nope'));
    render(<ReferralActivityPanel userId="u1" />);
    fireEvent.click(await panel().findByRole('button', { name: /retry/i }));
    expect(await panel().findByText('₦1,500.00')).toBeTruthy();
    expect(mock360).toHaveBeenCalledTimes(2);
    expect(mockCode).toHaveBeenCalledTimes(1);
    expect(mockLedger).toHaveBeenCalledTimes(1);
  });

  it('ignores a superseded response when the user changes', async () => {
    let resolveOld: (v: unknown) => void = () => {};
    mockCode.mockImplementation((id: string) =>
      id === 'old' ? new Promise((r) => { resolveOld = r; }) : Promise.resolve({ code: 'NEWCODE', source: 'referral_links' }));
    const { rerender } = render(<ReferralActivityPanel userId="old" />);
    rerender(<ReferralActivityPanel userId="new" />);
    await waitFor(() => expect(panel().getByTestId('referral-code').textContent).toBe('NEWCODE'));
    resolveOld({ code: 'OLDCODE', source: 'platform_users' });
    await new Promise((r) => setTimeout(r, 20));
    expect(panel().getByTestId('referral-code').textContent).toBe('NEWCODE');
  });

  it('is read-only: only Copy and Retry buttons exist', async () => {
    render(<ReferralActivityPanel userId="u1" />);
    await panel().findByText('₦123.45');
    expect(panel().getAllByRole('button').map((b) => b.textContent)).toEqual(['Copy']);
  });
});
