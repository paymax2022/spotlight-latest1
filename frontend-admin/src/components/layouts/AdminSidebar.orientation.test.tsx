import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Orientation, not access control: with 445 screens the menu ships folded, and an
// operator can press "Collapse all" and end up standing on a screen whose own link
// is hidden somewhere in a closed branch. The sidebar must re-open the branch you
// navigate INTO (so "you are here" is always visible) while still honouring a
// header you closed deliberately on that same page.
//
// jsdom has no layout, so this asserts rendered links, not pixel heights.

const route = vi.hoisted(() => ({ pathname: '/admin' }));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/services/adminApiClient', () => ({
  getAdminMenuCounts: () => Promise.resolve({}),
}));

vi.mock('@/config/stemAccess', () => ({
  useStemRoles: () => [],
  canReadStem: () => false,
  canManageStem: () => false,
}));

vi.mock('@/features/auth/adminAuth', () => ({
  clearAdminSession: vi.fn(),
}));

import { AdminSidebar } from './AdminSidebar';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    'spotlight_admin_user',
    JSON.stringify({ id: 'u1', email: 'admin@spotlight.internal', roles: ['admin'], permissions: ['*'] }),
  );
  route.pathname = '/admin';
});

async function collapseEverything(view: ReturnType<typeof render>) {
  // Two bulk clicks: open everything, then shut it again — which records an
  // explicit "closed" for every one of the 76 branches, the worst case.
  fireEvent.click(await screen.findByRole('button', { name: 'Expand all' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Collapse all' }));
  await view.findByLabelText('Search admin screens');
  return screen.queryAllByRole('link').filter((l) => l.closest('nav'));
}

describe('Active-branch orientation', () => {
  it('hides every screen link once the operator collapses all', async () => {
    const view = render(<AdminSidebar />);
    const links = await collapseEverything(view);
    expect(links).toHaveLength(0);
  }, 20_000);

  it('re-opens the branch of the screen the operator navigates to', async () => {
    const view = render(<AdminSidebar />);
    await collapseEverything(view);

    route.pathname = '/admin/health/lab/payouts';
    view.rerender(<AdminSidebar />);

    const link = await screen.findByRole('link', { name: 'Lab Payouts' });
    expect(link.getAttribute('href')).toBe('/admin/health/lab/payouts');
    expect(link.getAttribute('aria-current')).toBe('page');
    // Only the branch that owns the page reopened — not the whole menu.
    expect(screen.queryAllByRole('link').filter((l) => l.closest('nav')).length).toBeLessThan(15);
  }, 20_000);

  it('still honours a branch the operator closed on the page they are on', async () => {
    route.pathname = '/admin/health/lab/payouts';
    const view = render(<AdminSidebar />);

    // Arriving opened Health > Laboratory; closing the module header must stick
    // until the next navigation, otherwise the header is a dead control.
    const module = await screen.findByRole('button', { name: /Laboratory/ });
    fireEvent.click(module);
    expect(await screen.findByRole('button', { name: /Laboratory/, expanded: false })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Lab Payouts' })).toBeNull();
    expect(view.container).toBeDefined();
  }, 20_000);
});
