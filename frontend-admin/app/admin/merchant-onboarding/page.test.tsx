/**
 * The module/type dropdowns used to be hard-coded guesses ('restaurant',
 * 'food_vendor') that match no real id (mod-food, mt-restaurant), so choosing
 * "Restaurant Delivery" returned nothing and a pending restaurant-owner
 * application looked missing. Options now come from the queue itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockListReviewQueue = vi.fn();

vi.mock('@/services/onboardingService', () => ({
  listReviewQueue: (...args: unknown[]) => mockListReviewQueue(...args),
  ageFromNow: () => '1d',
  slaBreached: () => false,
}));

import MerchantOnboardingQueuePage from './page';

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'app-1',
  applicantName: 'Ngozi Eze',
  moduleId: 'mod-food',
  moduleName: 'Food & Logistics',
  merchantTypeId: 'mt-restaurant',
  merchantTypeName: 'Restaurant',
  status: 'SUBMITTED',
  riskLevel: null,
  submittedAt: '2026-10-06T00:00:00Z',
  createdAt: '2026-10-06T00:00:00Z',
  ...overrides,
});

const doctor = row({
  id: 'app-2', applicantName: 'Dr Bello', moduleId: 'mod-health', moduleName: 'Health',
  merchantTypeId: 'mt-doctor', merchantTypeName: 'Medical Practitioner',
});

describe('MerchantOnboardingQueuePage filters', () => {
  beforeEach(() => {
    mockListReviewQueue.mockReset();
    mockListReviewQueue.mockResolvedValue([row(), doctor]);
  });

  it('lists the real modules and types found in the queue', async () => {
    render(<MerchantOnboardingQueuePage />);
    await waitFor(() => expect(screen.getByText('Ngozi Eze')).toBeTruthy());
    expect(screen.getByRole('option', { name: 'Food & Logistics' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Health' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Restaurant Delivery' })).toBeNull();
  });

  it('choosing a module narrows the list without hiding that module\'s applications', async () => {
    render(<MerchantOnboardingQueuePage />);
    await waitFor(() => expect(screen.getByText('Ngozi Eze')).toBeTruthy());
    const [moduleSelect] = screen.getAllByRole('combobox');
    fireEvent.change(moduleSelect, { target: { value: 'mod-food' } });
    expect(screen.getByText('Ngozi Eze')).toBeTruthy();
    expect(screen.queryByText('Dr Bello')).toBeNull();
  });

  it('does not send module or type to the server', async () => {
    render(<MerchantOnboardingQueuePage />);
    await waitFor(() => expect(mockListReviewQueue).toHaveBeenCalled());
    expect(mockListReviewQueue).toHaveBeenCalledWith({ status: '', age: '' });
  });
});
