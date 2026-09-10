'use client';

// A-MOD-02 — Facilities RBAC Management. Assign facilities permissions to roles.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

interface RolePermission {
  roleId: string;
  roleName: string;
  permissions: {
    facilitiesCreate: boolean;
    facilitiesEdit: boolean;
    facilitiesDelete: boolean;
    facilitiesBookingsView: boolean;
    facilitiesBookingsApprove: boolean;
    facilitiesBookingsCancel: boolean;
  };
}

const FACILITY_PERMISSIONS = [
  { key: 'facilitiesCreate', label: 'Create Facilities', description: 'Can create new facilities' },
  { key: 'facilitiesEdit', label: 'Edit Facilities', description: 'Can edit facility details' },
  { key: 'facilitiesDelete', label: 'Delete Facilities', description: 'Can delete facilities' },
  { key: 'facilitiesBookingsView', label: 'View Bookings', description: 'Can view facility bookings' },
  { key: 'facilitiesBookingsApprove', label: 'Approve Bookings', description: 'Can approve pending bookings' },
  { key: 'facilitiesBookingsCancel', label: 'Cancel Bookings', description: 'Can cancel and refund bookings' },
];

export default function FacilitiesRbacPage() {
  const [roles, setRoles] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editingPerms, setEditingPerms] = useState<{ [key: string]: boolean }>({});
  const [submitting, setSubmitting] = useState(false);

  async function loadRoles() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/modules/facilities-rbac');
      if (!res.ok) throw new Error(`Failed to load roles: ${res.status}`);
      const data = await res.json();
      setRoles(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRoles();
  }, []);

  async function startEditing(roleId: string) {
    const role = roles.find((r) => r.roleId === roleId);
    if (role) {
      setEditingRole(roleId);
      setEditingPerms(role.permissions);
    }
  }

  async function savePermissions() {
    if (!editingRole) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/modules/facilities-rbac/${editingRole}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingPerms),
      });
      if (!res.ok) throw new Error(`Failed to save permissions: ${res.status}`);
      await loadRoles();
      setEditingRole(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Facilities RBAC"
        subtitle="Manage permissions for facility operations across roles"
        actions={<Button variant="outline" sm onClick={loadRoles}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading RBAC configuration…</p>
      ) : roles.length === 0 ? (
        <Card title="No roles found">
          <p style={{ color: colors.muted }}>
            No roles available. Create roles in <Link href="/admin/roles" style={{ color: colors.primary }}>Role Management</Link>.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {roles.map((role) => (
            <Card
              key={role.roleId}
              title={role.roleName}
              right={
                editingRole === role.roleId ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button variant="outline" sm onClick={() => setEditingRole(null)} disabled={submitting}>
                      Cancel
                    </Button>
                    <Button variant="primary" sm onClick={savePermissions} disabled={submitting}>
                      {submitting ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" sm onClick={() => startEditing(role.roleId)}>
                    Edit
                  </Button>
                )
              }
            >
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {FACILITY_PERMISSIONS.map((perm) => {
                  const isEditing = editingRole === role.roleId;
                  const isChecked =
                    isEditing ? editingPerms[perm.key as keyof typeof editingPerms] : role.permissions[perm.key as keyof typeof role.permissions];

                  return (
                    <div
                      key={perm.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem',
                        border: `1px solid ${colors.border}`,
                        borderRadius: '0.375rem',
                        background: isChecked ? colors.headBg : colors.card,
                      }}
                    >
                      {isEditing ? (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) =>
                            setEditingPerms({
                              ...editingPerms,
                              [perm.key]: e.target.checked,
                            })
                          }
                          style={{ cursor: 'pointer' }}
                        />
                      ) : (
                        <input type="checkbox" checked={isChecked} disabled style={{ cursor: 'not-allowed' }} />
                      )}
                      <div>
                        <label style={{ fontWeight: 600, fontSize: '0.9rem', cursor: isEditing ? 'pointer' : 'default' }}>
                          {perm.label}
                        </label>
                        <p style={{ margin: '0.25rem 0 0', color: colors.muted, fontSize: '0.75rem' }}>
                          {perm.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}

          <Card title="RBAC Guidelines">
            <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.85rem', color: colors.muted }}>
              <p>
                <strong>Create Facilities:</strong> Required to add new facilities to estates.
              </p>
              <p>
                <strong>Edit Facilities:</strong> Required to modify facility details (name, capacity, fees).
              </p>
              <p>
                <strong>Delete Facilities:</strong> Required to remove facilities (typically restricted).
              </p>
              <p>
                <strong>View Bookings:</strong> Required to see facility booking history and current reservations.
              </p>
              <p>
                <strong>Approve Bookings:</strong> Required to confirm pending facility reservations.
              </p>
              <p>
                <strong>Cancel Bookings:</strong> Required to cancel bookings and process refunds.
              </p>
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
