/**
 * Locality in the real contest editor: "a contest can be a local contest within a
 * defined local government" (the operator's words) has to be pickable here, because
 * this page is the only surface that writes public.contests.
 *
 * WHY THESE TESTS EXIST, in one line each:
 *
 *   * The scope select was a hardcoded four-item list, so even with 'lga'/'village'
 *     accepted by the API an admin could never choose them;
 *   * `loadContest()` and `initialForm()` are explicit field whitelists — the exact
 *     mechanism by which the schedule went missing (see ./contest-schedule.test.tsx).
 *     A locality contest that hydrates without its triple then SAVES without it, and
 *     the write boundary refuses the edit outright: "A local contest needs its
 *     state." on a contest that already has one;
 *   * the cascade has to clear its own deeper tiers, or an admin who changes the
 *     state keeps an LGA from the previous one and publishes a locality that does not
 *     exist;
 *   * an LGA the reference table does not list must survive a round trip — same
 *     tolerance the PATCH route gives a stored contest_type. Rejecting it would ask
 *     the admin to fix a field they never touched;
 *   * going back to 'national' sends an empty triple rather than omitting the keys,
 *     because omitting is what leaves a stale quarter on a national contest.
 *
 * Service mocks follow ./contest-schedule.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const mockGetFullContest = vi.fn();
const mockUpdateFullContest = vi.fn();
const mockCreateFullContest = vi.fn();
const mockListLocalGovernments = vi.fn();
const mockListVillages = vi.fn();

let queryString = 'id=onitsha-north-open-mic';

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

vi.mock('@/services/localityAdminService', () => ({
  listLocalGovernments: (...a: unknown[]) => mockListLocalGovernments(...a),
  listVillages: (...a: unknown[]) => mockListVillages(...a),
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
  id: 'contest-9',
  slug: 'onitsha-north-open-mic',
  title: 'Onitsha North Open Mic',
  contestCategory: 'other',
  contestType: 'public_voting_contest',
  seasonOrEdition: 'Season 1',
  regionScope: 'lga',
  localityState: 'Anambra',
  localityLga: 'Onitsha North',
  localityVillage: '',
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
  startDate: '',
  endDate: '',
  prizePool: '',
};

const anambraLgas = ['Awka North', 'Awka South', 'Onitsha North', 'Onitsha South'];
const ogbendida = 'Ogbendida';

beforeEach(() => {
  queryString = 'id=onitsha-north-open-mic';
  mockGetFullContest.mockReset().mockResolvedValue({ ...stored });
  mockUpdateFullContest.mockReset().mockResolvedValue({ ...stored });
  mockCreateFullContest.mockReset().mockResolvedValue({ ...stored });
  mockListLocalGovernments.mockReset().mockResolvedValue({ mode: 'curated', lgas: [...anambraLgas] });
  mockListVillages.mockReset().mockResolvedValue({ mode: 'curated', villages: [ogbendida, 'Isiokwe'] });
});

async function openEditor(): Promise<HTMLSelectElement> {
  render(<CreateCompetitionPage />);
  const el = (await screen.findByLabelText('Region scope')) as HTMLSelectElement;
  // 'Region scope' is in the initial render; the stored contest is not. Draining here is
  // what makes every test below read a hydrated form instead of racing the load effect.
  await settle();
  return el;
}

/*
  Both locality tiers load in an effect. A test that finishes while that promise is still
  in the air leaves React committing to a mounted tree outside act(), which is what the six
  "not wrapped in act" warnings were: noise that also means an assertion ran against a
  half-loaded form. settle() drains the queue inside act(), so every test below reads the
  form the way it stands one frame after the admin's click.
*/
async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function pickScope(value: string): Promise<HTMLSelectElement> {
  const el = await openEditor();
  fireEvent.change(el, { target: { value } });
  // A local scope starts the LGA fetch, and both modes render a labelled control, so
  // without this drain an assertion cannot tell a fetched list from a pending one.
  await settle();
  return el;
}

describe('region scope offers the local tiers', () => {
  it('lists lga and village as choices an admin can actually pick', async () => {
    const el = await openEditor();
    const names = within(el).getAllByRole('option').map((o) => o.textContent);
    expect(names.some((n) => /local government/i.test(n ?? ''))).toBe(true);
    expect(names.some((n) => /village/i.test(n ?? ''))).toBe(true);
    expect(within(el).getByRole('option', { name: /local government/i })).toHaveValue('lga');
    expect(within(el).getByRole('option', { name: /village/i })).toHaveValue('village');
  });

  it('asks for the locality only once the scope claims one', async () => {
    // Create mode on purpose: the edit fixture is already an 'lga' contest, so a
    // rendered locality block there proves nothing about the reveal rule.
    queryString = '';
    await openEditor();
    expect(screen.queryByLabelText('Contest state of origin')).toBeNull();

    fireEvent.change(await screen.findByLabelText('Region scope'), { target: { value: 'village' } });
    await settle();
    expect(screen.getByLabelText('Contest state of origin')).toBeInTheDocument();
    expect(await screen.findByLabelText('Contest local government')).toBeInTheDocument();
    expect(await screen.findByLabelText('Contest village')).toBeInTheDocument();
  });

  // The write boundary forces locality_village='' for an LGA-scoped contest, so an
  // input the server is going to throw away would be a control that lies.
  it('does not ask a whole-LGA contest for a village', async () => {
    await pickScope('lga');
    await settle();
    expect(screen.getByLabelText('Contest local government')).toBeInTheDocument();
    expect(screen.queryByLabelText('Contest village')).toBeNull();
  });
});

describe('the state -> LGA -> village cascade', () => {
  it('fills the LGA list from the chosen state', async () => {
    await pickScope('village');
    const state = await screen.findByLabelText('Contest state of origin');
    fireEvent.change(state, { target: { value: 'Lagos' } });

    await waitFor(() => expect(mockListLocalGovernments).toHaveBeenCalledWith('Lagos'));
    expect(await screen.findByLabelText('Contest local government')).toBeInTheDocument();
  });

  it('clears the deeper tiers when the state changes, so no LGA is inherited', async () => {
    await openEditor();
    const lga = await screen.findByLabelText('Contest local government');
    expect(lga).toHaveValue('Onitsha North');

    fireEvent.change(await screen.findByLabelText('Contest state of origin'), { target: { value: 'Lagos' } });
    expect(await screen.findByLabelText('Contest local government')).toHaveValue('');
  });

  it('offers the curated villages for the LGA as choices', async () => {
    await pickScope('village');
    const state = await screen.findByLabelText('Contest state of origin');
    fireEvent.change(state, { target: { value: 'Anambra' } });
    // A combobox, not just "the labelled control": the field is a text box until the
    // list arrives, and React drops a change aimed at the node the re-render replaced.
    const lga = await screen.findByRole('combobox', { name: 'Contest local government' });
    fireEvent.change(lga, { target: { value: 'Onitsha North' } });

    await waitFor(() => expect(mockListVillages).toHaveBeenCalledWith('Anambra', 'Onitsha North'));
    const village = await screen.findByLabelText('Contest village');
    expect(within(village as HTMLSelectElement).getByRole('option', { name: ogbendida })).toBeInTheDocument();
  });

  it('turns the village into a text box when the LGA has no curated quarters', async () => {
    mockListVillages.mockResolvedValue({ mode: 'free_text', villages: [] });
    await pickScope('village');
    const lga = await screen.findByRole('combobox', { name: 'Contest local government' });
    fireEvent.change(lga, { target: { value: 'Onitsha South' } });
    await waitFor(() => expect(mockListVillages).toHaveBeenCalledWith('Anambra', 'Onitsha South'));

    // The answer under test is the server's, not the pre-fetch default: an unanswered
    // village list also renders a text box, so this waits for the call to land before
    // claiming free_text came from the data.
    await settle();
    const village = screen.getByLabelText('Contest village');
    expect(village.tagName).toBe('INPUT');
    fireEvent.change(village, { target: { value: 'A typed quarter' } });

    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(mockUpdateFullContest).toHaveBeenCalled());
    expect(mockUpdateFullContest.mock.calls[0][1]).toMatchObject({ localityVillage: 'A typed quarter' });
  });
});

describe('a stored local contest survives an unrelated edit', () => {
  it('hydrates the triple and resends it verbatim', async () => {
    await openEditor();
    expect(await screen.findByLabelText('Contest state of origin')).toHaveValue('Anambra');
    expect(await screen.findByLabelText('Contest local government')).toHaveValue('Onitsha North');

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Onitsha North Open Mic 2027' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(mockUpdateFullContest).toHaveBeenCalled());
    expect(mockUpdateFullContest.mock.calls[0][1]).toMatchObject({
      regionScope: 'lga',
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
    });
  });

  it('keeps an LGA the reference table does not know instead of blanking it', async () => {
    mockGetFullContest.mockResolvedValue({ ...stored, localityState: 'Anambra', localityLga: 'A Newly Split LGA' });
    mockListLocalGovernments.mockResolvedValue({ mode: 'curated', lgas: [...anambraLgas] });
    await openEditor();

    const lga = await screen.findByLabelText('Contest local government');
    expect(lga).toHaveValue('A Newly Split LGA');

    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(mockUpdateFullContest).toHaveBeenCalled());
    expect(mockUpdateFullContest.mock.calls[0][1]).toMatchObject({ localityLga: 'A Newly Split LGA' });
  });

  it('clears the triple when the scope goes back to national', async () => {
    const scope = await openEditor();
    await screen.findByLabelText('Contest local government');
    fireEvent.change(scope, { target: { value: 'national' } });

    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(mockUpdateFullContest).toHaveBeenCalled());
    expect(mockUpdateFullContest.mock.calls[0][1]).toMatchObject({
      regionScope: 'national',
      localityState: '',
      localityLga: '',
      localityVillage: '',
    });
  });
});

describe('creating a local contest', () => {
  it('sends the locality an admin picks on a new contest', async () => {
    queryString = '';
    mockGetFullContest.mockResolvedValue(null);
    render(<CreateCompetitionPage />);

    // Each tier is waited for as a SELECT, not merely as "a control with that label":
    // the field starts as a text box and becomes a dropdown when the fetch lands, and
    // firing a change at the node that React has already replaced is silently dropped
    // by its delegated listener. Waiting for the combobox is both the stable handle and
    // the assertion that an admin gets real choices rather than a blank box.
    fireEvent.change(await screen.findByLabelText('Region scope'), { target: { value: 'village' } });
    fireEvent.change(await screen.findByLabelText('Contest state of origin'), { target: { value: 'Anambra' } });

    const lga = await screen.findByRole('combobox', { name: 'Contest local government' });
    fireEvent.change(lga, { target: { value: 'Onitsha North' } });

    const village = await screen.findByRole('combobox', { name: 'Contest village' });
    fireEvent.change(village, { target: { value: ogbendida } });

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Ogbendida Talent Search' } });
    fireEvent.click(screen.getByText('Create competition'));
    await waitFor(() => expect(mockCreateFullContest).toHaveBeenCalled());
    expect(mockCreateFullContest.mock.calls[0][0]).toMatchObject({
      regionScope: 'village',
      localityState: 'Anambra',
      localityLga: 'Onitsha North',
      localityVillage: ogbendida,
    });
  });
});
