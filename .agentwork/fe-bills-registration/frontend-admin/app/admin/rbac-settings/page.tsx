import Link from 'next/link';

export default function AdminRbacSettingsPage() {
  return (
    <div>
      <h1>RBAC Settings</h1>
      <p>Manage access control across roles, permissions, assignment matrix, and audit trails.</p>
      <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <Link href="/admin/roles">Role Management</Link>
        <Link href="/admin/permissions">Permissions Management</Link>
        <Link href="/admin/permissions-matrix">Permission Matrix</Link>
        <Link href="/admin/users">User Role & Status Management</Link>
        <Link href="/admin/audit-logs">Audit Logs</Link>
        <Link href="/admin/security-events">Security Events</Link>
      </div>
    </div>
  );
}
