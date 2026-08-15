'use client';

import { useEffect, useState } from 'react';
import { listPayouts, decidePayout, formatNaira } from '@/services/healthVetAdminService';
import type { VetPayoutRecord, VetPayoutDecision } from '@/types/healthVetAdmin';
import { PageHeader, VetTabs, Card, Badge, DisclosureNote, AuditNote, StateBlock, FilterBar, btn, btnPrimary, btnDanger, th, td, input, select, label, fmtDate } from '../../_ui';
import { colors } from '@/components/ui/vuexy';

const STATUSES = ['', 'pending', 'approved', 'paid', 'kyc_hold', 'rejected'];

export default function VetPayoutsPage() {
  const [rows, setRows] = useState<VetPayoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPayouts({ payout_status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function decide(id: string, decision: VetPayoutDecision) {
    setBusy(true); setMsg(null);
    try { const r = await decidePayout(id, decision); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Vet payouts" subtitle="Settle released-to-provider funds (HL-9) to verified vets. KYC-tier + AML gated — payouts are fail-closed until checks clear (HL-10). Amounts in ₦." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <VetTabs active="payouts" />

      <DisclosureNote>
        HL-10 — payouts require the correct KYC tier and an AML check on settlement. Insufficient KYC or an AML
        flag holds the payout fail-closed. Settled funds are the escrow released on consult completion (HL-9).
        Every decision is written to the immutable audit log (HL-12). Amounts shown in ₦ (kobo internally).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Vet, clinic, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Vet / clinic</th><th style={th()}>KYC</th><th style={th()}>AML</th>
              <th style={th()}>Released</th><th style={th()}>Fees</th><th style={th()}>Net payable</th>
              <th style={th()}>Created</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.vet_masked}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.clinic_masked} · {r.id}</div></td>
                  <td style={td()}><Badge status={r.kyc_tier} />{r.kyc_verified ? null : <div style={{ fontSize: '0.7rem', color: colors.danger }}>unverified</div>}</td>
                  <td style={td()}>{r.aml_flag ? <Badge status="flagged" label="AML flag" /> : <Badge status="ok" label="clear" />}</td>
                  <td style={td()}>{formatNaira(r.released_kobo)}</td>
                  <td style={td()}>{formatNaira(r.fees_kobo)}</td>
                  <td style={td()}><strong>{formatNaira(r.net_payable_kobo)}</strong></td>
                  <td style={td()}>{fmtDate(r.created_at)}</td>
                  <td style={td()}><Badge status={r.payout_status} /></td>
                  <td style={td()}>
                    {r.payout_status === 'pending' || r.payout_status === 'kyc_hold' ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button disabled={busy} style={btnPrimary()} onClick={() => decide(r.id, 'approve')}>Approve</button>
                        <button disabled={busy} style={btnDanger()} onClick={() => decide(r.id, 'reject')}>Reject</button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}
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
