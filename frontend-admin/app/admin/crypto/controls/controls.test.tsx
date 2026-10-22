/**
 * Crypto controls tab. Safety configuration, so: the live state is unmistakable, a change is
 * reviewed as a plain-language list before it is sent, a reason is mandatory, a stale version
 * reloads instead of overwriting, and a user without crypto.admin can read but not change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CryptoControlsResponse, CryptoControlsVersion } from '@/types/cryptoAdmin';

let canAdmin = true;
vi.mock('../_ui', async () => ({
  ...(await vi.importActual<typeof import('../_ui')>('../_ui')),
  useCryptoPermission: () => ({ allowed: canAdmin }),
}));

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/services/cryptoOpsService', async () => ({
  ...(await vi.importActual<typeof import('@/services/cryptoOpsService')>('@/services/cryptoOpsService')),
  getControls: (...a: unknown[]) => mockGet(...a),
  updateControls: (...a: unknown[]) => mockUpdate(...a),
}));

import { ControlsConflictError } from '@/services/cryptoOpsService';
import ControlsPage from './page';

const CEIL = 1_000_000_000_00;
const V1: CryptoControlsVersion = {
  version: 1, trading_paused: false, withdrawals_paused: false, disabled_assets: ['DOGE'], max_quote_kobo: CEIL,
  banner: null, reason: 'initial', created_by: 'admin-0', created_at: '2026-10-20T09:00:00Z',
};
const RESP: CryptoControlsResponse = { current: V1, ceiling_kobo: CEIL, history: [V1] };

async function mounted(resp: CryptoControlsResponse | null = RESP) {
  mockGet.mockResolvedValue(resp);
  render(<ControlsPage />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  if (resp) await screen.findByTestId('breaker-trading');
}
const reason = () => screen.getByLabelText(/Reason/) as HTMLTextAreaElement;

beforeEach(() => { canAdmin = true; mockGet.mockReset(); mockUpdate.mockReset(); });
afterEach(() => cleanup());

describe('ControlsPage', () => {
  it('shows the live state of each breaker and the switched-off markets', async () => {
    await mounted();
    expect(screen.getByTestId('breaker-trading').textContent).toContain('Live');
    expect(screen.getByTestId('breaker-withdrawals').textContent).toContain('Live');
    expect(screen.getByTestId('disabled-markets').textContent).toContain('DOGE');
  });

  it('halting needs a reason and a review, then sends the whole state with the version read', async () => {
    mockUpdate.mockResolvedValue({ created: true, current: { ...V1, version: 2, withdrawals_paused: true } });
    await mounted();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on kill switch' }));
    expect(screen.getByTestId('breaker-withdrawals').textContent).toContain('Halted (unsaved)');
    expect(screen.getByTestId('controls-diff').textContent).toContain('Turn on the withdrawal kill switch');
    const review = screen.getByRole('button', { name: 'Review change' }) as HTMLButtonElement;
    expect(review.disabled).toBe(true); // no reason yet
    fireEvent.change(reason(), { target: { value: 'INC-212 TRC20 payouts failing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and apply now' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [sent, ceiling] = mockUpdate.mock.calls[0];
    expect(sent).toMatchObject({ expected_version: 1, withdrawals_paused: true, trading_paused: false, disabled_assets: ['DOGE'], max_quote_kobo: 0, reason: 'INC-212 TRC20 payouts failing' });
    expect(ceiling).toBe(CEIL);
  });

  it('builds a banner with a live preview and limits in whole naira', async () => {
    await mounted();
    fireEvent.click(screen.getByRole('button', { name: 'Add a banner' }));
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'Withdrawals are paused until 3pm.' } });
    expect(screen.getByTestId('banner-preview').textContent).toBe('Withdrawals are paused until 3pm.');
    fireEvent.change(screen.getByLabelText('Limit in naira'), { target: { value: '500,000' } });
    const diff = screen.getByTestId('controls-diff').textContent ?? '';
    expect(diff).toContain('₦500,000');
    expect(diff).toContain('warning banner');
  });

  it('a stale version reloads and explains instead of overwriting', async () => {
    mockUpdate.mockRejectedValue(new ControlsConflictError());
    await mounted();
    fireEvent.click(screen.getByRole('button', { name: 'Halt trading' }));
    fireEvent.change(reason(), { target: { value: 'incident' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and apply now' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/changed the controls since you loaded them/);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('read-only without crypto.admin', async () => {
    canAdmin = false;
    await mounted();
    expect((screen.getByRole('button', { name: 'Halt trading' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/You lack/)).toBeTruthy();
  });

  it('says so when crypto is not enabled here', async () => {
    await mounted(null);
    expect(await screen.findByText(/Controls are unavailable/)).toBeTruthy();
  });
});
