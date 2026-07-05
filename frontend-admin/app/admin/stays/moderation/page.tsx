'use client';

import { useEffect, useState } from 'react';
import { listModeration, approveProperty } from '@/services/staysAdminService';
import type { ModerationItem, ModerationStatus } from '@/types/staysAdmin';
import {
  PageHeader,
  StaysTabs,
  Card,
  Badge,
  StateBlock,
  FilterBar,
  btn,
  btnPrimary,
  btnDanger,
  th,
  td,
  label,
  select,
  timeAgo,
} from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Direct-hotel moderation"
        subtitle="Approval queue for direct-rail hotel listings submitted by hoteliers — review photos, room counts and flags before a property goes live."
        action={<button onClick={load} style={btn()}>Refresh</button>}
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
        <button onClick={load} style={btn()}>Refresh</button>
      </FilterBar>

      <Card title="Moderation queue">
        <StateBlock loading={loading} error={error} empty={data.length === 0} emptyText="No properties in this state.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={th()}>Property</th>
                  <th style={th()}>Hotelier</th>
                  <th style={th()}>City</th>
                  <th style={th()}>Star</th>
                  <th style={th()}>Rooms</th>
                  <th style={th()}>Photos</th>
                  <th style={th()}>Flags</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Submitted</th>
                  <th style={th()}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id}>
                    <td style={td()}>{m.property_name}</td>
                    <td style={td()}>{m.hotelier_masked}</td>
                    <td style={td()}>{m.city}</td>
                    <td style={td()}>{m.star_rating}★</td>
                    <td style={td()}>{m.rooms.toLocaleString('en-NG')}</td>
                    <td style={td()}>{m.photos_count.toLocaleString('en-NG')}</td>
                    <td style={td()}>
                      {m.flags.length === 0 ? <span style={{ color: '#9ca3af' }}>—</span> : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {m.flags.map((f) => <Badge key={f} status="flagged" label={f.replace(/_/g, ' ')} />)}
                        </div>
                      )}
                    </td>
                    <td style={td()}><Badge status={m.status} /></td>
                    <td style={td()}>{timeAgo(m.submitted_at)}</td>
                    <td style={td()}>
                      {m.status === 'pending_review' || m.status === 'needs_changes' ? (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button style={btnPrimary()} disabled={busy === m.id} onClick={() => decide(m.id, 'approved')}>Approve</button>
                          <button style={btnDanger()} disabled={busy === m.id} onClick={() => decide(m.id, 'rejected')}>Reject</button>
                          <button style={btn()} disabled={busy === m.id} onClick={() => decide(m.id, 'needs_changes')}>Needs changes</button>
                        </div>
                      ) : <span style={{ color: '#9ca3af' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
