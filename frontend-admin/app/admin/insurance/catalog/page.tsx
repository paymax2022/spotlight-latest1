'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listProducts, formatNaira } from '@/services/insuranceAdminService';
import type { InsuranceProduct } from '@/types/insuranceAdmin';
import {
  PageHeader, InsuranceTabs, Card, Badge, StateBlock, DisclosureNote,
  btnPrimary, th, td, label, select, input, timeAgo,
} from '../_ui';
import { colors } from '@/components/ui/vuexy';

export default function InsuranceCatalogPage() {
  const [rows, setRows] = useState<InsuranceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<'all' | 'mycover' | 'octamile'>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      const opts: { provider?: string; active?: boolean; q?: string } = {};
      if (provider !== 'all') opts.provider = provider;
      if (activeFilter !== 'all') opts.active = activeFilter === 'active';
      if (q.trim()) opts.q = q.trim();
      setRows(await listProducts(opts));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [provider, activeFilter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Insurance catalog"
        subtitle="Micro-insurance products, each routed to a NAICOM-licensed underwriter via an aggregator. Versioned & feature-flagged."
        action={<Link href="/admin/insurance/catalog/new" style={{ ...btnPrimary(), textDecoration: 'none' }}>New product</Link>}
      />
      <InsuranceTabs active="catalog" />

      <DisclosureNote>
        The underwriter (NAICOM-licensed insurer) is disclosed per product below — every quote, policy and document must surface the same underwriter and aggregator.
      </DisclosureNote>

      <Card title="Products" right={<span style={{ fontSize: '0.75rem', color: colors.muted }}>{rows.length} shown</span>}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <div style={{ minWidth: 160 }}>
            <label style={label()}>Provider</label>
            <select style={select()} value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
              <option value="all">All providers</option>
              <option value="mycover">MyCover.ai</option>
              <option value="octamile">Octamile</option>
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label style={label()}>Status</label>
            <select style={select()} value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={label()}>Search</label>
            <input style={input()} placeholder="Code, name or product line…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No products match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Code</th>
                  <th style={th()}>Name</th>
                  <th style={th()}>Line</th>
                  <th style={th()}>Provider</th>
                  <th style={th()}>Underwriter</th>
                  <th style={th()}>Binding</th>
                  <th style={th()}>Premium model</th>
                  <th style={th()}>KYC</th>
                  <th style={th()}>Base premium</th>
                  <th style={th()}>Commission</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Ver</th>
                  <th style={th()}>Policies</th>
                  <th style={th()}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.code}>
                    <td style={td()}>
                      <Link href={`/admin/insurance/catalog/${encodeURIComponent(p.code)}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                        <code style={{ fontSize: '0.8rem' }}>{p.code}</code>
                      </Link>
                    </td>
                    <td style={td()}>{p.name}</td>
                    <td style={td()}>{p.product_line.replace(/_/g, ' ')}</td>
                    <td style={td()}><Badge status={p.provider} label={p.provider} /></td>
                    <td style={td()}>{p.underwriter}</td>
                    <td style={td()}><Badge status={p.binding_mode} /></td>
                    <td style={td()}>{p.premium_model.replace(/_/g, ' ')}</td>
                    <td style={td()}>Tier {p.required_kyc_tier}</td>
                    <td style={td()}>{formatNaira(p.base_premium_kobo)}</td>
                    <td style={td()}>{p.commission_basis_pct}%</td>
                    <td style={td()}><Badge status={p.active ? 'active' : 'inactive'} label={p.active ? 'Active' : 'Inactive'} /></td>
                    <td style={td()}>v{p.version}</td>
                    <td style={td()}>{p.policies_active.toLocaleString('en-NG')}</td>
                    <td style={td()}>{timeAgo(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StateBlock>
      </Card>
    </div>
  );
}
