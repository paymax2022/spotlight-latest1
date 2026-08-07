'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listEventApprovals, decideEvent } from '@/services/eventsAdminService';
import type { EventApprovalItem, EventApprovalDecision } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select, fmtDate } from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function EventApprovalPage() {
  const [rows, setRows] = useState<EventApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('submitted');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listEventApprovals({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(item: EventApprovalItem, decision: EventApprovalDecision) {
    const note = window.prompt(`${decision.replace('_', ' ')} "${item.title}" (${item.id})? This is an audited decision. Enter a note:`);
    if (note === null) return;
    setBusy(item.id); setMsg(null);
    try {
      const res = await decideEvent(item.id, decision, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Event approval & CMS queue" subtitle="Organiser submissions moving through DRAFT → SUBMITTED → APPROVED / SUSPENDED. Verify CMS completeness and content/policy flags before approving." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EventsTabs active="approval" />
      <DisclosureNote>State machine: <strong>DRAFT → SUBMITTED → APPROVED → LIVE → CLOSED | SUSPENDED</strong>. Approve only when CMS is complete and no policy flags remain. Every decision posts an immutable audit event (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Title, organiser or event id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No events in this queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Event</th><th style={th()}>Organiser</th><th style={th()}>Category</th><th style={th()}>City</th>
              <th style={th()}>Starts</th><th style={th()}>Capacity</th><th style={th()}>CMS</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>
                    <Link href={`/admin/events/events/${r.id}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>{r.title}</Link>
                    <div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id} · {r.tiers_count} tiers{r.cashless_enabled ? ' · cashless' : ''}</div>
                  </td>
                  <td style={td()}>{r.organiser_masked}</td>
                  <td style={td()}>{r.category}</td>
                  <td style={td()}>{r.city}</td>
                  <td style={td()}>{fmtDate(r.starts_at)}</td>
                  <td style={td()}>{r.capacity.toLocaleString('en-NG')}</td>
                  <td style={td()}>
                    <Badge status={r.cms_complete ? 'completed' : 'pending'} label={r.cms_complete ? 'complete' : 'incomplete'} />
                    {r.flagged_terms && <div style={{ marginTop: 4 }}><Badge status="flagged" label="policy flag" /></div>}
                  </td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {(r.status === 'submitted') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button style={btnPrimary()} disabled={busy === r.id} onClick={() => decide(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</button>
                        <button style={btn()} disabled={busy === r.id} onClick={() => decide(r, 'request_changes')}>Changes</button>
                        <button style={btnDanger()} disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Reject</button>
                      </div>
                    ) : r.status === 'approved' || r.status === 'live' ? (
                      <button style={btnDanger()} disabled={busy === r.id} onClick={() => decide(r, 'suspend')}>Suspend</button>
                    ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
