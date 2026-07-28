'use client';

import { useEffect, useState } from 'react';
import { listVendors, decideVendorPayout, formatNaira } from '@/services/eventsAdminService';
import type { VendorRecord } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, select } from '../_ui';

export default function VendorsPage() {
  const [rows, setRows] = useState<VendorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payoutStatus, setPayoutStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listVendors({ payout_status: payoutStatus || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [payoutStatus]);

  async function decide(v: VendorRecord, decision: 'approve' | 'reject') {
    const note = window.prompt(`${decision} payout of ${formatNaira(v.net_payable_kobo)} to ${v.name_masked} (${v.id})? This is an audited, KYC-gated action. Enter a note:`);
    if (note === null) return;
    setBusy(v.id); setMsg(null);
    try {
      const res = await decideVendorPayout(v.id, decision, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Vendor management" subtitle="Event vendors, collected float, fees and KYC-gated payouts. Payout is fail-closed until KYC tier clears (NL-10)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EventsTabs active="vendors" />
      <DisclosureNote><strong>NL-10 — KYC payout gate.</strong> A vendor payout cannot be released until the vendor reaches the required KYC tier. Approving a payout for an unverified vendor stays blocked (fail-closed). Every payout decision posts an immutable audit event (NL-12). Amounts ₦ (kobo).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Vendor, event or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Payout status</label>
          <select style={select()} value={payoutStatus} onChange={(e) => setPayoutStatus(e.target.value)}>
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
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No vendors match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Vendor</th><th style={th()}>Event</th><th style={th()}>KYC</th><th style={th()}>Collected</th>
              <th style={th()}>Fees</th><th style={th()}>Net payable</th><th style={th()}>Payout</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td style={td()}>{v.name_masked}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{v.id}</div></td>
                  <td style={td()}>{v.event_title}</td>
                  <td style={td()}>
                    <Badge status={v.kyc_tier} label={v.kyc_tier.toUpperCase()} />
                    <div style={{ marginTop: 4 }}><Badge status={v.kyc_verified ? 'kyc_verified' : 'pending'} label={v.kyc_verified ? 'verified' : 'unverified'} /></div>
                  </td>
                  <td style={td()}>{formatNaira(v.collected_kobo)}</td>
                  <td style={td()}>{formatNaira(v.fees_kobo)}</td>
                  <td style={td()}>{formatNaira(v.net_payable_kobo)}</td>
                  <td style={td()}><Badge status={v.payout_status} /></td>
                  <td style={td()}>
                    {(v.payout_status === 'pending' || v.payout_status === 'kyc_hold') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button style={btnPrimary()} disabled={busy === v.id} title={!v.kyc_verified ? 'Blocked — KYC tier insufficient (NL-10)' : undefined} onClick={() => decide(v, 'approve')}>{busy === v.id ? '…' : 'Approve payout'}</button>
                        <button style={btnDanger()} disabled={busy === v.id} onClick={() => decide(v, 'reject')}>Reject</button>
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
