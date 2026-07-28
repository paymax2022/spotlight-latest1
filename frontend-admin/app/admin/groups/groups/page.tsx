'use client';

import { useEffect, useState } from 'react';
import { listGroups, listGroupMembers, formatNaira, type GroupRecord, type GroupMember } from '@/services/groupsAdminService';
import { PageHeader, GroupsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, btnPrimary, th, td, input, label, select, fmtDate } from '../_ui';

export default function GroupsPage() {
  const [rows, setRows] = useState<GroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<GroupRecord | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listGroups({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function viewMembers(g: GroupRecord) {
    setSelected(g); setMembersLoading(true);
    try { setMembers(await listGroupMembers(g.id)); }
    catch { setMembers([]); }
    finally { setMembersLoading(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Groups & members" subtitle="Group savings pools and their members. Select a group to inspect its membership." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <GroupsTabs active="groups" />
      <DisclosureNote>Read-only — backed by member group projections. No admin write surface exists on the backend yet.</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Name, owner or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="forming">Forming</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No groups match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Group</th><th style={th()}>Owner</th><th style={th()}>Status</th><th style={th()}>Members</th>
              <th style={th()}>Dues</th><th style={th()}>Balance</th><th style={th()}>Created</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td style={td()}>{g.name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{g.id}</div></td>
                  <td style={td()}>{g.owner_masked}</td>
                  <td style={td()}><Badge status={g.status} /></td>
                  <td style={td()}>{g.members_count.toLocaleString('en-NG')}</td>
                  <td style={td()}>{formatNaira(g.due_amount_kobo)} / {g.frequency}</td>
                  <td style={td()}>{formatNaira(g.balance_kobo)}</td>
                  <td style={td()}>{fmtDate(g.created_at)}</td>
                  <td style={td()}><button style={btnPrimary()} onClick={() => viewMembers(g)}>Members</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>

      {selected && (
        <Card title={`Members — ${selected.name}`} right={<button style={btn()} onClick={() => setSelected(null)}>Close</button>}>
          {membersLoading ? <p style={{ color: '#6b7280' }}>Loading…</p> : members.length === 0 ? <p style={{ color: '#6b7280' }}>No members.</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th()}>Member</th><th style={th()}>Role</th><th style={th()}>Status</th><th style={th()}>Dues paid</th><th style={th()}>Joined</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td style={td()}>{m.masked_name}</td>
                    <td style={td()}><Badge status={m.role === 'owner' ? 'verified' : 'normal'} label={m.role} /></td>
                    <td style={td()}><Badge status={m.status} /></td>
                    <td style={td()}>{formatNaira(m.paid_dues_kobo)}</td>
                    <td style={td()}>{fmtDate(m.joined_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
