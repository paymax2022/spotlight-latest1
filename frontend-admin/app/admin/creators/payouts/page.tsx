'use client';

import { useEffect, useState } from 'react';
import { listCreatorPayouts, decidePayout, formatNaira } from '@/services/creatorsAdminService';
import type { CreatorPayoutItem, PayoutDecision } from '@/types/creatorsAdmin';
import { PageHeader, CreatorsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select, timeAgo } from '../_ui';

export default function CreatorPayoutsPage() {
  const [rows, setRows] = useState<CreatorPayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listCreatorPayouts({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(item: CreatorPayoutItem, decision: PayoutDecision) {
    const note = window.prompt(`${decision} payout for "${item.creator_handle_masked}" (${formatNaira(item.net_payable_kobo)})? This is an audited, KYC-gated decision (NL-10). Enter a note:`);
    if (note === null) return;
    setBusy(item.id); setMsg(null);
    try {
      const res = await decidePayout(item.id, decision, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Creator payout queue" subtitle="Creator earnings withdrawals. Payouts are KYC-gated — approval is blocked fail-closed until the creator reaches the required KYC tier." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <CreatorsTabs active="payouts" />
      <DisclosureNote><strong>NL-10 — KYC gates & AML.</strong> Creator payouts require the right KYC tier. Approving an under-verified creator is blocked fail-closed and stays on KYC hold. Earnings are a ledger projection, never a balance integer (NL-8). Every decision posts an immutable audit event (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Creator handle or payout id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="kyc_hold">KYC hold</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts in this queue.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Creator</th><th style={th()}>KYC</th><th style={th()}>Gross</th><th style={th()}>Fees</th>
              <th style={th()}>Net payable</th><th style={th()}>Bank</th><th style={th()}>Requested</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.creator_handle_masked}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}>
                    <Badge status={r.kyc_tier} />
                    {!r.kyc_verified && <div style={{ marginTop: 4 }}><Badge status="kyc_hold" label="unverified" /></div>}
                  </td>
                  <td style={td()}>{formatNaira(r.gross_earnings_kobo)}</td>
                  <td style={td()}>{formatNaira(r.fees_kobo)}</td>
                  <td style={td()}><strong>{formatNaira(r.net_payable_kobo)}</strong></td>
                  <td style={td()}>{r.bank_masked}</td>
                  <td style={td()}>{timeAgo(r.requested_at)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {(r.status === 'pending' || r.status === 'kyc_hold') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button style={btnPrimary()} disabled={busy === r.id} onClick={() => decide(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</button>
                        <button style={btnDanger()} disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Reject</button>
                      </div>
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
