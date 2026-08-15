import Link from 'next/link';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminRbacSettingsPage() {
  return (
    <Page>
      <PageHeader title="RBAC Settings" subtitle="Manage access control across roles, permissions, assignment matrix, and audit trails." />
      <Card>
        <div style={{ display: 'grid', gap: 10 }}>
          <Link href="/admin/roles" style={{ color: colors.primary }}>Role Management</Link>
          <Link href="/admin/permissions" style={{ color: colors.primary }}>Permissions Management</Link>
          <Link href="/admin/permissions-matrix" style={{ color: colors.primary }}>Permission Matrix</Link>
          <Link href="/admin/users" style={{ color: colors.primary }}>User Role & Status Management</Link>
          <Link href="/admin/audit-logs" style={{ color: colors.primary }}>Audit Logs</Link>
          <Link href="/admin/security-events" style={{ color: colors.primary }}>Security Events</Link>
        </div>
      </Card>
    </Page>
  );
}
