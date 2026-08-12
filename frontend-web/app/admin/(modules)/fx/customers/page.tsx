'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getCustomers } from '@/services/fxAdminService';
import type { AdminCustomer, CustomerVerification } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, money } from '../_ui';
import { Button, colors, thCell, tdCell } from '@/components/ui/vuexy';

const FILTERS: (CustomerVerification | 'all')[] = ['all', 'pending', 'review', 'approved', 'rejected', 'suspended'];

export default function FxCustomersPage() {
  const [rows, setRows] = useState<AdminCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CustomerVerification | 'all'>('all');

  async function load() { setLoading(true); try { setRows(await getCustomers()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.verification === filter)), [rows, filter]);
  const queue = rows.filter((r) => r.verification === 'pending' || r.verification === 'review').length;

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Customers (KYC/KYB)" subtitle={`${queue} awaiting verification`} action={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <FxTabs active="customers" />

      <Card>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <Button key={f} variant={filter === f ? 'primary' : 'outline'} style={{ textTransform: 'capitalize' }} onClick={() => setFilter(f)}>{f}</Button>
          ))}
        </div>
      </Card>

      <Card>
        {loading ? <p style={{ color: colors.muted }}>Loading…</p> : shown.length === 0 ? <p style={{ color: colors.muted }}>No customers match.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: colors.muted, borderBottom: `1px solid ${colors.border}` }}>
                <th style={thCell}>Name</th><th style={thCell}>Type</th><th style={thCell}>Country</th><th style={thCell}>Tier</th><th style={thCell}>Balance</th><th style={thCell}>Status</th><th style={thCell}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={tdCell}><strong>{c.name}</strong><div style={{ color: colors.muted, fontSize: '0.78rem' }}>{c.email}</div></td>
                  <td style={{ ...tdCell, textTransform: 'capitalize' }}>{c.type}</td>
                  <td style={tdCell}>{c.country}</td>
                  <td style={tdCell}>{c.tier}</td>
                  <td style={tdCell}>{money(c.balanceUsdCents, 'USD')}</td>
                  <td style={tdCell}><Badge status={c.verification === 'approved' ? 'successful' : c.verification === 'rejected' || c.verification === 'suspended' ? 'failed' : 'pending'} label={c.verification} /></td>
                  <td style={{ ...tdCell, textAlign: 'right' }}><Link href={`/admin/fx/customers/${c.id}`} style={{ color: colors.info, textDecoration: 'none', fontWeight: 600 }}>Review →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
