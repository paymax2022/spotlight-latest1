/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react';
import { AdminUsersRequestError } from '@/services/usersService';

vi.mock('@/services/usersService', () => ({
  AdminUsersRequestError: class extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
}));

const mockGetUserReferredBy = vi.fn();
vi.mock('@/services/userReferredByService', async () => {
  const actual = await vi.importActual<typeof import('@/services/userReferredByService')>('@/services/userReferredByService');
  return { ...actual, getUserReferredBy: (...a: unknown[]) => mockGetUserReferredBy(...a) };
});

import { ReferredByPanel } from './ReferredByPanel';

const panel = () => within(screen.getByTestId('referred-by-panel'));

describe('ReferredByPanel', () => {
  beforeEach(() => mockGetUserReferredBy.mockReset());
  afterEach(() => cleanup());

  it('shows the referrer and the code they used, linked to the referrer', async () => {
    mockGetUserReferredBy.mockResolvedValue({
      user_id: 'u1', attributed: true, is_house: false, referrer_id: 'r1', referrer_name: 'Ada Obi',
      referrer_code: 'K7QX2', code_used: 'K7QX2', attribution_type: 'code', attributed_at: '2026-10-01T10:00:00Z', status: 'locked',
    });
    render(<ReferredByPanel userId="u1" />);
    await waitFor(() => expect(panel().getByTestId('referred-by-title').textContent).toBe('Ada Obi'));
    expect(mockGetUserReferredBy).toHaveBeenCalledWith('u1');
    expect(panel().getByRole('link').getAttribute('href')).toBe('/admin/users/r1');
    expect(panel().getByTestId('referred-by-detail').textContent).toBe('entered K7QX2 · code K7QX2');
  });

  it('a codeless user shows Admin and no link', async () => {
    mockGetUserReferredBy.mockResolvedValue({
      user_id: 'u1', attributed: true, is_house: true, house_code: 'SPOT-HOUSE', attribution_type: 'global_house', status: 'grace',
      attributed_at: '2026-10-01T10:00:00Z',
    });
    render(<ReferredByPanel userId="u1" />);
    await waitFor(() => expect(panel().getByTestId('referred-by-title').textContent).toBe('Admin (house account)'));
    expect(panel().queryByRole('link')).toBeNull();
    expect(panel().getByText(/can still claim a code/)).toBeTruthy();
  });

  it('an unattributed user says so', async () => {
    mockGetUserReferredBy.mockResolvedValue({ user_id: 'u1', attributed: false, is_house: false });
    render(<ReferredByPanel userId="u1" />);
    await waitFor(() => expect(panel().getByTestId('referred-by-title').textContent).toBe('Not attributed yet'));
  });

  it('403 shows the permission placeholder, no Retry', async () => {
    mockGetUserReferredBy.mockRejectedValueOnce(new AdminUsersRequestError(403, 'forbidden'));
    render(<ReferredByPanel userId="u1" />);
    await waitFor(() => expect(panel().getByText("You don't have permission to view this.")).toBeTruthy());
    expect(panel().queryByText('Retry')).toBeNull();
  });

  it('an error shows Retry that refetches', async () => {
    mockGetUserReferredBy.mockRejectedValueOnce(new Error('boom'));
    mockGetUserReferredBy.mockResolvedValue({ user_id: 'u1', attributed: false, is_house: false });
    render(<ReferredByPanel userId="u1" />);
    await waitFor(() => expect(panel().getByText('boom')).toBeTruthy());
    fireEvent.click(panel().getByText('Retry'));
    await waitFor(() => expect(panel().getByTestId('referred-by-title').textContent).toBe('Not attributed yet'));
    expect(mockGetUserReferredBy).toHaveBeenCalledTimes(2);
  });
});
