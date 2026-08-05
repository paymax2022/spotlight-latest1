'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listMembers, type MemberSummary } from '@/services/associationAdminService';
import {
  AssociationTabs, DisclosureNote, StateBlock, FilterBar,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string) {
  if (status === 'active') return colors.success;
  if (status === 'suspended') return colors.danger;
  return colors.warning;
}

export default function AssociationMembersPage() {
  const { can } = useAssociationPermissions();
  const canView = can(ASSOCIATION_PERMS.view);

  const [rows, setRows] = useState<MemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await listMembers({ search: search || undefined, status: status || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [search, status]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Page>
      <PageHeader
        title="Members"
        subtitle="Association member directory — search, filter and drill into a member to suspend, restore, transfer or assign a role."
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>}
      />
      <AssociationTabs active="members" />
      <DisclosureNote>
        Backed by <code>GET /api/finance/associations/members</code>. Member actions (suspend, restore, transfer,
        role) live on the member detail page and are recorded to the immutable audit log (NL-12).
      </DisclosureNote>

      {!canView && <PermissionBanner text="You have read-only access — your role cannot view member details for this module." />}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search (name or member ID)</label>
          <Input placeholder="e.g. Bola or LTU-2201" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <Button variant="outline" onClick={() => void load()}>Apply</Button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No members match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr>
              <th style={thCell}>Member</th><th style={thCell}>Member ID</th><th style={thCell}>Chapter</th>
              <th style={thCell}>Category</th><th style={thCell}>Profession</th><th style={thCell}>Status</th><th style={thCell}></th>
            </tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={tdCell}><Link href={`/admin/association/members/${m.id}`} style={{ fontWeight: 600, color: colors.primary }}>{m.fullName}</Link></td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{m.memberId}</code></td>
                  <td style={tdCell}>{m.chapterName ?? '—'}</td>
                  <td style={tdCell}>{m.categoryLabel}</td>
                  <td style={tdCell}>{m.profession ?? '—'}</td>
                  <td style={tdCell}><Badge text={m.status} color={statusColor(m.status)} /></td>
                  <td style={tdCell}><Link href={`/admin/association/members/${m.id}`} style={{ fontSize: '0.8rem', color: colors.primary }}>Detail →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
