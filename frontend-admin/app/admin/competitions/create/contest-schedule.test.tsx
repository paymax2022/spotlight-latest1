/**
 * The contest window and the prize in the real contest editor.
 *
 * `loadContest()` and `initialForm()` are explicit field whitelists, and that is
 * exactly how a field goes missing without any error: the server returns
 * startDate/endDate/prizePool, the page copies the keys it knows about, and the
 * form then sends a payload without them. The schedule was invisible this way —
 * an admin could see a deadline in the recent-contests table and find no field
 * for it one row above.
 *
 * These tests pin the three things that make the write path real:
 *  - a stored instant is displayed as its day (the input is a day, not a moment),
 *  - an unrelated edit resends the instant VERBATIM, so changing a title cannot
 *    quietly move or truncate a deadline,
 *  - a freshly picked day is sent as that bare day, which the route expands to
 *    the day's last instant for the end bound.
 *
 * Service mocks follow app/admin/registration/page.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGetFullContest = vi.fn();
const mockUpdateFullContest = vi.fn();
const mockCreateFullContest = vi.fn();

// An `id` query param is what puts this page in edit mode; creation mode needs a
// separate case because initialForm() is its own field whitelist.
let queryString = 'id=rising-star-2026';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(queryString),
}));

vi.mock('@/services/contestsAdminService', () => ({
  createFullContest: (...a: unknown[]) => mockCreateFullContest(...a),
  updateFullContest: (...a: unknown[]) => mockUpdateFullContest(...a),
  deleteFullContest: vi.fn(),
  getFullContest: (...a: unknown[]) => mockGetFullContest(...a),
  setContestStatus: vi.fn(),
  listAdminContests: vi.fn(async () => ({ contests: [] })),
  uploadContestBanner: vi.fn(),
  uploadContestLogo: vi.fn(),
  adminMediaUrl: (u: string) => u,
  listContestStages: vi.fn(async () => []),
  createContestStage: vi.fn(),
  deleteContestStage: vi.fn(),
  advanceStageSurvivors: vi.fn(),
}));

vi.mock('@/services/competitionsService', () => ({
  triggerStageEviction: vi.fn(),
  finalizeStageEvictions: vi.fn(),
  getContestEvictions: vi.fn(async () => []),
  saveContestantFromEviction: vi.fn(),
  extendGracePeriod: vi.fn(),
}));

vi.mock('@/services/votePackagesService', () => ({
  listVotePackageTemplates: vi.fn(async () => []),
  applyTemplatesToContest: vi.fn(),
  listVotePackages: vi.fn(async () => []),
  formatNaira: (n: number) => `₦${n}`,
}));

vi.mock('@/services/contestCategoriesService', () => ({
  listContestCategories: vi.fn(async () => []),
}));

import CreateCompetitionPage from './page';

const stored = {
  id: 'contest-1',
  slug: 'rising-star-2026',
  title: 'Rising Star 2026',
  contestCategory: 'other',
  contestType: 'public_voting_contest',
  seasonOrEdition: 'Season 1',
  regionScope: 'national',
  isPaid: false,
  registrationFeeNgn: 0,
  legalAdultAge: 18,
  supportsVoting: true,
  supportsAuditionScheduling: false,
  supportsGroupEntry: false,
  supportsSchoolEntry: false,
  requiresGuardianConsentForMinors: false,
  requiresMedical: false,
  requiresBootcampReadiness: false,
  auditionStates: [],
  applicantCategories: [],
  rulesText: '',
  bannerImageUrl: '',
  logoUrl: '',
  status: 'upcoming',
  // Exactly what the API returns after the schedule routes went in: UTC instants,
  // the end bound being the LAST INSTANT of 24 December.
  startDate: '2026-12-01T00:00:00.000Z',
  endDate: '2026-12-24T23:59:59.999Z',
  prizePool: '₦500,000 + a management deal',
};

beforeEach(() => {
  queryString = 'id=rising-star-2026';
  mockGetFullContest.mockReset().mockResolvedValue({ ...stored });
  mockUpdateFullContest.mockReset().mockResolvedValue({ ...stored });
  mockCreateFullContest.mockReset().mockResolvedValue({ ...stored });
});

describe('contest window and prize in the editor', () => {
  it('shows a stored deadline as its day, and the prize verbatim', async () => {
    render(<CreateCompetitionPage />);
    const start = await screen.findByLabelText('Contest start date');
    expect(start).toHaveValue('2026-12-01');
    expect(screen.getByLabelText('Contest end date')).toHaveValue('2026-12-24');
    expect(screen.getByLabelText('Price to be won')).toHaveValue('₦500,000 + a management deal');
  });

  it('resends the stored instants untouched when the dates are not edited', async () => {
    render(<CreateCompetitionPage />);
    await screen.findByLabelText('Contest start date');
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(mockUpdateFullContest).toHaveBeenCalled());
    const [, payload] = mockUpdateFullContest.mock.calls[0];
    expect(payload).toMatchObject({
      startDate: '2026-12-01T00:00:00.000Z',
      endDate: '2026-12-24T23:59:59.999Z',
      prizePool: '₦500,000 + a management deal',
    });
  });

  it('sends a newly picked day as the bare day the route expands', async () => {
    render(<CreateCompetitionPage />);
    const end = await screen.findByLabelText('Contest end date');
    fireEvent.change(end, { target: { value: '2027-01-31' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(mockUpdateFullContest).toHaveBeenCalled());
    const [, payload] = mockUpdateFullContest.mock.calls[0];
    expect(payload.endDate).toBe('2027-01-31');
  });

  // save() refuses an untitled contest, so both create cases type a title first
  // (which also auto-derives the slug). The title is the first textbox in the
  // form; the prize input added below it is the only other one.
  function fillTitleAndCreate() {
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Rising Star 2027' } });
    fireEvent.click(screen.getByText('Create competition'));
  }

  it('sends the schedule keys on create even when nothing is typed', async () => {
    // Create mode: initialForm() is a separate whitelist from loadContest(), and
    // a missing key here is what makes the route read "the caller does not manage
    // the schedule" for a contest the admin just decided has no deadline.
    queryString = '';
    render(<CreateCompetitionPage />);
    const start = await screen.findByLabelText('Contest start date');
    expect(start).toHaveValue('');
    fillTitleAndCreate();
    await waitFor(() => expect(mockCreateFullContest).toHaveBeenCalled());
    const payload = mockCreateFullContest.mock.calls[0][0];
    expect(payload).toHaveProperty('startDate', '');
    expect(payload).toHaveProperty('endDate', '');
    expect(payload).toHaveProperty('prizePool', '');
  });

  it('sends a day picked during creation', async () => {
    queryString = '';
    render(<CreateCompetitionPage />);
    const start = await screen.findByLabelText('Contest start date');
    fireEvent.change(start, { target: { value: '2027-02-01' } });
    fillTitleAndCreate();
    await waitFor(() => expect(mockCreateFullContest).toHaveBeenCalled());
    expect(mockCreateFullContest.mock.calls[0][0]).toHaveProperty('startDate', '2027-02-01');
  });
});
