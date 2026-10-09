/**
 * Pins the contract of the provider-policy panel: the provider's policies are
 * listed beside (never inside) Paymax's book, the premium is labelled as not
 * revenue, a disabled backend degrades to an explanation, and Sync reloads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
const mockSync = vi.fn();

vi.mock('@/services/insuranceAdminService', async () => {
  class InsuranceAdminError extends Error {
    status: number;
    constructor(status: number, message = 'x') { super(message); this.status = status; }
  }
  return {
    getProviderPolicies: (...a: unknown[]) => mockGet(...a),
    syncProviderPolicies: (...a: unknown[]) => mockSync(...a),
    formatNaira: (k: number | null) => `₦${((k ?? 0) / 100).toLocaleString('en-NG')}`,
    InsuranceAdminError,
  };
});

import ProviderPoliciesPanel from './ProviderPoliciesPanel';
import { InsuranceAdminError } from '@/services/insuranceAdminService';

const policy = (o: Record<string, unknown> = {}) => ({
  provider_policy_ref: 'ref-1', policy_number: 'TESTGCM/OP/26/1', product_name: 'Hospicash Mini',
  underwriter: 'U', status: 'active', premium_kobo: 10000, starts_at: '2026-09-17T00:00:00Z',
  expires_at: '2026-10-17T00:00:00Z', provider_created_at: '2026-09-17T00:00:00Z', in_paymax: false, ...o,
});
const report = (policies = [policy()], ov: Record<string, unknown> = {}) => ({
  overview: { provider: 'mycover', total: policies.length, in_paymax: 0, not_in_paymax: policies.length, not_in_paymax_premium_kobo: 10000, last_synced_at: '2026-10-09T10:00:00Z', ...ov },
  policies,
});

describe('ProviderPoliciesPanel', () => {
  beforeEach(() => { mockGet.mockReset(); mockSync.mockReset(); });

  it('lists provider policies and says their premium is not revenue', async () => {
    mockGet.mockResolvedValue(report());
    render(<ProviderPoliciesPanel />);
    await waitFor(() => expect(screen.getByText('Hospicash Mini')).toBeTruthy());
    expect(screen.getByText('TESTGCM/OP/26/1')).toBeTruthy();
    expect(screen.getByText(/not in paymax/i)).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && /is not Paymax\s*revenue/i.test(el.textContent ?? ''))).toBeTruthy();
  });

  it('explains itself when the backend flag is off (route 404s)', async () => {
    mockGet.mockRejectedValue(new (InsuranceAdminError as unknown as new (s: number) => Error)(404));
    render(<ProviderPoliciesPanel />);
    await waitFor(() => expect(screen.getByText(/FEATURE_INSURANCE_PROVIDER_IMPORT_ENABLED/)).toBeTruthy());
  });

  it('invites the first sync when nothing is mirrored yet', async () => {
    mockGet.mockResolvedValue(report([], { total: 0, not_in_paymax: 0, last_synced_at: null }));
    render(<ProviderPoliciesPanel />);
    await waitFor(() => expect(screen.getByText(/Never synced/i)).toBeTruthy());
    expect(screen.getByText(/Nothing mirrored yet/i)).toBeTruthy();
  });

  it('Sync now calls the sync, reports the counts, and reloads the list', async () => {
    mockGet.mockResolvedValueOnce(report([], { total: 0, not_in_paymax: 0, last_synced_at: null })).mockResolvedValue(report());
    mockSync.mockResolvedValue({ provider: 'mycover', provider_total: 1, fetched: 1, inserted: 1, updated: 0, synced_at: '2026-10-09T10:00:00Z' });
    render(<ProviderPoliciesPanel />);
    await waitFor(() => expect(screen.getByText(/Nothing mirrored yet/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    await waitFor(() => expect(screen.getByText(/1 new, 0 refreshed/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Hospicash Mini')).toBeTruthy());
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('a 503 on sync says the API key is missing', async () => {
    mockGet.mockResolvedValue(report());
    mockSync.mockRejectedValue(new (InsuranceAdminError as unknown as new (s: number) => Error)(503));
    render(<ProviderPoliciesPanel />);
    await waitFor(() => expect(screen.getByText('Hospicash Mini')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/API key is not configured/i));
  });
});
