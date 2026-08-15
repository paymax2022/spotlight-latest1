'use client';

import { useEffect, useState } from 'react';
import { listComms, type ConnectComm } from '@/services/connectAdminOpsService';
import { timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const TYPES = ['', 'announcement', 'push', 'banner'];

export default function ConnectCommsPage() {
  const [rows, setRows] = useState<ConnectComm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listComms()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const visible = filter ? rows.filter((c) => c.type === filter) : rows;

  return (
    <Page>
      <PageHeader title="Announcements & push" subtitle="In-app announcements, push and banner templates. Targeted comms." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />

      <Card title="Composer (mock)" style={{ marginBottom: 16 }}>
        <p style={{ color: colors.muted, fontSize: '0.82rem', margin: '10px 0 0.75rem' }}>Composer is mock-only; sending wires to the backend in a later phase.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <Field label="Title"><Input style={{ width: '100%' }} placeholder="Verify to unlock matching" /></Field>
          <Field label="Type">
            <select style={selectStyle} defaultValue="push"><option value="announcement">Announcement</option><option value="push">Push</option><option value="banner">Banner</option></select>
          </Field>
          <Field label="Audience"><Input style={{ width: '100%' }} placeholder="All verified · Lagos" /></Field>
        </div>
        <Field label="Body"><textarea style={{ ...selectStyle, width: '100%', minHeight: 64 }} placeholder="Message body…" /></Field>
        <Button variant="primary" style={{ marginTop: '0.75rem' }} onClick={() => alert('Mock only — wire to backend in a later phase.')}>Schedule</Button>
      </Card>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TYPES.map((t) => (
          <Button key={t || 'all'} variant={filter === t ? 'primary' : 'outline'} sm onClick={() => setFilter(t)}>{t || 'All'}</Button>
        ))}
      </div>
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading comms…</p> : visible.length === 0 ? (
          <p style={{ color: colors.muted, padding: 14 }}>No communications for this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Title</th><th style={thCell}>Type</th><th style={thCell}>Audience</th><th style={thCell}>Status</th><th style={thCell}>When</th></tr></thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}><strong>{c.title}</strong>{c.body ? <div style={{ color: colors.muted, fontSize: '0.78rem' }}>{c.body}</div> : null}</td>
                  <td style={tdCell}>{c.type}</td>
                  <td style={tdCell}>{c.audience}</td>
                  <td style={tdCell}><Badge text={c.status} color={c.status === 'sent' ? colors.success : c.status === 'scheduled' ? colors.info : colors.secondary} /></td>
                  <td style={tdCell}>{c.sent_at ? `Sent ${timeAgo(c.sent_at)}` : c.scheduled_at ? `Scheduled ${timeAgo(c.scheduled_at)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

const selectStyle = { padding: '0.4rem 0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem' } as const;
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: '0.78rem', color: colors.muted, fontWeight: 600, marginTop: '0.5rem' }}>{label}<div style={{ marginTop: 4 }}>{children}</div></label>;
}
