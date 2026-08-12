'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listSupportTickets, type SupportTicket } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';
import { Page, colors } from '@/components/ui/vuexy';

const STATUSES = ['', 'open', 'pending', 'resolved', 'closed'];

export default function ConnectSupportPage() {
  const [rows, setRows] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  async function load(status: string) {
    setLoading(true); setError(null);
    try { setRows(await listSupportTickets(status || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(filter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <Page>
      <PageHeader title="Support / CRM" subtitle="Triage the support ticket queue. Open a ticket to view the conversation and linked records." action={<button onClick={() => load(filter)} style={btn()}>Refresh</button>} />

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button key={s || 'all'} onClick={() => setFilter(s)} style={{ ...btn(), background: filter === s ? colors.primary : colors.card, color: filter === s ? colors.card : colors.text }}>{s || 'All'}</button>
        ))}
      </div>
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading tickets…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No tickets for this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Subject</th><th style={th()}>User</th><th style={th()}>Category</th><th style={th()}>Priority</th><th style={th()}>Status</th><th style={th()}>Updated</th><th style={th()}></th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td style={td()}><strong>{t.subject}</strong></td>
                  <td style={td()}>{t.user_name}</td>
                  <td style={td()}>{t.category}</td>
                  <td style={td()}><Badge status={t.priority} /></td>
                  <td style={td()}><Badge status={t.status === 'resolved' || t.status === 'closed' ? (t.status === 'resolved' ? 'resolved' : 'closed') : t.status === 'open' ? 'open' : 'normal'} label={t.status} /></td>
                  <td style={td()}>{timeAgo(t.updated_at)}</td>
                  <td style={td()}><Link href={`/admin/connect/support/${t.id}`} style={{ color: colors.info, textDecoration: 'none' }}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
