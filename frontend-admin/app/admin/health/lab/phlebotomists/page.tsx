'use client';

import { useEffect, useState } from 'react';
import { listPhlebotomists } from '@/services/healthLabAdminService';
import type { Phlebotomist } from '@/types/healthLabAdmin';
import { PageHeader, LabTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, btnPrimary, th, td, input, select, label, fmtDate } from '../../_ui';

const STATUSES = ['', 'active', 'pending', 'suspended', 'expired'];

export default function PhlebotomistsPage() {
  const [rows, setRows] = useState<Phlebotomist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPhlebotomists({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Phlebotomist management" subtitle="Field collectors dispatched on the last-mile rail. Credential, KYC and custody-quality (HL-6) signals at a glance; licences auto-suspend on expiry (HL-2)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <LabTabs active="phlebotomists" />

      <DisclosureNote>
        Phlebotomists must hold a valid licence (HL-2) and clear KYC before dispatch. Custody-break counts are a
        quality signal under HL-6 — repeated breaks trigger review. Personal data is masked under NDPA (HL-8).
      </DisclosureNote>

      <FilterBar>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Name, licence no, state, id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btnPrimary()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No phlebotomists match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Phlebotomist</th><th style={th()}>Licence</th><th style={th()}>Expiry</th>
              <th style={th()}>State</th><th style={th()}>KYC</th><th style={th()}>Collections (30d)</th>
              <th style={th()}>Custody breaks</th><th style={th()}>Rating</th><th style={th()}>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.name_masked}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.licence_no}</code></td>
                  <td style={td()}>{fmtDate(r.licence_expires_at)}{r.licence_expires_at && new Date(r.licence_expires_at) < new Date() ? <div style={{ fontSize: '0.7rem', color: '#b91c1c' }}>expired</div> : null}</td>
                  <td style={td()}>{r.state}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.lga}</div></td>
                  <td style={td()}><Badge status={r.kyc_tier} />{r.kyc_verified ? null : <div style={{ fontSize: '0.7rem', color: '#b91c1c' }}>unverified</div>}</td>
                  <td style={td()}>{r.collections_30d.toLocaleString('en-NG')}</td>
                  <td style={td()}>{r.custody_breaks_30d > 0 ? <Badge status={r.custody_breaks_30d >= 3 ? 'high' : 'medium'} label={String(r.custody_breaks_30d)} /> : '0'}</td>
                  <td style={td()}>{r.rating > 0 ? `${r.rating.toFixed(1)} ★` : '—'}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
