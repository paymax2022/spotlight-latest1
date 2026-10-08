'use client';

import { Page, PageHeader, Card } from '@/components/ui/vuexy';
import { AdminSignupPanel } from '@/features/auth/AdminSignupPanel';

/**
 * Standalone create-admin screen — the sidebar's own entry point into the form
 * that previously existed only inside /admin/login.
 *
 * Reaching this page requires a session (middleware.ts, then AdminRouteGuard
 * with routeGuard.ts's /admin/admins entry), and that same session is what lets
 * the panel skip the setup code: /api/admin/signup resolves a signed-in caller
 * to `session` mode. So an operator who can open this page can always use it.
 */
export default function CreateAdminPage() {
  return (
    <Page>
      <PageHeader
        title="Create Admin"
        subtitle="Provisions a console-capable account: credentials, the admin profile role, an active platform status, and the RBAC role you pick."
      />
      <Card>
        <AdminSignupPanel />
      </Card>
    </Page>
  );
}
