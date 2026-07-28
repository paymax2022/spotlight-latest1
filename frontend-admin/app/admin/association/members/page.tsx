'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { listMembers, type MemberSummary } from '@/services/associationAdminService';
import {
  PageHeader, AssociationTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar,
  btn, th, td, label as lbl, input, select,
  useAssociationPermissions, ASSOCIATION_PERMS, PermissionBanner,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Members"
        subtitle="Association member directory — search, filter and drill into a member to suspend, restore, transfer or assign a role."
        action={<button onClick={() => void load()} style={btn()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>}
      />
      <AssociationTabs active="members" />
      <DisclosureNote>
        Backed by <code>GET /api/finance/associations/members</code>. Member actions (suspend, restore, transfer,
        role) live on the member detail page and are recorded to the immutable audit log (NL-12).
      </DisclosureNote>

      {!canView && <PermissionBanner text="You have read-only access — your role cannot view member details for this module." />}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={lbl()}>Search (name or member ID)</label>
          <input style={input()} placeholder="e.g. Bola or LTU-2201" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} />
        </div>
        <div>
          <label style={lbl()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <button style={btn()} onClick={() => void load()}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No members match this filter.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Member</th><th style={th()}>Member ID</th><th style={th()}>Chapter</th>
              <th style={th()}>Category</th><th style={th()}>Profession</th><th style={th()}>Status</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={td()}><Link href={`/admin/association/members/${m.id}`} style={{ fontWeight: 600 }}>{m.fullName}</Link></td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{m.memberId}</code></td>
                  <td style={td()}>{m.chapterName ?? '—'}</td>
                  <td style={td()}>{m.categoryLabel}</td>
                  <td style={td()}>{m.profession ?? '—'}</td>
                  <td style={td()}><Badge status={m.status} /></td>
                  <td style={td()}><Link href={`/admin/association/members/${m.id}`} style={{ fontSize: '0.8rem' }}>Detail →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
