'use client';

import { useEffect, useState } from 'react';
import { listComms, type ConnectComm } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, th, td, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Announcements & push" subtitle="In-app announcements, push and banner templates. Targeted comms." action={<button onClick={load} style={btn()}>Refresh</button>} />

      <Card title="Composer (mock)">
        <p style={{ color: '#6b7280', fontSize: '0.82rem', margin: '0 0 0.75rem' }}>Composer is mock-only; sending wires to the backend in a later phase.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <Field label="Title"><input style={inputStyle} placeholder="Verify to unlock matching" /></Field>
          <Field label="Type">
            <select style={inputStyle} defaultValue="push"><option value="announcement">Announcement</option><option value="push">Push</option><option value="banner">Banner</option></select>
          </Field>
          <Field label="Audience"><input style={inputStyle} placeholder="All verified · Lagos" /></Field>
        </div>
        <Field label="Body"><textarea style={{ ...inputStyle, minHeight: 64 }} placeholder="Message body…" /></Field>
        <button style={{ ...btn(), marginTop: '0.75rem' }} onClick={() => alert('Mock only — wire to backend in a later phase.')}>Schedule</button>
      </Card>

      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TYPES.map((t) => (
          <button key={t || 'all'} onClick={() => setFilter(t)} style={{ ...btn(), background: filter === t ? '#340075' : '#fff', color: filter === t ? '#fff' : '#374151' }}>{t || 'All'}</button>
        ))}
      </div>
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading comms…</p> : visible.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No communications for this filter.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Title</th><th style={th()}>Type</th><th style={th()}>Audience</th><th style={th()}>Status</th><th style={th()}>When</th></tr></thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td style={td()}><strong>{c.title}</strong>{c.body ? <div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{c.body}</div> : null}</td>
                  <td style={td()}>{c.type}</td>
                  <td style={td()}>{c.audience}</td>
                  <td style={td()}><Badge status={c.status === 'sent' ? 'resolved' : c.status === 'scheduled' ? 'normal' : 'low'} label={c.status} /></td>
                  <td style={td()}>{c.sent_at ? `Sent ${timeAgo(c.sent_at)}` : c.scheduled_at ? `Scheduled ${timeAgo(c.scheduled_at)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const inputStyle = { width: '100%', padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' } as const;
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: '0.78rem', color: '#6b7280', fontWeight: 600, marginTop: '0.5rem' }}>{label}<div style={{ marginTop: 4 }}>{children}</div></label>;
}
