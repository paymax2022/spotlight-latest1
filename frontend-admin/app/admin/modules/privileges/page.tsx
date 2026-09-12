'use client';

// A-MOD-01 — Module privileges dashboard. Show user permissions across modules.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

interface UserPrivilege {
  userId: string;
  userName: string;
  userEmail: string;
  modules: {
    [key: string]: {
      name: string;
      permissions: string[];
      isActive: boolean;
    };
  };
}

interface ModuleInfo {
  key: string;
  name: string;
  description: string;
  availablePermissions: { key: string; label: string }[];
}

const MODULES: ModuleInfo[] = [
  {
    key: 'estate.admin',
    name: 'Estate Admin',
    description: 'Manage estate operations including residents, dues, security, vendors, and facilities',
    availablePermissions: [
      { key: 'estate.admin.security', label: 'Security & Guard Management' },
      { key: 'estate.admin.dues', label: 'Dues & Collections' },
      { key: 'estate.admin.ops', label: 'Operations' },
      { key: 'estate.admin.content', label: 'Content Management' },
      { key: 'estate.admin.election', label: 'Election Integrity' },
      { key: 'estate.admin.facilities', label: 'Facilities Management' },
    ],
  },
  {
    key: 'platform',
    name: 'Platform',
    description: 'Platform-wide administration including users, roles, and permissions',
    availablePermissions: [
      { key: 'platform.admin.users', label: 'User Management' },
      { key: 'platform.admin.roles', label: 'Role Management' },
      { key: 'platform.admin.permissions', label: 'Permissions Management' },
      { key: 'platform.admin.audit', label: 'Audit Logs' },
    ],
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Manage financial operations including wallets, transactions, and settlements',
    availablePermissions: [
      { key: 'finance.admin.wallets', label: 'Wallet Management' },
      { key: 'finance.admin.ledger', label: 'Ledger Management' },
      { key: 'finance.admin.settlement', label: 'Settlement Management' },
      { key: 'finance.admin.reporting', label: 'Financial Reporting' },
    ],
  },
  {
    key: 'marketplace',
    name: 'Marketplace',
    description: 'Manage marketplace operations including vendors and orders',
    availablePermissions: [
      { key: 'marketplace.admin.vendors', label: 'Vendor Management' },
      { key: 'marketplace.admin.orders', label: 'Order Management' },
      { key: 'marketplace.admin.disputes', label: 'Dispute Resolution' },
      { key: 'marketplace.admin.reporting', label: 'Marketplace Reporting' },
    ],
  },
];

export default function PrivilegesPage() {
  const [users, setUsers] = useState<UserPrivilege[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  async function loadPrivileges() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/privileges');
      if (!res.ok) throw new Error(`Failed to load privileges: ${res.status}`);
      const data = await res.json();
      setUsers(data);
      if (data.length > 0) setSelectedUser(data[0].userId);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrivileges();
  }, []);

  const selectedUserData = users.find((u) => u.userId === selectedUser);

  return (
    <Page>
      <PageHeader
        title="Module Privileges"
        subtitle="View and manage user permissions across modules"
        actions={<Button variant="outline" sm onClick={loadPrivileges}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading privileges…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem' }}>
          {/* User List */}
          <Card title="Users">
            {users.length === 0 ? (
              <p style={{ color: colors.muted, fontSize: '0.85rem' }}>No users found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {users.map((u) => (
                  <button
                    key={u.userId}
                    onClick={() => setSelectedUser(u.userId)}
                    style={{
                      padding: '0.5rem',
                      border: `1px solid ${selectedUser === u.userId ? colors.primary : colors.border}`,
                      background: selectedUser === u.userId ? colors.primary : colors.headBg,
                      color: selectedUser === u.userId ? '#fff' : colors.text,
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: '0.85rem',
                      fontWeight: selectedUser === u.userId ? 600 : 400,
                    }}
                  >
                    <div>{u.userName}</div>
                    <div style={{ fontSize: '0.75rem', color: selectedUser === u.userId ? 'rgba(255,255,255,0.7)' : colors.muted }}>
                      {u.userEmail}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {/* Privileges for Selected User */}
          {selectedUserData ? (
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              <Card title={`Privileges for ${selectedUserData.userName}`}>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {MODULES.map((mod) => {
                    const userMod = selectedUserData.modules[mod.key];
                    const hasAccess = userMod?.isActive || false;
                    const perms = userMod?.permissions || [];

                    return (
                      <div
                        key={mod.key}
                        style={{
                          padding: '0.75rem',
                          border: `1px solid ${colors.border}`,
                          borderRadius: '0.375rem',
                          background: hasAccess ? colors.headBg : colors.card,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>{mod.name}</h3>
                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: colors.muted }}>{mod.description}</p>
                          </div>
                          <Badge text={hasAccess ? 'Access' : 'No Access'} color={hasAccess ? colors.success : colors.muted} />
                        </div>

                        {hasAccess && perms.length > 0 && (
                          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: `1px solid ${colors.border}` }}>
                            <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', fontWeight: 600, color: colors.muted, textTransform: 'uppercase' }}>
                              Permissions:
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                              {perms.map((p) => {
                                const permInfo = mod.availablePermissions.find((ap) => ap.key === p);
                                return (
                                  <Badge
                                    key={p}
                                    text={permInfo?.label || p.split('.').pop() || p}
                                    color={colors.success}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {!hasAccess && (
                          <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: colors.muted, fontStyle: 'italic' }}>
                            This user does not have access to this module.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card title="Module Management">
                <p style={{ color: colors.muted, fontSize: '0.85rem', marginBottom: '1rem' }}>
                  To manage roles and assign permissions, visit:
                </p>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <Link href="/admin/roles" style={{ color: colors.primary, fontSize: '0.85rem' }}>
                    → Role Management
                  </Link>
                  <Link href="/admin/permissions" style={{ color: colors.primary, fontSize: '0.85rem' }}>
                    → Permissions Management
                  </Link>
                  <Link href="/admin/permissions-matrix" style={{ color: colors.primary, fontSize: '0.85rem' }}>
                    → Permission Assignment Matrix
                  </Link>
                </div>
              </Card>
            </div>
          ) : (
            <Card>
              <p style={{ color: colors.muted }}>Select a user to view their privileges.</p>
            </Card>
          )}
        </div>
      )}
    </Page>
  );
}
