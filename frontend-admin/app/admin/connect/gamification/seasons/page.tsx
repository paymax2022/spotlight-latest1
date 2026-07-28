'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listSeasonsAdmin, type ConnectSeason } from '@/services/connectAdminOpsService';
import { PageHeader, Card, Badge, btn, th, td } from '../../_ui';

export default function ConnectSeasonsPage() {
  const [rows, setRows] = useState<ConnectSeason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listSeasonsAdmin()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <Link href="/admin/connect/gamification" style={{ color: '#1d4ed8', textDecoration: 'none', fontSize: '0.85rem' }}>← Gamification</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Seasons / events" subtitle="Schedule themed events. Season rewards are non-cash XP/coins." action={<button onClick={load} style={btn()}>Refresh</button>} />

      <Card title="New season (mock)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <Field label="Name"><input style={inputStyle} placeholder="Harmattan Hearts" /></Field>
          <Field label="Theme"><input style={inputStyle} placeholder="Trust-first dating push" /></Field>
          <Field label="Starts"><input style={inputStyle} type="date" /></Field>
          <Field label="Ends"><input style={inputStyle} type="date" /></Field>
        </div>
        <button style={{ ...btn(), marginTop: '0.75rem' }} onClick={() => alert('Mock only — wire to backend in a later phase.')}>Save season</button>
      </Card>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading seasons…</p> : rows.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No seasons configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Season</th><th style={th()}>Theme</th><th style={th()}>Status</th><th style={th()}>Missions</th><th style={th()}>Participants</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={td()}><strong>{s.name}</strong></td>
                  <td style={td()}>{s.theme}</td>
                  <td style={td()}><Badge status={s.status === 'active' ? 'resolved' : s.status === 'scheduled' ? 'normal' : s.status === 'draft' ? 'low' : 'closed'} label={s.status} /></td>
                  <td style={td()}>{s.mission_count}</td>
                  <td style={td()}>{s.participants.toLocaleString()}</td>
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
  return <label style={{ display: 'block', fontSize: '0.78rem', color: '#6b7280', fontWeight: 600 }}>{label}<div style={{ marginTop: 4 }}>{children}</div></label>;
}
