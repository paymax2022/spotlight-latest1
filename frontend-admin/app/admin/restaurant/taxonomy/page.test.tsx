/**
 * The admin taxonomy page: the tree renders with defaults protected from delete,
 * a create goes through the service, and a 403 is explained rather than shown raw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockList = vi.fn();
const mockCuisines = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/services/restaurantTaxonomyService', async () => {
  class TaxonomyError extends Error {
    status: number; code: string;
    constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
  }
  return {
    listCategories: (...a: unknown[]) => mockList(...a),
    createCategory: (...a: unknown[]) => mockCreate(...a),
    setCategoryActive: vi.fn().mockResolvedValue({}),
    deleteCategory: (...a: unknown[]) => mockDelete(...a),
    seedDefaults: vi.fn().mockResolvedValue({ inserted: 0, skipped: 313 }),
    listCuisines: (...a: unknown[]) => mockCuisines(...a),
    createCuisine: vi.fn().mockResolvedValue({}),
    setCuisineActive: vi.fn().mockResolvedValue({}),
    TaxonomyError,
  };
});

import RestaurantTaxonomyPage from './page';
import { TaxonomyError } from '@/services/restaurantTaxonomyService';

const node = (o: Record<string, unknown>) => ({
  id: 'x', parent_id: null, name: 'X', slug: 'x', kind: 'FOOD', icon: null, sort_order: 10,
  is_active: true, is_system_seeded: false, item_count: 0, children: [], ...o,
});

const tree = [
  node({ id: 'rice', name: 'Rice Dishes', slug: 'rice-dishes', is_system_seeded: true, children: [
    node({ id: 'jollof', parent_id: 'rice', name: 'Jollof Rice', slug: 'jollof-rice', is_system_seeded: true }),
  ] }),
  node({ id: 'mine', name: 'Local Specials', slug: 'local-specials', item_count: 0 }),
];

describe('RestaurantTaxonomyPage', () => {
  beforeEach(() => {
    mockList.mockReset(); mockCuisines.mockReset(); mockCreate.mockReset(); mockDelete.mockReset();
    mockCuisines.mockResolvedValue([]);
  });

  it('renders the tree and marks defaults as protected from delete', async () => {
    mockList.mockResolvedValue(tree);
    render(<RestaurantTaxonomyPage />);
    await waitFor(() => expect(screen.getByText('Rice Dishes')).toBeTruthy());
    expect(screen.getByText('Jollof Rice')).toBeTruthy();
    // Two rows have a Delete button: the custom top-level and nothing from the defaults.
    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(1);
  });

  it('a create goes through the service and reloads the tree', async () => {
    mockList.mockResolvedValue(tree);
    mockCreate.mockResolvedValue(node({ id: 'n', name: 'Suya Bowls' }));
    render(<RestaurantTaxonomyPage />);
    await waitFor(() => expect(screen.getByText('Rice Dishes')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/category or sub-category name/i), { target: { value: 'Suya Bowls' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ name: 'Suya Bowls', kind: 'FOOD', parent_id: null }));
    await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('an owner-side 403 is explained in plain words', async () => {
    mockList.mockRejectedValue(new (TaxonomyError as unknown as new (s: number, c: string, m: string) => Error)(403, 'forbidden', 'nope'));
    render(<RestaurantTaxonomyPage />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/cannot manage the menu taxonomy/i));
  });

  it('a missing route says the feature is not enabled', async () => {
    mockList.mockRejectedValue(new (TaxonomyError as unknown as new (s: number, c: string, m: string) => Error)(404, 'not_found', 'x'));
    render(<RestaurantTaxonomyPage />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not enabled/i));
  });
});
