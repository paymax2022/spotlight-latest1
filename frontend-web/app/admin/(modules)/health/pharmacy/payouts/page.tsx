'use client';

import { useEffect, useState } from 'react';
import { listPayouts, decidePayout, formatNaira } from '@/services/healthPharmacyAdminService';
import type { PayoutRecord, PayoutDecision } from '@/types/healthAdmin';
import { PharmacyTabs, DisclosureNote, StateBlock, FilterBar, AuditNote } from '../../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const v = status.toLowerCase();
  if (v === 'tier0') return colors.danger;
  if (v === 'tier1') return colors.warning;
  if (v === 'tier2') return colors.info;
  if (v === 'tier3') return colors.success;
  if (/(reject|fail|block|kyc_hold|hold|flag)/.test(v)) return colors.danger;
  if (/(pending|warn)/.test(v)) return colors.warning;
  if (/(approve|paid|verified|active|complete|ok)/.test(v)) return colors.success;
  return colors.secondary;
}

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
    <Page>
      <PageHeader title="Provider payouts" subtitle="Settle released order revenue to pharmacies. Payouts are KYC-gated and AML-checked; insufficient KYC or an AML flag holds the payout fail-closed." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <PharmacyTabs active="payouts" />
      <DisclosureNote>Provider payouts require the correct KYC tier; AML checks run on every settlement (HL-10). Approving an under-KYC or AML-flagged pharmacy is blocked and stays fail-closed until cleared. Money settled here is revenue already RELEASED from escrow on delivery/pickup (HL-9). Every decision posts an immutable audit event (HL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label>Search</label>
          <Input placeholder="Pharmacy or payout id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label>Payout status</label>
          <select value={payoutStatus} onChange={(e) => setPayoutStatus(e.target.value)}>
            <option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="paid">Paid</option><option value="kyc_hold">KYC hold</option><option value="rejected">Rejected</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ padding: rows.length === 0 || loading || error ? 14 : 0 }}>
          <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No payouts match.">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={thCell}>Pharmacy</th><th style={thCell}>KYC tier</th><th style={thCell}>Collected</th><th style={thCell}>Fees</th>
                <th style={thCell}>Net payable</th><th style={thCell}>AML</th><th style={thCell}>Status</th><th style={thCell}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdCell}>{r.pharmacy_masked}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                    <td style={tdCell}><Badge text={r.kyc_tier} color={statusColor(r.kyc_tier)} />{!r.kyc_verified && <div style={{ marginTop: 4 }}><Badge text="unverified" color={colors.danger} /></div>}</td>
                    <td style={tdCell}>{formatNaira(r.collected_kobo)}</td>
                    <td style={tdCell}>{formatNaira(r.fees_kobo)}</td>
                    <td style={tdCell}>{formatNaira(r.net_payable_kobo)}</td>
                    <td style={tdCell}>{r.aml_flag ? <Badge text="AML flag" color={colors.danger} /> : <Badge text="clear" color={colors.success} />}</td>
                    <td style={tdCell}><Badge text={r.payout_status.replace(/_/g, ' ')} color={statusColor(r.payout_status)} /></td>
                    <td style={tdCell}>
                      {(r.payout_status === 'pending' || r.payout_status === 'kyc_hold') ? (
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <Button variant="primary" sm disabled={busy === r.id} onClick={() => decide(r, 'approve')}>{busy === r.id ? '…' : 'Approve'}</Button>
                          <Button variant="danger" sm disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Reject</Button>
                        </div>
                      ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
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
