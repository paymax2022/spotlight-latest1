/**
 * The restaurant onboarding queue: which application a reviewer sees first, and
 * what the filter panel does to that list.
 *
 * The page used to render exactly what GET /api/restaurant/admin/onboarding
 * returned — 170+ rows, unpaginated, in whatever order the SQL gave, with only
 * the status chips as a control. These specs pin the behaviour that replaces it:
 * newest-submitted first, an explicit arrangement toggle, sortable headers, the
 * filter panel, and paging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockList = vi.fn();
const mockDecide = vi.fn();
const mockCuisinesGet = vi.fn();
const mockCuisinesSet = vi.fn();

vi.mock('@/services/restaurantAdminService', () => ({
  listApplications: (...a: unknown[]) => mockList(...a),
  decideApplication: (...a: unknown[]) => mockDecide(...a),
  getRestaurantCuisines: (...a: unknown[]) => mockCuisinesGet(...a),
  setRestaurantCuisines: (...a: unknown[]) => mockCuisinesSet(...a),
}));

import OnboardingReviewPage from './page';
import type { RestaurantApplication } from '@/types/restaurantAdmin';

const day = (n: number) => new Date(Date.UTC(2026, 3, n, 9, 0, 0)).toISOString();

function app(o: Partial<RestaurantApplication> & { id: string; restaurant_name: string }): RestaurantApplication {
  return {
    owner_id: `u-${o.id}`,
    owner_name: `Owner ${o.id}`,
    email: `${o.id}@owner.test`,
    address: '1 Test St',
    documents: [],
    status: 'pending',
    kyb_status: 'submitted',
    submitted_at: day(10),
    ...o,
  } as RestaurantApplication;
}

/** Intentionally NOT in date order: a page that renders the array as returned
 *  must fail an ordering spec, otherwise the spec proves nothing. */
const ROWS: RestaurantApplication[] = [
  app({ id: 'mid', restaurant_name: 'Middle Date Kitchen', submitted_at: day(15) }),
  app({ id: 'old', restaurant_name: 'Oldest Outlet', submitted_at: day(1) }),
  app({ id: 'new', restaurant_name: 'Newest Outlet', submitted_at: day(28) }),
  app({
    id: 'sole',
    restaurant_name: 'Sole Prop Suya',
    submitted_at: day(20),
    status: 'approved',
    kyb_status: 'approved',
    business_type: 'sole_proprietor',
  }),
  app({
    id: 'ltd',
    restaurant_name: 'Limited Company Jollof',
    submitted_at: day(5),
    status: 'rejected',
    kyb_status: 'rejected',
    business_type: 'limited_company',
    bank_account_verified: false,
  }),
];

function firstRestaurantCell(): string {
  const rows = screen.getAllByRole('row').slice(1);
  return rows[0].cells[0].textContent ?? '';
}

/** SortHeaderButton puts aria-sort on the header button, not the th. */
function sortButton(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^Sort by ${label}`, 'i') });
}

function restaurantRowNames(): string[] {
  return screen.getAllByRole('row').slice(1).map((r) => (r.cells[0].textContent ?? '').split('1 Test St')[0]);
}

describe('OnboardingReviewPage ordering', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDecide.mockReset();
    mockCuisinesGet.mockReset();
    mockCuisinesSet.mockReset();
    localStorage.setItem(
      'spotlight_admin_user',
      JSON.stringify({ id: 'admin-1', email: 'admin@spotlight.internal', roles: ['super-admin'], permissions: [] }),
    );
    mockList.mockResolvedValue(ROWS);
  });

  it('lists the newest submitted application first, not in the order the API returned', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(ROWS.length + 1));
    expect(firstRestaurantCell()).toContain('Newest Outlet');
    expect(restaurantRowNames()).toEqual([
      'Newest Outlet',
      'Sole Prop Suya',
      'Middle Date Kitchen',
      'Limited Company Jollof',
      'Oldest Outlet',
    ]);
  });

  it('the Latest first toggle is pressed by default and flips the arrangement to earliest first', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(ROWS.length + 1));
    const toggle = screen.getByRole('button', { name: 'Latest first' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(firstRestaurantCell()).toContain('Oldest Outlet');
  });

  it('the Submitted header starts descending and a column header click takes over the ordering', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(ROWS.length + 1));
    expect(sortButton('Submitted').getAttribute('aria-sort')).toBe('descending');

    fireEvent.click(sortButton('Restaurant'));
    expect(sortButton('Restaurant').getAttribute('aria-sort')).toBe('ascending');
    expect(firstRestaurantCell()).toContain('Limited Company Jollof');
    expect(screen.getByRole('button', { name: 'Latest first' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(sortButton('Restaurant'));
    expect(sortButton('Restaurant').getAttribute('aria-sort')).toBe('descending');
    expect(firstRestaurantCell()).toContain('Sole Prop Suya');
  });

  it('the toggle re-pins the ordering to Submitted descending after another column was sorted', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(ROWS.length + 1));
    fireEvent.click(sortButton('Owner'));
    fireEvent.click(screen.getByRole('button', { name: 'Latest first' }));
    expect(screen.getByRole('button', { name: 'Latest first' }).getAttribute('aria-pressed')).toBe('true');
    expect(sortButton('Submitted').getAttribute('aria-sort')).toBe('descending');
    expect(firstRestaurantCell()).toContain('Newest Outlet');
  });
});

function rowCount(): number {
  return screen.getAllByRole('row').length - 1;
}

function applyPanel() {
  fireEvent.click(screen.getByRole('button', { name: /^apply filters$/i }));
}

describe('OnboardingReviewPage filters', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDecide.mockReset();
    mockCuisinesGet.mockReset();
    mockCuisinesSet.mockReset();
    localStorage.setItem(
      'spotlight_admin_user',
      JSON.stringify({ id: 'admin-1', email: 'admin@spotlight.internal', roles: ['super-admin'], permissions: [] }),
    );
    mockList.mockResolvedValue(ROWS);
  });

  it('search on owner email narrows the table once Apply Filters is pressed', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    fireEvent.change(screen.getByPlaceholderText(/search restaurant, owner or email/i), {
      target: { value: 'new@owner.test' },
    });
    expect(rowCount()).toBe(ROWS.length); // draft until applied
    applyPanel();
    await waitFor(() => expect(rowCount()).toBe(1));
    expect(firstRestaurantCell()).toContain('Newest Outlet');
  });

  it('the business type select keeps only applications that filed it', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    fireEvent.change(screen.getByRole('combobox', { name: /^business type$/i }), {
      target: { value: 'sole_proprietor' },
    });
    applyPanel();
    await waitFor(() => expect(rowCount()).toBe(1));
    expect(firstRestaurantCell()).toContain('Sole Prop Suya');
  });

  it('the submitted range is inclusive of both endpoints', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    // <input type="date"> has no textbox role in jsdom, so look it up by its label.
    fireEvent.change(screen.getByLabelText(/^submitted from$/i), { target: { value: '2026-04-15' } });
    fireEvent.change(screen.getByLabelText(/^submitted to$/i), { target: { value: '2026-04-20' } });
    applyPanel();
    await waitFor(() => expect(rowCount()).toBe(2));
    expect(restaurantRowNames()).toEqual(['Sole Prop Suya', 'Middle Date Kitchen']);
  });

  it('the bank verification select separates a name mismatch from no check at all', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    fireEvent.change(screen.getByRole('combobox', { name: /^bank verification$/i }), {
      target: { value: 'mismatch' },
    });
    applyPanel();
    await waitFor(() => expect(rowCount()).toBe(1));
    expect(firstRestaurantCell()).toContain('Limited Company Jollof');
  });

  it('an applied filter shows a chip and clearing it restores the full list', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    fireEvent.change(screen.getByRole('combobox', { name: /^business type$/i }), {
      target: { value: 'limited_company' },
    });
    applyPanel();
    await waitFor(() => expect(rowCount()).toBe(1));
    const chip = screen.getByText('Business type:', { selector: 'span' }).parentElement as HTMLElement;
    fireEvent.click(within(chip).getByRole('button', { name: 'Remove Business type filter' }));
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
  });

  it('Reset clears every field and re-fetches the unfiltered queue', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    fireEvent.change(screen.getByPlaceholderText(/search restaurant, owner or email/i), {
      target: { value: 'jollof' },
    });
    applyPanel();
    await waitFor(() => expect(rowCount()).toBe(1));
    mockList.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith(''));
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    expect((screen.getByPlaceholderText(/search restaurant, owner or email/i) as HTMLInputElement).value).toBe('');
  });

  it('a filter that matches nothing says so inside the table', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    fireEvent.change(screen.getByPlaceholderText(/search restaurant, owner or email/i), {
      target: { value: 'no such restaurant' },
    });
    applyPanel();
    await waitFor(() => expect(screen.getByRole('cell').textContent).toMatch(/no applications match/i));
  });
});

describe('OnboardingReviewPage status filter', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDecide.mockReset();
    mockCuisinesGet.mockReset();
    mockCuisinesSet.mockReset();
    localStorage.setItem(
      'spotlight_admin_user',
      JSON.stringify({ id: 'admin-1', email: 'admin@spotlight.internal', roles: ['super-admin'], permissions: [] }),
    );
    mockList.mockResolvedValue(ROWS);
  });

  it('choosing a status re-fetches through the service rather than filtering the cached rows', async () => {
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(ROWS.length));
    mockList.mockResolvedValue([ROWS[3]]);
    fireEvent.change(screen.getByRole('combobox', { name: /^status$/i }), { target: { value: 'approved' } });
    applyPanel();
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('approved'));
    await waitFor(() => expect(rowCount()).toBe(1));
    expect(firstRestaurantCell()).toContain('Sole Prop Suya');
  });
});

describe('OnboardingReviewPage paging', () => {
  beforeEach(() => {
    mockList.mockReset();
    localStorage.setItem(
      'spotlight_admin_user',
      JSON.stringify({ id: 'admin-1', email: 'admin@spotlight.internal', roles: ['super-admin'], permissions: [] }),
    );
  });

  it('shows 20 rows per page and keeps the rest for page 2', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      app({ id: `r${i}`, restaurant_name: `Outlet ${String(i).padStart(2, '0')}`, submitted_at: day(1 + i) }),
    );
    mockList.mockResolvedValue(many);
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(20));
    expect(screen.getByText(/showing 1–20 of 25/i)).toBeTruthy();
    // newest first, so page 1 ends with the 20th-newest submission.
    expect(firstRestaurantCell()).toContain('Outlet 24');
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(rowCount()).toBe(5));
    expect(firstRestaurantCell()).toContain('Outlet 04');
  });

  it('an applied filter returns to page 1 instead of stranding the reviewer on an empty page', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      app({
        id: `r${i}`,
        restaurant_name: i < 20 ? `Outlet ${i}` : `Rare Find ${i}`,
        submitted_at: day(1 + i),
      }),
    );
    mockList.mockResolvedValue(many);
    render(<OnboardingReviewPage />);
    await waitFor(() => expect(rowCount()).toBe(20));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(rowCount()).toBe(5));
    fireEvent.change(screen.getByPlaceholderText(/search restaurant, owner or email/i), {
      target: { value: 'rare find' },
    });
    applyPanel();
    await waitFor(() => expect(rowCount()).toBe(5));
    expect(screen.getByText(/showing 1–5 of 5/i)).toBeTruthy();
  });
});
