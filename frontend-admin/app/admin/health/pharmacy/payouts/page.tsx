'use client';

import { useEffect, useState } from 'react';
import { listPayouts, decidePayout, formatNaira } from '@/services/healthPharmacyAdminService';
import type { PayoutRecord, PayoutDecision } from '@/types/healthAdmin';
import { PageHeader, PharmacyTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select } from '../../_ui';

export default function PayoutsPage() {
  const [rows, setRows] = useState<PayoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payoutStatus, setPayoutStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPayouts({ payout_status: payoutStatus || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [payoutStatus]);

  async function decide(item: PayoutRecord, decision: PayoutDecision) {
    const note = window.prompt(`${decision} payout for ${item.pharmacy_masked} (${item.id})? Audited KYC-gated decision — enter a note:`);
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
      <PageHeader title="Provider payouts" subtitle="Settle released order revenue to pharmacies. Payouts are KYC-gated and AML-checked; insufficient KYC or an AML flag holds the payout fail-closed." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <PharmacyTabs active="payouts" />
      <DisclosureNote>Provider payouts require the correct KYC tier; AML checks run on every settlement (HL-10). Approving an under-KYC or AML-flagged pharmacy is blocked and stays fail-closed until cleared. Money settled here is revenue already RELEASED from escrow on delivery/pickup (HL-9). Every decision posts an immutable audit event (HL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Pharmacy or payout id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Payout status</label>
          <select style={select()} value={payoutStatus} onChange={(e) => setPayoutStatus(e.target.value)}>
            <option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="paid">Paid</option><option value="kyc_hold">KYC hold</option><option value="rejected">Rejected</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Pharmacy</th><th style={th()}>KYC tier</th><th style={th()}>Collected</th><th style={th()}>Fees</th>
              <th style={th()}>Net payable</th><th style={th()}>AML</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.pharmacy_masked}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}><Badge status={r.kyc_tier} />{!r.kyc_verified && <div style={{ marginTop: 4 }}><Badge status="kyc_hold" label="unverified" /></div>}</td>
                  <td style={td()}>{formatNaira(r.collected_kobo)}</td>
                  <td style={td()}>{formatNaira(r.fees_kobo)}</td>
                  <td style={td()}>{formatNaira(r.net_payable_kobo)}</td>
                  <td style={td()}>{r.aml_flag ? <Badge status="flagged" label="AML flag" /> : <Badge status="ok" label="clear" />}</td>
                  <td style={td()}><Badge status={r.payout_status} /></td>
                  <td style={td()}>
                    {(r.payout_status === 'pending' || r.payout_status === 'kyc_hold') ? (
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
