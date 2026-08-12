'use client';

import { useEffect, useState } from 'react';
import { listSocialDisputes, formatNaira } from '@/services/socialAdminService';
import type { SocialDispute } from '@/types/socialAdmin';
import { SocialTabs, DisclosureNote, StateBlock, FilterBar, timeAgo } from '../../savings/_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function kindColor(kind: string): string {
  switch (kind) {
    case 'payment':
      return colors.info;
    case 'request':
      return colors.secondary;
    case 'split':
      return colors.info;
    case 'pool':
      return colors.secondary;
    default:
      return colors.secondary;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'resolved':
      return colors.success;
    case 'investigating':
      return colors.info;
    case 'open':
      return colors.warning;
    case 'rejected':
      return colors.danger;
    case 'closed':
      return colors.secondary;
    default:
      return colors.secondary;
  }
}

export default function SocialDisputesPage() {
  const [rows, setRows] = useState<SocialDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listSocialDisputes({ status: status || undefined, kind: kind || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, kind]);

  return (
    <Page>
      <PageHeader title="Disputes" subtitle="Payment, request, split and pool disputes raised on the social-payments rail." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <SocialTabs active="disputes" />
      <DisclosureNote>Dispute resolutions that move money are settled via reversing ledger entries (NL-8); every status change is recorded to the immutable audit log (NL-12).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search</label>
          <Input placeholder="Txn ref, party or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option><option value="payment">Payment</option><option value="request">Request</option><option value="split">Split</option><option value="pool">Pool</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option><option value="closed">Closed</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No disputes match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Dispute</th><th style={thCell}>Kind</th><th style={thCell}>Txn</th><th style={thCell}>Complainant</th>
              <th style={thCell}>Respondent</th><th style={thCell}>Amount</th><th style={thCell}>Reason</th><th style={thCell}>Status</th><th style={thCell}>Updated</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td style={tdCell}>{d.id}<div style={{ fontSize: '0.72rem', color: colors.muted }}>opened {timeAgo(d.opened_at)}</div></td>
                  <td style={tdCell}><Badge text={d.kind} color={kindColor(d.kind)} /></td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{d.txn_ref}</code></td>
                  <td style={tdCell}>{d.complainant_masked}</td>
                  <td style={tdCell}>{d.respondent_masked}</td>
                  <td style={tdCell}>{formatNaira(d.amount_kobo)}</td>
                  <td style={tdCell}>{d.reason.replace(/_/g, ' ')}</td>
                  <td style={tdCell}><Badge text={d.status} color={statusColor(d.status)} /></td>
                  <td style={tdCell}>{timeAgo(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
