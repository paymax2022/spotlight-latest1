/**
 * Integration test for RegistrationApplicantsPage (AD-006 / TS-14).
 * Mocks registrationAdminService so no network calls are made — the review
 * endpoint itself is covered server-side by
 * frontend-web/tests/unit/registration/review-workflow-rbac.spec.ts (RG-006).
 * This pins the UI contract: pending applicants render per contest, and
 * approve/reject send the review note along with the chosen status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockListRegistrationApplications = vi.fn();
const mockListRegistrationContests = vi.fn();
const mockReviewRegistrationApplication = vi.fn();

vi.mock('@/services/registrationAdminService', () => ({
  listRegistrationApplications: (...args: unknown[]) => mockListRegistrationApplications(...args),
  listRegistrationContests: (...args: unknown[]) => mockListRegistrationContests(...args),
  reviewRegistrationApplication: (...args: unknown[]) => mockReviewRegistrationApplication(...args),
}));

import RegistrationApplicantsPage from './page';

const makeApplication = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'app1',
  reference: 'REG-0001',
  contestSlug: 'open-mic-competition',
  status: 'submitted',
  role: 'contestant',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  formData: {
    'personal.firstName': 'Ada Lovelace',
    'personal.email': 'ada@example.com',
    'personal.state': 'Lagos',
  },
  completionPercent: 100,
  fraudFlags: [],
  ...overrides,
});

describe('RegistrationApplicantsPage', () => {
  beforeEach(() => {
    mockListRegistrationApplications.mockReset();
    mockListRegistrationContests.mockReset();
    mockReviewRegistrationApplication.mockReset();
    mockListRegistrationContests.mockResolvedValue([]);
    mockListRegistrationApplications.mockResolvedValue([]);
  });

  it('renders a pending applicant row after loading', async () => {
    mockListRegistrationApplications.mockResolvedValue([makeApplication()]);
    render(<RegistrationApplicantsPage />);
    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    });
    expect(screen.getByText(/ada@example.com/)).toBeTruthy();
    expect(screen.getByText('submitted')).toBeTruthy();
  });

  it('an empty contest says so instead of looking broken', async () => {
    render(<RegistrationApplicantsPage />);
    await waitFor(() => {
      expect(screen.getByText(/No applicants found/i)).toBeTruthy();
    });
  });

  it('opens the review panel and approves with the entered note', async () => {
    mockListRegistrationApplications.mockResolvedValue([makeApplication()]);
    mockReviewRegistrationApplication.mockResolvedValue(makeApplication({ status: 'approved' }));

    render(<RegistrationApplicantsPage />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.change(screen.getByPlaceholderText(/review note/i), { target: { value: 'Strong audition tape' } });
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));

    await waitFor(() => {
      expect(mockReviewRegistrationApplication).toHaveBeenCalledWith('app1', {
        status: 'approved',
        note: 'Strong audition tape',
      });
    });
  });

  it('rejects an applicant with a reason', async () => {
    mockListRegistrationApplications.mockResolvedValue([makeApplication()]);
    mockReviewRegistrationApplication.mockResolvedValue(makeApplication({ status: 'rejected' }));

    render(<RegistrationApplicantsPage />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    fireEvent.change(screen.getByPlaceholderText(/review note/i), { target: { value: 'Incomplete profile' } });
    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));

    await waitFor(() => {
      expect(mockReviewRegistrationApplication).toHaveBeenCalledWith('app1', {
        status: 'rejected',
        note: 'Incomplete profile',
      });
    });
  });

  it('surfaces a load failure instead of rendering an empty table', async () => {
    mockListRegistrationApplications.mockRejectedValue(new Error('Loading applications failed: 500'));
    render(<RegistrationApplicantsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Loading applications failed: 500/i)).toBeTruthy();
    });
  });
});
