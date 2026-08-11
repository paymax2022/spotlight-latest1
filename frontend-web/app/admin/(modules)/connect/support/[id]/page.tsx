'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupportTicket, type SupportTicketDetail } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, td, th, timeAgo } from '../../_ui';
import { Page, colors, tint } from '@/components/ui/vuexy';

export default function ConnectSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setTicket(await getSupportTicket(id)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (loading) return <Page><p style={{ color: colors.muted }}>Loading ticket…</p></Page>;
  if (error || !ticket) return (
    <Page>
      <p style={{ color: colors.danger }}>{error ?? 'Ticket not found'}</p>
      <Link href="/admin/connect/support" style={{ color: colors.info }}>← Back to queue</Link>
    </Page>
  );

  return (
    <Page>
      <Link href="/admin/connect/support" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← Support queue</Link>
      <div style={{ height: 8 }} />
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.user_name} · ${ticket.category}`}
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Badge status={ticket.priority} />
        <Badge status={ticket.status === 'resolved' ? 'resolved' : ticket.status === 'closed' ? 'closed' : ticket.status === 'open' ? 'open' : 'normal'} label={ticket.status} />
        {ticket.linked_case_id ? <span style={{ fontSize: '0.82rem' }}>Linked safety case: <Link href="/admin/connect/cases" style={{ color: colors.info }}>{ticket.linked_case_id}</Link></span> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
        <Card title="Conversation">
          {ticket.messages.length === 0 ? <p style={{ color: colors.muted }}>No messages.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {ticket.messages.map((m) => (
                <div key={m.id} style={{ background: m.role === 'agent' ? tint(colors.primary, 0.06) : colors.bg, border: `1px solid ${colors.border}`, borderRadius: '0.5rem', padding: '0.65rem 0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong style={{ fontSize: '0.82rem' }}>{m.author} <span style={{ color: colors.muted, fontWeight: 400 }}>({m.role})</span></strong>
                    <span style={{ color: colors.muted, fontSize: '0.72rem' }}>{timeAgo(m.created_at)}</span>
                  </div>
                  <p style={{ margin: 0, color: colors.text, fontSize: '0.85rem' }}>{m.body}</p>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: '1rem' }}>
            <textarea placeholder="Reply (mock only)…" style={{ width: '100%', minHeight: 64, padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem' }} />
            <button style={{ ...btn(), marginTop: '0.5rem' }} onClick={() => alert('Mock only — wire to backend in a later phase.')}>Send reply</button>
          </div>
        </Card>

        <Card title="Ticket details">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr><th style={th()}>Ticket ID</th><td style={td()}><code style={{ fontSize: '0.8rem' }}>{ticket.id}</code></td></tr>
              <tr><th style={th()}>User</th><td style={td()}>{ticket.user_name}<div style={{ color: colors.muted, fontSize: '0.72rem' }}>{ticket.user_id}</div></td></tr>
              <tr><th style={th()}>Category</th><td style={td()}>{ticket.category}</td></tr>
              <tr><th style={th()}>Created</th><td style={td()}>{timeAgo(ticket.created_at)}</td></tr>
              <tr><th style={th()}>Updated</th><td style={td()}>{timeAgo(ticket.updated_at)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </Page>
  );
}
