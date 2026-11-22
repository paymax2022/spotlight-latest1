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
import { ReferralCodeTakenError as TakenError } from '@/services/referralRewardsAdminService';

const mockSetCode = vi.fn();
// Only the write is replaced; the code-shape constants and the typed 409 error
// stay the real ones, so the panel is exercised against what the service actually
// exports.
vi.mock('@/services/referralRewardsAdminService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/referralRewardsAdminService')>();
  return { ...actual, setReferrerCode: (...a: unknown[]) => mockSetCode(...a) };
});

const panel = () => within(screen.getByTestId('referral-activity-panel'));
const err = (status: number, msg = 'boom') => new (AdminUsersRequestError as unknown as new (s: number, m: string) => Error)(status, msg);

const sum = { referrer_id: 'r1', referred_count: 3, total_earned_kobo: 150000, paid_kobo: 50000, clawed_back_kobo: 2500, fraud_standing: 'under_review' };
const entry = (o: Record<string, unknown> = {}) => ({ id: 'e1', kind: 'reward', state: 'paid', amount_kobo: 12345, currency: 'NGN', is_house: false, referred_user_id: 'abcdef1234567890', ...o });

describe('ReferralActivityPanel', () => {
  beforeEach(() => {
    mockCode.mockReset().mockResolvedValue({ code: 'K7QX2', source: 'finance_referral_codes' });
    mock360.mockReset().mockResolvedValue(sum);
    mockLedger.mockReset().mockResolvedValue([entry()]);
    mockSetCode.mockReset().mockResolvedValue({ code: 'JIDE1' });
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

  // The support question this section exists to answer is "what is this user's
  // code, and did we change it?". A rename used to overwrite the only value the
  // page had, so an admin could not tell an issued code from a vanity one.
  it('shows the issued code above the customised one', async () => {
    mockCode.mockResolvedValue({ code: 'JIDE1', source: 'referral_links', original: '94JQ7' });
    render(<ReferralActivityPanel userId="u1" />);
    await waitFor(() => expect(panel().getByTestId('referral-code').textContent).toBe('JIDE1'));
    expect(panel().getByTestId('referral-code-original').textContent).toBe('94JQ7');
    expect(panel().getByText('Original code')).toBeTruthy();
    expect(panel().getByText('Current code')).toBeTruthy();
    // The source chip belongs to the live code; the original has no row of its own
    // to report a table for.
    expect(panel().getByTestId('referral-code-source').textContent).toContain('referral_links');
  });

  // One code, no history: the section must not grow an empty "Original" row that
  // reads like missing data.
  it('shows a single code when the account was never customised', async () => {
    render(<ReferralActivityPanel userId="u1" />);
    await waitFor(() => expect(panel().getByTestId('referral-code').textContent).toBe('K7QX2'));
    expect(panel().queryByTestId('referral-code-original')).toBeNull();
    expect(panel().queryByText('Original code')).toBeNull();
    expect(panel().queryByText('Current code')).toBeNull();
  });

  // With two codes on screen, the one button must still copy the one that works.
  it('copies the current code when an original is also shown', async () => {
    mockCode.mockResolvedValue({ code: 'JIDE1', source: 'referral_links', original: '94JQ7' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ReferralActivityPanel userId="u1" />);
    fireEvent.click(await panel().findByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('JIDE1');
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

  it('summary and ledger 404 mean the engine is off: plain message, no Retry, other sections intact', async () => {
    mock360.mockRejectedValue(err(404, 'No API route matches GET /api/referral/admin/x'));
    mockLedger.mockRejectedValue(err(404, 'No API route matches GET /api/referral/admin/y'));
    render(<ReferralActivityPanel userId="u1" />);
    await waitFor(() => expect(panel().getAllByText('Referral engine is not enabled in this environment.')).toHaveLength(2));
    expect(panel().queryByText(/No API route/)).toBeNull();
    expect(panel().queryByRole('button', { name: /retry/i })).toBeNull();
    expect(panel().getByTestId('referral-code').textContent).toBe('K7QX2');
  });

  it('code 404 still means no code yet, and the other sections render', async () => {
    mockCode.mockResolvedValue(null);
    render(<ReferralActivityPanel userId="u1" />);
    expect(await panel().findByText('No referral code yet')).toBeTruthy();
    expect(await panel().findByText('₦123.45')).toBeTruthy();
  });

  it('a Copied badge does not carry over to the next user', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    mockCode.mockImplementation(async (id: string) => ({ code: id === 'u1' ? 'K7QX2' : 'OTHER', source: 'referral_links' }));
    const { rerender } = render(<ReferralActivityPanel userId="u1" />);
    fireEvent.click(await panel().findByRole('button', { name: /copy/i }));
    expect(await panel().findByText('Copied')).toBeTruthy();
    rerender(<ReferralActivityPanel userId="u2" />);
    await waitFor(() => expect(panel().getByTestId('referral-code').textContent).toBe('OTHER'));
    expect(panel().queryByText('Copied')).toBeNull();
  });

  it('an admin can set a custom code: it is normalised, saved, and the shown code follows', async () => {
    render(<ReferralActivityPanel userId="u1" />);
    await panel().findByText('₦123.45');
    const input = panel().getByLabelText(/new code/i);
    fireEvent.change(input, { target: { value: 'jide1' } });
    // The field upper-cases as you type, so what the admin sees is what is saved.
    expect((input as HTMLInputElement).value).toBe('JIDE1');
    fireEvent.click(panel().getByRole('button', { name: /save code/i }));
    await waitFor(() => expect(mockSetCode).toHaveBeenCalledWith('u1', 'JIDE1'));
    expect(await panel().findByText(/Referral code is now JIDE1/i)).toBeTruthy();
    // The code shown is re-read from the server, not stitched together locally.
    await waitFor(() => expect(mockCode).toHaveBeenCalledTimes(2));
  });

  it('a code that belongs to someone else is reported as taken, not as a failure', async () => {
    mockSetCode.mockRejectedValue(new TakenError());
    render(<ReferralActivityPanel userId="u1" />);
    fireEvent.change(await panel().findByLabelText(/new code/i), { target: { value: 'TAKEN' } });
    fireEvent.click(panel().getByRole('button', { name: /save code/i }));
    expect(await panel().findByText(/already in use/i)).toBeTruthy();
    // The user still sees their real code — a refused save changes nothing.
    expect(panel().getByTestId('referral-code').textContent).toBe('K7QX2');
    expect(panel().queryByText(/Referral code is now/i)).toBeNull();
  });

  it('an invalid shape is refused before anything is sent', async () => {
    render(<ReferralActivityPanel userId="u1" />);
    fireEvent.change(await panel().findByLabelText(/new code/i), { target: { value: 'AB' } });
    fireEvent.click(panel().getByRole('button', { name: /save code/i }));
    expect(await panel().findByText(/3-5 characters/i)).toBeTruthy();
    expect(mockSetCode).not.toHaveBeenCalled();
  });

  it('a server error other than a clash says what the server said', async () => {
    mockSetCode.mockRejectedValue(new Error('Request failed (500)'));
    render(<ReferralActivityPanel userId="u1" />);
    fireEvent.change(await panel().findByLabelText(/new code/i), { target: { value: 'FLYER' } });
    fireEvent.click(panel().getByRole('button', { name: /save code/i }));
    expect(await panel().findByText(/Request failed \(500\)/)).toBeTruthy();
  });

  it('the controls are Copy and Save code, and nothing else', async () => {
    render(<ReferralActivityPanel userId="u1" />);
    await panel().findByText('₦123.45');
    expect(panel().getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Copy', 'Save code']);
  });
});
