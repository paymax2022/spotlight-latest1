'use client';

import { useEffect, useState } from 'react';
import { listReversals, reverseTxn, formatNaira } from '@/services/socialAdminService';
import type { ReversalRecord } from '@/types/socialAdmin';
import { PageHeader, SocialTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnDanger, th, td, input, label, select, timeAgo } from '../../savings/_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Reversal tooling" subtitle="Review and action P2P reversal requests (wrong-recipient, fraud, duplicate)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <SocialTabs active="reversals" />
      <DisclosureNote>NL-8 — a reversal posts a balanced <strong>reversing ledger entry</strong>; no balance column is ever edited and the original entry is never deleted. NL-12 — each reversal records actor, reason and before/after to the immutable audit log.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Txn ref, party or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="pending">Pending</option><option value="reversed">Reversed</option><option value="rejected">Rejected</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No reversal requests match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Txn</th><th style={th()}>From</th><th style={th()}>To</th><th style={th()}>Amount</th>
              <th style={th()}>Reason</th><th style={th()}>Requested by</th><th style={th()}>Status</th><th style={th()}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{r.txn_ref}</code><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{timeAgo(r.requested_at)}</div></td>
                  <td style={td()}>{r.from_masked}</td>
                  <td style={td()}>{r.to_masked}</td>
                  <td style={td()}>{formatNaira(r.amount_kobo)}</td>
                  <td style={td()}><Badge status={r.reason === 'fraud' ? 'high' : 'normal'} label={r.reason.replace(/_/g, ' ')} /></td>
                  <td style={td()}>{r.requested_by_masked}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    {r.status === 'pending'
                      ? <button style={btnDanger()} disabled={busy === r.id} onClick={() => onReverse(r)}>{busy === r.id ? '…' : 'Reverse'}</button>
                      : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>{r.resolved_at ? timeAgo(r.resolved_at) : '—'}</span>}
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
