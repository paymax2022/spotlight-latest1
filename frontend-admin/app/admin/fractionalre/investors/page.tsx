'use client';

// 9.E.1 — Investor list with search & filters.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listInvestors } from '@/services/fractionalreAdminService';
import type { AdminInvestorSummary } from '@/types/fractionalreAdmin';
import { FractionalReTabs, money } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const KYC_COLOR: Record<string, string> = { unverified: colors.secondary, pending: colors.warning, verified: colors.success, rejected: colors.danger, expired: colors.danger };
const CLASS_COLOR: Record<string, string> = { retail: colors.info, qualified: colors.secondary, hni: colors.success, institutional: colors.secondary };

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
    <Page>
      <PageHeader title="Investors" subtitle="Search and filter by KYC status, classification and AUM." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="investors" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Input placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <select value={kyc} onChange={(e) => setKyc(e.target.value)} className="vx-input" style={{ width: 180 }}>
          <option value="">All KYC</option>{['unverified', 'pending', 'verified', 'rejected', 'expired'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={cls} onChange={(e) => setCls(e.target.value)} className="vx-input" style={{ width: 180 }}>
          <option value="">All classifications</option>{['retail', 'qualified', 'hni', 'institutional'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        {loading ? <p style={{ color: colors.muted, padding: 14 }}>Loading investors…</p> : rows.length === 0 ? <p style={{ color: colors.muted, padding: 14 }}>No investors match.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Name</th><th style={thCell}>Email</th><th style={thCell}>KYC</th><th style={thCell}>Class</th><th style={thCell}>AUM</th><th style={thCell}>Holdings</th><th style={thCell} /></tr></thead>
            <tbody>{rows.map((i) => (
              <tr key={i.id}>
                <td style={tdCell}>{i.name}</td><td style={tdCell}>{i.email}</td>
                <td style={tdCell}><Badge text={i.kycStatus} color={KYC_COLOR[i.kycStatus.toLowerCase()] ?? colors.secondary} /></td>
                <td style={tdCell}><Badge text={i.classification} color={CLASS_COLOR[i.classification.toLowerCase()] ?? colors.secondary} /></td>
                <td style={tdCell}>{money(i.aumKobo)}</td><td style={tdCell}>{i.holdingsCount}</td>
                <td style={tdCell}><Link href={`/admin/fractionalre/investors/${i.id}`} style={{ color: colors.info }}>Open →</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
