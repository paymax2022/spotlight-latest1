/**
 * The Type dropdown and a contest whose stored type is not in the catalog.
 *
 * public.contests.contest_type is one free-text column shared by two writers: the
 * registration console and the unified contest engine ('general' is its DEFAULT,
 * and 'multi_skill' / 'reality_tv_show' / 'STEM' are what other planes store).
 * The editor's TYPES list only ever held the twelve registration engine types.
 *
 * A <select> whose value matches no option shows its FIRST option while the
 * component keeps the real value, so opening Nollywood Rising Star displayed
 * "online_contest", held "multi_skill", and saving — with nothing touched —
 * reported "Updating contest failed: Invalid contest type.". The route now accepts
 * a type the caller did not change; these tests pin the other half: the dropdown
 * must show the truth, and must hand back exactly what it was given.
 *
 * Service mocks follow ./contest-schedule.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGetFullContest = vi.fn();
const mockUpdateFullContest = vi.fn();
const mockCreateFullContest = vi.fn();

let queryString = 'id=nollywood-rising-star';

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
  listAdminContests: vi.fn(async () => []),
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

/** What GET /api/admin/contests/nollywood-rising-star answers today. */
function storedContest(over: Record<string, unknown> = {}) {
  return {
    id: 'contest-1',
    slug: 'nollywood-rising-star',
    title: 'Nollywood Rising Star',
    contestCategory: 'other',
    contestType: 'multi_skill',
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
    status: 'active',
    startDate: '',
    endDate: '',
    prizePool: '',
    ...over,
  };
}

beforeEach(() => {
  queryString = 'id=nollywood-rising-star';
  mockGetFullContest.mockReset();
  mockUpdateFullContest.mockReset().mockResolvedValue(storedContest());
  mockCreateFullContest.mockReset().mockResolvedValue(storedContest());
});

describe('the Type dropdown with a stored engine type', () => {
  it('shows the type the contest actually carries, not the first option', async () => {
    mockGetFullContest.mockResolvedValue(storedContest());
    render(<CreateCompetitionPage />);

    const type = await screen.findByLabelText('Contest type');
    expect(type).toHaveValue('multi_skill');
    // And says what it is, so nobody reads it as a catalog choice they can go back to.
    expect(screen.getByRole('option', { name: /multi_skill/ }).textContent)
      .toContain('not a standard type');
  });

  it('sends the stored type back untouched when Save is pressed with nothing edited', async () => {
    // The pair to the dropdown fix: the honest way to make this save would be to
    // rewrite the field to a real catalog type, which would quietly move the
    // contest onto a different engine and change the admin overview counts the Go
    // repository derives from contest_type. The value must travel unchanged.
    mockGetFullContest.mockResolvedValue(storedContest());
    render(<CreateCompetitionPage />);
    await screen.findByLabelText('Contest type');
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(mockUpdateFullContest).toHaveBeenCalled());
    expect(mockUpdateFullContest.mock.calls[0][1]).toMatchObject({ contestType: 'multi_skill' });
  });

  it('lists only the catalog types for a contest that carries one', async () => {
    mockGetFullContest.mockResolvedValue(storedContest({ contestType: 'public_voting_contest' }));
    render(<CreateCompetitionPage />);

    const type = await screen.findByLabelText('Contest type');
    expect(type).toHaveValue('public_voting_contest');
    expect(screen.queryByText(/not a standard type/)).toBeNull();
    expect(screen.queryAllByRole('option', { name: /multi_skill/ })).toHaveLength(0);
  });

  it('lets the admin move a legacy contest onto a catalog type', async () => {
    mockGetFullContest.mockResolvedValue(storedContest());
    render(<CreateCompetitionPage />);

    const type = await screen.findByLabelText('Contest type');
    fireEvent.change(type, { target: { value: 'online_contest' } });
    fireEvent.click(screen.getByText('Save changes'));

    await waitFor(() => expect(mockUpdateFullContest).toHaveBeenCalled());
    expect(mockUpdateFullContest.mock.calls[0][1]).toMatchObject({ contestType: 'online_contest' });
  });
});
