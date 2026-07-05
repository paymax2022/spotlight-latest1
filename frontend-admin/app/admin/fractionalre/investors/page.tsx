'use client';

// 9.E.1 — Investor list with search & filters.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listInvestors } from '@/services/fractionalreAdminService';
import type { AdminInvestorSummary } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Badge, btn, th, td, input, money } from '../_ui';

export default function InvestorsListPage() {
  const [investors, setInvestors] = useState<AdminInvestorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kyc, setKyc] = useState('');
  const [cls, setCls] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setInvestors(await listInvestors()); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => investors.filter((i) =>
    (!q || i.name.toLowerCase().includes(q.toLowerCase()) || i.email.toLowerCase().includes(q.toLowerCase())) &&
    (!kyc || i.kycStatus === kyc) && (!cls || i.classification === cls)), [investors, q, kyc, cls]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Investors" subtitle="Search and filter by KYC status, classification and AUM." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="investors" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input(), width: 260 }} />
        <select value={kyc} onChange={(e) => setKyc(e.target.value)} style={{ ...input(), width: 180 }}>
          <option value="">All KYC</option>{['unverified', 'pending', 'verified', 'rejected', 'expired'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={cls} onChange={(e) => setCls(e.target.value)} style={{ ...input(), width: 180 }}>
          <option value="">All classifications</option>{['retail', 'qualified', 'hni', 'institutional'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading investors…</p> : rows.length === 0 ? <p style={{ color: '#6b7280' }}>No investors match.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Name</th><th style={th()}>Email</th><th style={th()}>KYC</th><th style={th()}>Class</th><th style={th()}>AUM</th><th style={th()}>Holdings</th><th style={th()} /></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.id}>
                <td style={td()}>{i.name}</td><td style={td()}>{i.email}</td>
                <td style={td()}><Badge status={i.kycStatus} /></td>
                <td style={td()}><Badge status={i.classification} /></td>
                <td style={td()}>{money(i.aumKobo)}</td><td style={td()}>{i.holdingsCount}</td>
                <td style={td()}><Link href={`/admin/fractionalre/investors/${i.id}`} style={{ color: '#1d4ed8' }}>Open →</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
