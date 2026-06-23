'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getCustomers } from '@/services/fxAdminService';
import type { AdminCustomer, CustomerVerification } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, th, td, money } from '../_ui';

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
      <PageHeader title="Customers (KYC/KYB)" subtitle={`${queue} awaiting verification`} action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="customers" />

      <Card>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={{ ...btn(), background: filter === f ? '#1d4ed8' : '#fff', color: filter === f ? '#fff' : '#374151', textTransform: 'capitalize' }}>{f}</button>
          ))}
        </div>
      </Card>

      <Card>
        {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : shown.length === 0 ? <p style={{ color: '#6b7280' }}>No customers match.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th()}>Name</th><th style={th()}>Type</th><th style={th()}>Country</th><th style={th()}>Tier</th><th style={th()}>Balance</th><th style={th()}>Status</th><th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td()}><strong>{c.name}</strong><div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{c.email}</div></td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{c.type}</td>
                  <td style={td()}>{c.country}</td>
                  <td style={td()}>{c.tier}</td>
                  <td style={td()}>{money(c.balanceUsdCents, 'USD')}</td>
                  <td style={td()}><Badge status={c.verification === 'approved' ? 'successful' : c.verification === 'rejected' || c.verification === 'suspended' ? 'failed' : 'pending'} label={c.verification} /></td>
                  <td style={{ ...td(), textAlign: 'right' }}><Link href={`/admin/fx/customers/${c.id}`} style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>Review →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
