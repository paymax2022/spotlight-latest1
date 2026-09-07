import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The guard decides which chrome a route gets. That decision used to live in
// app/admin/layout.tsx, which wrapped AdminShell around EVERY admin route —
// including /admin/login, a logged-out page. The sidebar hydrates from
// localStorage rather than from a live session, so the login screen showed the
// previous operator's email, the whole navigation tree and a Log out button to
// a signed-out visitor.
//
// AdminShell is mocked: what is under test is which shell the guard picks, not
// what the sidebar renders inside it.

let pathname = '/admin';
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

vi.mock('@/components/layouts/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="admin-shell">{children}</div>
  ),
}));

const syncAdminSession = vi.fn();
vi.mock('@/features/auth/adminSession', () => ({
  syncAdminSession: () => syncAdminSession(),
  startAdminSessionSync: () => () => {},
}));

vi.mock('@/features/auth/routeGuard', () => ({
  isRouteAllowed: () => true,
}));

import { AdminRouteGuard } from './AdminRouteGuard';

const OPERATOR = JSON.stringify({ email: 'operator@spotlight.internal', roles: ['admin'] });

beforeEach(() => {
  replace.mockClear();
  syncAdminSession.mockReset();
  localStorage.clear();
});

describe('AdminRouteGuard chrome selection', () => {
  it('renders the login page WITHOUT the admin shell, even with a stale operator in storage', async () => {
    pathname = '/admin/login';
    localStorage.setItem('spotlight_admin_user', OPERATOR);

    render(
      <AdminRouteGuard>
        <p>Admin Login</p>
      </AdminRouteGuard>,
    );

    expect(await screen.findByText('Admin Login')).toBeDefined();
    // The regression: the shell (and so the sidebar, the operator identity and
    // the Log out control) rendering on a signed-out page.
    expect(screen.queryByTestId('admin-shell')).toBeNull();
  });

  it('renders /admin/unauthorized without the shell too', async () => {
    pathname = '/admin/unauthorized';
    localStorage.setItem('spotlight_admin_user', OPERATOR);

    render(
      <AdminRouteGuard>
        <p>Unauthorized</p>
      </AdminRouteGuard>,
    );

    expect(await screen.findByText('Unauthorized')).toBeDefined();
    expect(screen.queryByTestId('admin-shell')).toBeNull();
  });

  it('still wraps an authenticated route in the admin shell', async () => {
    pathname = '/admin';
    localStorage.setItem('spotlight_admin_user', OPERATOR);
    syncAdminSession.mockResolvedValue(true);

    render(
      <AdminRouteGuard>
        <p>Dashboard</p>
      </AdminRouteGuard>,
    );

    // The half that must NOT regress: signed-in pages keep their chrome.
    expect(await screen.findByTestId('admin-shell')).toBeDefined();
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to login and renders no chrome when the session is dead', async () => {
    pathname = '/admin';
    localStorage.setItem('spotlight_admin_user', OPERATOR);
    syncAdminSession.mockResolvedValue(false);

    render(
      <AdminRouteGuard>
        <p>Dashboard</p>
      </AdminRouteGuard>,
    );

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/login'));
    expect(screen.queryByTestId('admin-shell')).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('redirects to login when storage holds no operator at all', async () => {
    pathname = '/admin';

    render(
      <AdminRouteGuard>
        <p>Dashboard</p>
      </AdminRouteGuard>,
    );

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/login'));
    expect(screen.queryByTestId('admin-shell')).toBeNull();
  });
});
