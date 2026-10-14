/**
 * Crypto fee-schedule tab. Pricing configuration, so: the operator reviews a before/after
 * diff before anything is sent, a reason is mandatory, a stale schedule reloads instead of
 * overwriting, and a user without crypto.admin can read but not change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CryptoFeeScheduleResponse, CryptoFeeScheduleVersion } from '@/types/cryptoAdmin';

let canAdmin = true;
vi.mock('../_ui', async () => ({
  ...(await vi.importActual<typeof import('../_ui')>('../_ui')),
  useCryptoPermission: () => ({ allowed: canAdmin }),
}));

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/services/cryptoAdminService', async () => ({
  ...(await vi.importActual<typeof import('@/services/cryptoAdminService')>('@/services/cryptoAdminService')),
  adminGetFeeSchedule: (...a: unknown[]) => mockGet(...a),
  adminUpdateFeeSchedule: (...a: unknown[]) => mockUpdate(...a),
}));

import { FeeScheduleConflictError } from '@/services/cryptoAdminService';
import FeesPage from './page';

const V3: CryptoFeeScheduleVersion = {
  version: 3, major_bps: 75, other_bps: 100, majors: ['BTC', 'ETH', 'USDC', 'USDT'], overrides: { DOGE: 140 },
  reason: 'Q3 review', created_by: 'admin-1', created_at: '2026-10-01T09:00:00Z',
};
const V2: CryptoFeeScheduleVersion = { ...V3, version: 2, major_bps: 70, overrides: {}, reason: 'Initial pricing', created_by: 'admin-0' };
const RESP: CryptoFeeScheduleResponse = { current: V3, ceiling_bps: 150, history: [V3, V2] };

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

async function mounted(resp: CryptoFeeScheduleResponse | null = RESP) {
  mockGet.mockResolvedValue(resp);
  render(<FeesPage />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  if (resp) await screen.findByText(/Crypto — Fee Schedule/);
}

beforeEach(() => { canAdmin = true; mockGet.mockReset(); mockUpdate.mockReset(); });
afterEach(() => cleanup());

describe('FeesPage — reading', () => {
  it('shows the live rates in percent, the hard ceiling and the version', async () => {
    await mounted();
    expect((await screen.findByTestId('kpi-major')).textContent).toContain('0.75%');
    expect(screen.getByTestId('kpi-other').textContent).toContain('1.00%');
    expect(screen.getByTestId('kpi-ceiling').textContent).toContain('1.50%');
    expect(screen.getByTestId('kpi-version').textContent).toContain('3');
  });

  it('lists the history with who changed what and why', async () => {
    await mounted();
    expect(await screen.findByText('Initial pricing')).toBeTruthy();
    expect(screen.getByText('admin-0')).toBeTruthy();
    expect(screen.getAllByText('Q3 review').length).toBeGreaterThan(0);
  });

  it('says so when the pipeline is not mounted instead of showing an empty form', async () => {
    await mounted(null);
    expect(await screen.findByText(/Fee schedule is unavailable/i)).toBeTruthy();
    expect(screen.queryByLabelText('Major markup (bps)')).toBeNull();
  });

  it('shows a load error', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    render(<FeesPage />);
    expect(await screen.findByText(/boom/)).toBeTruthy();
  });
});

describe('FeesPage — permissions', () => {
  it('lets a viewer read but not change anything', async () => {
    canAdmin = false;
    await mounted();
    expect(await screen.findByText(/You lack/)).toBeTruthy();
    expect(field('Major markup (bps)').disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Review change' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('FeesPage — editing', () => {
  async function edit(major = '80', reason = 'Q4 pricing review') {
    await mounted();
    await screen.findByLabelText('Major markup (bps)');
    fireEvent.change(field('Major markup (bps)'), { target: { value: major } });
    if (reason) fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: reason } });
  }

  it('starts with nothing to review: no change, no reason', async () => {
    await mounted();
    await screen.findByLabelText('Major markup (bps)');
    expect((screen.getByRole('button', { name: 'Review change' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('will not review a change without a reason', async () => {
    await edit('80', '');
    expect((screen.getByRole('button', { name: 'Review change' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('blocks a rate above the ceiling with an inline message and never reaches the service', async () => {
    await edit('151');
    expect(await screen.findByText(/at most 150/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review change' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('shows a before/after diff first, and sends nothing until the operator confirms', async () => {
    await edit();
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    expect(await screen.findByText(/Confirm fee change/i)).toBeTruthy();
    expect(screen.getByTestId('diff-major').textContent).toContain('0.75%');
    expect(screen.getByTestId('diff-major').textContent).toContain('0.80%');
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('applies the change against the version the operator loaded, then reloads', async () => {
    mockUpdate.mockResolvedValue({ ...V3, version: 4, major_bps: 80, reason: 'Q4 pricing review' });
    await edit();
    mockGet.mockResolvedValue({ current: { ...V3, version: 4, major_bps: 80 }, ceiling_bps: 150, history: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      expected_version: 3, major_bps: 80, other_bps: 100, reason: 'Q4 pricing review', overrides: { DOGE: 140 },
    }), 150);
    expect(await screen.findByText(/updated to version 4/i)).toBeTruthy();
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('reloads instead of overwriting when someone else changed the schedule first', async () => {
    mockUpdate.mockRejectedValue(new FeeScheduleConflictError());
    await edit();
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));
    expect(await screen.findByText(/changed since you loaded it/i)).toBeTruthy();
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('keeps the form and shows the error when the server refuses', async () => {
    mockUpdate.mockRejectedValue(new Error('invalid_fee_schedule'));
    await edit();
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));
    expect(await screen.findByText(/invalid_fee_schedule/)).toBeTruthy();
    expect(field('Major markup (bps)').value).toBe('80');
  });

  it('edits overrides: add, change and remove', async () => {
    await mounted();
    await screen.findByLabelText('Major markup (bps)');
    fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
    fireEvent.change(screen.getByLabelText('Override asset 2'), { target: { value: 'shib' } });
    fireEvent.change(screen.getByLabelText('Override bps 2'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove override 1' }));
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'swap DOGE for SHIB' } });
    mockUpdate.mockResolvedValue({ ...V3, version: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0].overrides).toEqual({ SHIB: 120 });
  });

  it('rejects two overrides for the same asset', async () => {
    await mounted();
    await screen.findByLabelText('Major markup (bps)');
    fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
    fireEvent.change(screen.getByLabelText('Override asset 2'), { target: { value: 'doge' } });
    fireEvent.change(screen.getByLabelText('Override bps 2'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'dup' } });
    expect(await screen.findByText(/more than once/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review change' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
