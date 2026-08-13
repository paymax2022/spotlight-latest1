'use client';

import { useEffect, useState } from 'react';
import { listReversals, reverseTxn, formatNaira } from '@/services/socialAdminService';
import type { ReversalRecord } from '@/types/socialAdmin';
import { SocialTabs, DisclosureNote, StateBlock, FilterBar, AuditNote, timeAgo } from '../../savings/_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  switch (status) {
    case 'reversed':
      return colors.success;
    case 'pending':
      return colors.warning;
    case 'rejected':
      return colors.danger;
    default:
      return colors.secondary;
  }
}

export default function ReversalsPage() {
  const [rows, setRows] = useState<ReversalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listReversals({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function onReverse(r: ReversalRecord) {
    const reason = window.prompt(`Reverse ${formatNaira(r.amount_kobo)} on ${r.txn_ref}? This posts a reversing ledger entry (audited). Enter a reason:`);
    if (!reason) return;
    setBusy(r.id); setMsg(null);
    try {
      const res = await reverseTxn(r.id, reason);
      setMsg(res.message + ` (reversing entry ${res.reversing_entry_id}, audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Reversal tooling" subtitle="Review and action P2P reversal requests (wrong-recipient, fraud, duplicate)." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <SocialTabs active="reversals" />
      <DisclosureNote>NL-8 — a reversal posts a balanced <strong>reversing ledger entry</strong>; no balance column is ever edited and the original entry is never deleted. NL-12 — each reversal records actor, reason and before/after to the immutable audit log.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search</label>
          <Input placeholder="Txn ref, party or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="pending">Pending</option><option value="reversed">Reversed</option><option value="rejected">Rejected</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No reversal requests match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Txn</th><th style={thCell}>From</th><th style={thCell}>To</th><th style={thCell}>Amount</th>
              <th style={thCell}>Reason</th><th style={thCell}>Requested by</th><th style={thCell}>Status</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{r.txn_ref}</code><div style={{ fontSize: '0.72rem', color: colors.muted }}>{timeAgo(r.requested_at)}</div></td>
                  <td style={tdCell}>{r.from_masked}</td>
                  <td style={tdCell}>{r.to_masked}</td>
                  <td style={tdCell}>{formatNaira(r.amount_kobo)}</td>
                  <td style={tdCell}><Badge text={r.reason.replace(/_/g, ' ')} color={r.reason === 'fraud' ? colors.danger : colors.secondary} /></td>
                  <td style={tdCell}>{r.requested_by_masked}</td>
                  <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                  <td style={tdCell}>
                    {r.status === 'pending'
                      ? <Button sm variant="danger" disabled={busy === r.id} onClick={() => onReverse(r)}>{busy === r.id ? '…' : 'Reverse'}</Button>
                      : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>{r.resolved_at ? timeAgo(r.resolved_at) : '—'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
