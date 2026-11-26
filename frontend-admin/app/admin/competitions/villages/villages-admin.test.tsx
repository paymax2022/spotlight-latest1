/**
 * The village console: the screen that makes the third tier of the locality cascade
 * maintainable instead of frozen.
 *
 * The migration seeded 15 Onitsha North quarters, and `public.villages` is the whole
 * curation — so "an LGA with rows is a dropdown, an LGA without them is a text box"
 * currently means exactly one LGA in the country has a dropdown. This page is how the
 * operator publishes the rest without a migration and a redeploy per quarter.
 *
 * What these tests pin, in order of the damage each prevents:
 *
 *   * nothing queries until the admin names an LGA — a state-wide read of the table is
 *     not what curation looks like, and an effect that fired on every keystroke would
 *     turn typing a name into a fetch storm;
 *   * the server's own sentence reaches the banner. /api/admin/villages answers 503
 *     "Feature 'localityVillages' is not available in this environment." when the flag is
 *     off and 403 when the account is not an admin: printing "Failed to load villages"
 *     over either would send an admin to the database instead of to the env var (the
 *     standing rule: name the actual problem);
 *   * a pasted list reports per name. Publishing 13 of 15 quarters and showing a bare
 *     success is how a misspelled quarter ends up missing from a national rollout;
 *   * retired rows stay on screen and say they are retired, because `is_active=false` is
 *     reversible only if it is visible;
 *   * a permanent delete needs a confirmation, since the picker for an LGA that loses its
 *     last row silently degrades to a text box for every applicant there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const mockListLocalGovernments = vi.fn();
const mockListManagedVillages = vi.fn();
const mockPublishVillages = vi.fn();
const mockUpdateManagedVillage = vi.fn();
const mockDeleteManagedVillage = vi.fn();

vi.mock('@/services/localityAdminService', () => ({
  listLocalGovernments: (...a: unknown[]) => mockListLocalGovernments(...a),
  listVillages: vi.fn(async () => ({ state: '', lga: '', mode: 'free_text' as const, villages: [] })),
}));

vi.mock('@/services/villagesAdminService', () => ({
  listManagedVillages: (...a: unknown[]) => mockListManagedVillages(...a),
  publishVillages: (...a: unknown[]) => mockPublishVillages(...a),
  updateManagedVillage: (...a: unknown[]) => mockUpdateManagedVillage(...a),
  deleteManagedVillage: (...a: unknown[]) => mockDeleteManagedVillage(...a),
}));

import VillagesPage from './page';

const OGBE = { id: 'v1', state: 'Anambra', lga: 'Onitsha North', name: 'Ogbendida', notes: '', is_active: true };
const RETIRED = { id: 'v2', state: 'Anambra', lga: 'Onitsha North', name: 'Owelle Ebo', notes: '', is_active: false };

function confirmWith(allowed: boolean) {
  return vi.spyOn(window, 'confirm').mockReturnValue(allowed);
}

/** Let the cascade's promise settle inside act(), so React never commits outside it. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function pickState(value = 'Anambra'): Promise<void> {
  const select = (await screen.findByRole('combobox', { name: 'State' })) as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
  await settle();
}

async function pickLga(value = 'Onitsha North'): Promise<void> {
  const select = (await screen.findByRole('combobox', { name: 'Local government' })) as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
  await settle();
}

async function showQuarters(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /show quarters/i }));
  await settle();
}

/**
 * Per-row scoping: the table renders one Rename/Delete button per quarter, so a
 * document-wide query finds two of them. Grabbing the <tr> is what an admin actually
 * does — they act on a named row.
 */
function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr');
  if (!row) throw new Error(`no row rendered for ${name}`);
  return row as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListLocalGovernments.mockResolvedValue({
    state: 'Anambra',
    mode: 'curated',
    lgas: ['Onitsha North', 'Onitsha South', 'Awka North'],
  });
  mockListManagedVillages.mockResolvedValue([OGBE, RETIRED]);
  mockPublishVillages.mockResolvedValue({ created: [OGBE], skipped: [] });
  mockUpdateManagedVillage.mockResolvedValue(OGBE);
  mockDeleteManagedVillage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('opening the console', () => {
  it('does not read the table before an LGA is named', async () => {
    render(<VillagesPage />);
    await settle();
    expect(mockListManagedVillages).not.toHaveBeenCalled();

    await pickState();
    expect(mockListLocalGovernments).toHaveBeenCalledWith('Anambra');
    expect(mockListManagedVillages).not.toHaveBeenCalled();

    await pickLga();
    expect(mockListManagedVillages).not.toHaveBeenCalled();

    await showQuarters();
    expect(mockListManagedVillages).toHaveBeenCalledWith('Anambra', 'Onitsha North');
  });

  it('lists the quarters of that LGA, retired ones included', async () => {
    render(<VillagesPage />);
    await pickState();
    await pickLga();
    await showQuarters();

    expect(await screen.findByText('Ogbendida')).toBeInTheDocument();
    expect(screen.getByText('Owelle Ebo')).toBeInTheDocument();
    // `is_active=false` is reversible only if the admin can still see the row.
    expect(screen.getByText('Retired')).toBeInTheDocument();
  });

  it('prints the server\'s own refusal, because 503 and 403 need different fixes', async () => {
    mockListManagedVillages.mockRejectedValue(
      new Error("Villages failed: Feature 'localityVillages' is not available in this environment."),
    );
    render(<VillagesPage />);
    await pickState();
    await pickLga();
    await showQuarters();

    const banner = await screen.findByText(/localityVillages/i);
    expect(banner.textContent).toMatch(/not available in this environment/i);
  });

  it('says so when an LGA has nothing curated yet', async () => {
    mockListManagedVillages.mockResolvedValue([]);
    render(<VillagesPage />);
    await pickState();
    await pickLga('Onitsha South');
    await showQuarters();

    expect(await screen.findByText(/no villages curated/i)).toBeInTheDocument();
  });
});

describe('publishing a list', () => {
  it('sends the pasted names for the LGA in view', async () => {
    render(<VillagesPage />);
    await pickState();
    await pickLga();
    await showQuarters();

    fireEvent.change(screen.getByLabelText('Village names'), {
      target: { value: 'Isiokwe\nMgbelekeke, Obikporo' },
    });
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    await settle();

    expect(mockPublishVillages).toHaveBeenCalledWith({
      state: 'Anambra',
      lga: 'Onitsha North',
      names: ['Isiokwe', 'Mgbelekeke', 'Obikporo'],
    });
  });

  it('reports the names it could not store, by name', async () => {
    mockPublishVillages.mockResolvedValue({
      created: [OGBE],
      skipped: [{ name: 'Ogbendida', reason: 'Ogbendida is already curated for Onitsha North, Anambra.' }],
    });
    render(<VillagesPage />);
    await pickState();
    await pickLga();
    await showQuarters();

    fireEvent.change(screen.getByLabelText('Village names'), { target: { value: 'Ogbendida' } });
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    await settle();

    const notice = await screen.findByText(/1 published/i);
    expect(notice.textContent).toMatch(/Ogbendida/);
    expect(notice.textContent).toMatch(/already/i);
  });

  it('will not send an empty list', async () => {
    render(<VillagesPage />);
    await pickState();
    await pickLga();
    await showQuarters();

    const button = screen.getByRole('button', { name: /publish/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockPublishVillages).not.toHaveBeenCalled();
  });
});

describe('correcting a row', () => {
  it('retires and restores through one field', async () => {
    render(<VillagesPage />);
    await pickState();
    await pickLga();
    await showQuarters();

    fireEvent.click(await screen.findByRole('button', { name: 'Retire' }));
    await settle();

    expect(mockUpdateManagedVillage).toHaveBeenCalledWith('v1', { active: false });
  });

  it('renames in place with the trimmed value', async () => {
    render(<VillagesPage />);
    await pickState();
    await pickLga();
    await showQuarters();

    const row = await waitFor(() => rowFor('Ogbendida'));
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    const field = await screen.findByRole('textbox', { name: 'New name' });
    fireEvent.change(field, { target: { value: '  Umudei Iku  ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await settle();

    expect(mockUpdateManagedVillage).toHaveBeenCalledWith('v1', { name: 'Umudei Iku' });
  });

  it('asks before deleting for good, and only then asks the server', async () => {
    const asked = confirmWith(false);
    render(<VillagesPage />);
    await pickState();
    await pickLga();
    await showQuarters();

    const row = await waitFor(() => rowFor('Ogbendida'));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await settle();
    expect(asked).toHaveBeenCalled();
    expect(mockDeleteManagedVillage).not.toHaveBeenCalled();

    asked.mockReturnValue(true);
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await settle();
    await waitFor(() => expect(mockDeleteManagedVillage).toHaveBeenCalledWith('v1'));
  });
});
