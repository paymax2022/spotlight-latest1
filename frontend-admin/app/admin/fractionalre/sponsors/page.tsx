'use client';

// 9.I — Sponsor / developer portal: KYB + submissions.

import { useEffect, useState } from 'react';
import { listSponsors, createSponsor } from '@/services/fractionalreAdminService';
import type { AdminSponsor } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Badge, btn, btnPrimary, th, td, input, label, money, timeAgo } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Sponsors" subtitle="Developer KYB and asset submissions." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="sponsors" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      <Card title="Onboard sponsor (KYB)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8rem' }}>
          <div><label style={label()}>Entity name</label><input value={form.entityName} onChange={(e) => setForm({ ...form, entityName: e.target.value })} style={input()} /></div>
          <div><label style={label()}>RC number</label><input value={form.rcNumber} onChange={(e) => setForm({ ...form, rcNumber: e.target.value })} style={input()} /></div>
          <div><label style={label()}>Contact name</label><input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} style={input()} /></div>
          <div><label style={label()}>Contact email</label><input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} style={input()} /></div>
          <div style={{ gridColumn: 'span 2' }}><label style={label()}>Track record</label><input value={form.trackRecord} onChange={(e) => setForm({ ...form, trackRecord: e.target.value })} style={input()} /></div>
        </div>
        <button onClick={create} disabled={working || !form.entityName || !form.rcNumber || !form.contactEmail} style={{ ...btnPrimary(), marginTop: '0.8rem', opacity: working || !form.entityName || !form.rcNumber || !form.contactEmail ? 0.6 : 1 }}>{working ? 'Creating…' : 'Create sponsor'}</button>
      </Card>

      <Card title="Sponsor directory">
        {loading ? <p style={{ color: '#6b7280' }}>Loading sponsors…</p> : sponsors.length === 0 ? <p style={{ color: '#6b7280' }}>No sponsors.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Entity</th><th style={th()}>RC</th><th style={th()}>Contact</th><th style={th()}>KYB</th><th style={th()}>Assets</th><th style={th()}>Total raised</th><th style={th()}>Submitted</th></tr></thead>
            <tbody>{sponsors.map((s) => (
              <tr key={s.id}>
                <td style={td()}>{s.entityName}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{s.trackRecord}</div></td>
                <td style={td()}>{s.rcNumber}</td><td style={td()}>{s.contactName}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{s.contactEmail}</div></td>
                <td style={td()}><Badge status={s.kybStatus} /></td>
                <td style={td()}>{s.assetsSubmitted}</td><td style={td()}>{money(s.totalRaisedKobo)}</td><td style={td()}>{timeAgo(s.submittedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
