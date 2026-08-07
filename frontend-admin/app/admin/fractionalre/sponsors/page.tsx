'use client';

// 9.I — Sponsor / developer portal: KYB + submissions.

import { useEffect, useState } from 'react';
import { listSponsors, createSponsor } from '@/services/fractionalreAdminService';
import type { AdminSponsor } from '@/types/fractionalreAdmin';
import { FractionalReTabs, money, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const KYB_COLOR: Record<string, string> = { pending: colors.warning, verified: colors.success, approved: colors.success, rejected: colors.danger, underreview: colors.warning };

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

export default function SponsorsPage() {
  const [sponsors, setSponsors] = useState<AdminSponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState({ entityName: '', rcNumber: '', contactName: '', contactEmail: '', trackRecord: '' });

  async function load() {
    setLoading(true); setError(null);
    try { setSponsors(await listSponsors()); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.entityName || !form.rcNumber || !form.contactEmail) return;
    setWorking(true); setError(null); setMsg(null);
    try { await createSponsor(form); setMsg('Sponsor created (KYB pending).'); setForm({ entityName: '', rcNumber: '', contactName: '', contactEmail: '', trackRecord: '' }); await load(); }
    catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  return (
    <Page>
      <PageHeader title="Sponsors" subtitle="Developer KYB and asset submissions." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="sponsors" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      <Card title="Onboard sponsor (KYB)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8rem' }}>
          <div><label style={labelStyle}>Entity name</label><Input value={form.entityName} onChange={(e) => setForm({ ...form, entityName: e.target.value })} /></div>
          <div><label style={labelStyle}>RC number</label><Input value={form.rcNumber} onChange={(e) => setForm({ ...form, rcNumber: e.target.value })} /></div>
          <div><label style={labelStyle}>Contact name</label><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
          <div><label style={labelStyle}>Contact email</label><Input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
          <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Track record</label><Input value={form.trackRecord} onChange={(e) => setForm({ ...form, trackRecord: e.target.value })} /></div>
        </div>
        <Button variant="primary" onClick={create} disabled={working || !form.entityName || !form.rcNumber || !form.contactEmail} style={{ marginTop: '0.8rem' }}>{working ? 'Creating…' : 'Create sponsor'}</Button>
      </Card>

      <Card title="Sponsor directory">
        {loading ? <p style={{ color: colors.muted }}>Loading sponsors…</p> : sponsors.length === 0 ? <p style={{ color: colors.muted }}>No sponsors.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Entity</th><th style={thCell}>RC</th><th style={thCell}>Contact</th><th style={thCell}>KYB</th><th style={thCell}>Assets</th><th style={thCell}>Total raised</th><th style={thCell}>Submitted</th></tr></thead>
            <tbody>{sponsors.map((s) => (
              <tr key={s.id}>
                <td style={tdCell}>{s.entityName}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{s.trackRecord}</div></td>
                <td style={tdCell}>{s.rcNumber}</td><td style={tdCell}>{s.contactName}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{s.contactEmail}</div></td>
                <td style={tdCell}><Badge text={s.kybStatus} color={KYB_COLOR[s.kybStatus.toLowerCase()] ?? colors.secondary} /></td>
                <td style={tdCell}>{s.assetsSubmitted}</td><td style={tdCell}>{money(s.totalRaisedKobo)}</td><td style={tdCell}>{timeAgo(s.submittedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
