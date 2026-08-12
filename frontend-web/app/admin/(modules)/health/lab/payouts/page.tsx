'use client';

import { useEffect, useState } from 'react';
import { listPayouts, decidePayout, formatNaira } from '@/services/healthLabAdminService';
import type { LabPayoutRecord, LabPayoutDecision } from '@/types/healthLabAdmin';
import { LabTabs, DisclosureNote, AuditNote, StateBlock, FilterBar, fmtDate } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES = ['', 'pending', 'approved', 'paid', 'kyc_hold', 'rejected'];

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (v === 'tier0') return colors.danger;
  if (v === 'tier1') return colors.warning;
  if (v === 'tier2') return colors.info;
  if (v === 'tier3') return colors.success;
  if (/(reject|fail|block|kyc_hold|hold)/.test(v)) return colors.danger;
  if (/(pending|warn|flag)/.test(v)) return colors.warning;
  if (/(approve|paid|verified|active|complete|ok)/.test(v)) return colors.success;
  return colors.secondary;
}

export default function LabPayoutsPage() {
  const [rows, setRows] = useState<LabPayoutRecord[]>([]);
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

  async function decide(id: string, decision: LabPayoutDecision) {
    setBusy(true); setMsg(null);
    try { const r = await decidePayout(id, decision); setMsg(r.message); await load(); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader title="Lab payouts" subtitle="Settle released-to-provider funds (HL-9) to verified labs. KYC-tier + AML gated — payouts are fail-closed until checks clear (HL-10). Amounts in ₦." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <LabTabs active="payouts" />

      <DisclosureNote>
        HL-10 — payouts require the correct KYC tier and an AML check on settlement. Insufficient KYC or an AML
        flag holds the payout fail-closed. Settled funds are the escrow released on result release/fulfilment
        (HL-9). Every decision is written to the immutable audit log (HL-12). Amounts shown in ₦ (kobo internally).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Lab, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <Button variant="primary" onClick={load}>Apply</Button>
      </FilterBar>

      {msg && <AuditNote>{msg}</AuditNote>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Lab</th><th style={thCell}>KYC</th><th style={thCell}>AML</th>
                <th style={thCell}>Collected</th><th style={thCell}>Fees</th><th style={thCell}>Net payable</th>
                <th style={thCell}>Created</th><th style={thCell}>Status</th><th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}><strong>{r.lab_masked}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                    <td style={tdCell}><Badge text={r.kyc_tier} color={statusColor(r.kyc_tier)} />{r.kyc_verified ? null : <div style={{ fontSize: '0.7rem', color: colors.danger }}>unverified</div>}</td>
                    <td style={tdCell}>{r.aml_flag ? <Badge text="AML flag" color={colors.danger} /> : <Badge text="clear" color={colors.success} />}</td>
                    <td style={tdCell}>{formatNaira(r.collected_kobo)}</td>
                    <td style={tdCell}>{formatNaira(r.fees_kobo)}</td>
                    <td style={tdCell}><strong>{formatNaira(r.net_payable_kobo)}</strong></td>
                    <td style={tdCell}>{fmtDate(r.created_at)}</td>
                    <td style={tdCell}><Badge text={r.payout_status.replace(/_/g, ' ')} color={statusColor(r.payout_status)} /></td>
                    <td style={tdCell}>
                      {r.payout_status === 'pending' || r.payout_status === 'kyc_hold' ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <Button variant="primary" sm disabled={busy} onClick={() => decide(r.id, 'approve')}>Approve</Button>
                          <Button variant="danger" sm disabled={busy} onClick={() => decide(r.id, 'reject')}>Reject</Button>
                        </div>
                      ) : <span style={{ color: colors.muted, fontSize: '0.8rem' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StateBlock>
        </div>
      </Card>
    </Page>
  );
}
