'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listSeasonsAdmin, type ConnectSeason } from '@/services/connectAdminOpsService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

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
    <Page>
      <Link href="/admin/connect/gamification" style={{ color: colors.info, textDecoration: 'none', fontSize: '0.85rem' }}>← Gamification</Link>
      <div style={{ height: 8 }} />
      <PageHeader title="Seasons / events" subtitle="Schedule themed events. Season rewards are non-cash XP/coins." actions={<Button variant="outline" sm onClick={load}>Refresh</Button>} />

      <Card title="New season (mock)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          <Field label="Name"><Input placeholder="Harmattan Hearts" /></Field>
          <Field label="Theme"><Input placeholder="Trust-first dating push" /></Field>
          <Field label="Starts"><Input type="date" /></Field>
          <Field label="Ends"><Input type="date" /></Field>
        </div>
        <Button variant="primary" style={{ marginTop: '0.75rem' }} onClick={() => alert('Mock only — wire to backend in a later phase.')}>Save season</Button>
      </Card>

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading seasons…</p> : rows.length === 0 ? (
          <p style={{ color: colors.muted }}>No seasons configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Season</th><th style={thCell}>Theme</th><th style={thCell}>Status</th><th style={thCell}>Missions</th><th style={thCell}>Participants</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={tdCell}><strong>{s.name}</strong></td>
                  <td style={tdCell}>{s.theme}</td>
                  <td style={tdCell}><Badge text={s.status} color={s.status === 'active' ? colors.success : s.status === 'scheduled' ? colors.info : s.status === 'draft' ? colors.secondary : colors.secondary} /></td>
                  <td style={tdCell}>{s.mission_count}</td>
                  <td style={tdCell}>{s.participants.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: '0.78rem', color: colors.muted, fontWeight: 600 }}>{label}<div style={{ marginTop: 4 }}>{children}</div></label>;
}
