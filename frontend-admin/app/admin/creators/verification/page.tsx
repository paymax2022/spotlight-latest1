'use client';

import { useEffect, useState } from 'react';
import { listCreatorVerifications, decideCreator } from '@/services/creatorsAdminService';
import type { CreatorVerificationItem, CreatorDecision } from '@/types/creatorsAdmin';
import { PageHeader, CreatorsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select } from '../_ui';

export default function CreatorVerificationPage() {
  const [rows, setRows] = useState<CreatorVerificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('submitted');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCreatorVerifications({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(item: CreatorVerificationItem, decision: CreatorDecision) {
    const note = window.prompt(`${decision.replace('_', ' ')} "${item.handle_masked}" (${item.id})? This is an audited decision. Enter a note:`);
    if (note === null) return;
    setBusy(item.id); setMsg(null);
    try {
      const res = await decideCreator(item.id, decision, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Creator verification queue" subtitle="Become-a-creator submissions moving through SUBMITTED → IN_REVIEW → APPROVED / REJECTED. Verify identity, storefront completeness and policy flags before approving." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <CreatorsTabs active="verification" />
      <DisclosureNote>Approval requires verified identity (ID docs) and a complete storefront. Payout-KYC tier is also gated downstream (NL-10). Creators sell perks/content, never financial returns (NL-5). Every decision posts an immutable audit event (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Handle, legal name or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="submitted">Submitted</option>
            <option value="in_review">In review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No creators in this queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Creator</th><th style={th()}>Category</th><th style={th()}>City</th><th style={th()}>Followers</th>
              <th style={th()}>KYC</th><th style={th()}>Storefront / docs</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>
                    <strong>{r.handle_masked}</strong>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.legal_name_masked} · {r.id}</div>
                  </td>
                  <td style={td()}>{r.category}</td>
                  <td style={td()}>{r.city}</td>
                  <td style={td()}>{r.followers.toLocaleString('en-NG')}</td>
                  <td style={td()}>
                    <Badge status={r.kyc_tier} />
                    {!r.kyc_verified && <div style={{ marginTop: 4 }}><Badge status="kyc_hold" label="unverified" /></div>}
                  </td>
                  <td style={td()}>
                    <Badge status={r.storefront_complete ? 'completed' : 'pending'} label={r.storefront_complete ? 'store ok' : 'store incomplete'} />
                    <div style={{ marginTop: 4 }}><Badge status={r.id_docs_present ? 'approved' : 'rejected'} label={r.id_docs_present ? 'ID present' : 'no ID'} /></div>
                    {r.flagged_terms && <div style={{ marginTop: 4 }}><Badge status="flagged" label="policy flag" /></div>}
                  </td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {(r.status === 'submitted' || r.status === 'in_review') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button style={btnPrimary()} disabled={busy === r.id} onClick={() => decide(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</button>
                        <button style={btn()} disabled={busy === r.id} onClick={() => decide(r, 'request_changes')}>Changes</button>
                        <button style={btnDanger()} disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Reject</button>
                      </div>
                    ) : r.status === 'approved' ? (
                      <button style={btnDanger()} disabled={busy === r.id} onClick={() => decide(r, 'suspend')}>Suspend</button>
                    ) : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>—</span>}
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
