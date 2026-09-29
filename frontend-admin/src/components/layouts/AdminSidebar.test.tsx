import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// What is under test is one entry in the Support section: the create-an-admin
// form used to exist ONLY inside /admin/login, so nothing in the console linked
// to it and adding a colleague meant already knowing the signup URL. The entry
// must appear for the operators routeGuard.ts admits and stay hidden from
// everyone else — a mismatch between the two either hides the link from an
// operator the guard would let through, or shows it to one it would bounce to
// /admin/unauthorized.

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ replace: vi.fn() }),
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

function signedIn(permissions: string[]) {
  localStorage.setItem(
    'spotlight_admin_user',
    JSON.stringify({ id: 'u1', email: 'operator@spotlight.internal', roles: ['admin'], permissions }),
  );
}

beforeEach(() => localStorage.clear());

describe('Create Admin nav entry', () => {
  it('links a wildcard admin to the standalone create-admin page', async () => {
    signedIn(['*']);
    render(<AdminSidebar />);

    const link = await screen.findByRole('link', { name: 'Create Admin' });
    expect(link.getAttribute('href')).toBe('/admin/admins/new');
  });

  it('shows it to an operator who can assign roles', async () => {
    signedIn(['users.roles.assign']);
    render(<AdminSidebar />);

    expect(await screen.findByRole('link', { name: 'Create Admin' })).toBeDefined();
  });

  it('hides it from an operator who may only view users', async () => {
    signedIn(['users.view']);
    render(<AdminSidebar />);

    // Assert the Support section rendered before asserting the absence, so a
    // sidebar that failed to render at all cannot pass this test.
    expect(await screen.findByRole('link', { name: 'Leads Queue' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Create Admin' })).toBeNull();
  });
});
