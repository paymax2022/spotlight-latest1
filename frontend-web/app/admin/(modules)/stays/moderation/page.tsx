'use client';

import { useEffect, useState } from 'react';
import { listModeration, approveProperty } from '@/services/staysAdminService';
import type { ModerationItem, ModerationStatus } from '@/types/staysAdmin';
import {
  StaysTabs,
  Badge,
  StateBlock,
  FilterBar,
  label,
  select,
  timeAgo,
} from '../_ui';
import { Page, PageHeader, Card, Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: ModerationStatus[] = ['pending_review', 'approved', 'rejected', 'needs_changes'];

export default function StaysModerationPage() {
  const [data, setData] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('pending_review');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await listModeration({ status: status || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(id: string, next: ModerationStatus) {
    if (!window.confirm(`Set property ${id} to "${next.replace(/_/g, ' ')}"?`)) return;
    setBusy(id); setError(null);
    try { await approveProperty(id, { status: next }); await load(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader
        title="Direct-hotel moderation"
        subtitle="Approval queue for direct-rail hotel listings submitted by hoteliers — review photos, room counts and flags before a property goes live."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <StaysTabs active="supply" />

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </FilterBar>

      <Card title="Moderation queue">
        <StateBlock loading={loading} error={error} empty={data.length === 0} emptyText="No properties in this state.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={thCell}>Property</th>
                  <th style={thCell}>Hotelier</th>
                  <th style={thCell}>City</th>
                  <th style={thCell}>Star</th>
                  <th style={thCell}>Rooms</th>
                  <th style={thCell}>Photos</th>
                  <th style={thCell}>Flags</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Submitted</th>
                  <th style={thCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td style={tdCell}>{m.property_name}</td>
                    <td style={tdCell}>{m.hotelier_masked}</td>
                    <td style={tdCell}>{m.city}</td>
                    <td style={tdCell}>{m.star_rating}★</td>
                    <td style={tdCell}>{m.rooms.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>{m.photos_count.toLocaleString('en-NG')}</td>
                    <td style={tdCell}>
                      {m.flags.length === 0 ? <span style={{ color: colors.muted }}>—</span> : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {m.flags.map((f) => <Badge key={f} status="flagged" label={f.replace(/_/g, ' ')} />)}
                        </div>
                      )}
                    </td>
                    <td style={tdCell}><Badge status={m.status} /></td>
                    <td style={tdCell}>{timeAgo(m.submitted_at)}</td>
                    <td style={tdCell}>
                      {m.status === 'pending_review' || m.status === 'needs_changes' ? (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <Button variant="primary" sm disabled={busy === m.id} onClick={() => decide(m.id, 'approved')}>Approve</Button>
                          <Button variant="danger" sm disabled={busy === m.id} onClick={() => decide(m.id, 'rejected')}>Reject</Button>
                          <Button variant="outline" sm disabled={busy === m.id} onClick={() => decide(m.id, 'needs_changes')}>Needs changes</Button>
                        </div>
                      ) : <span style={{ color: colors.muted }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </Page>
  );
}
