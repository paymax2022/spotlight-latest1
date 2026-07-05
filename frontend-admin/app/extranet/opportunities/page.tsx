'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listOpportunities } from '@/services/staysExtranetService';
import type { Opportunity } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, FilterBar, btn, select, label } from '../_ui';

export default function OpportunitiesPage() {
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listOpportunities()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => impact === 'all' || r.impact === impact);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Opportunity center" subtitle="Personalised recommendations to improve your conversion, visibility and guest experience." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="promotions" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <FilterBar>
        <div><label style={label()}>Impact</label><select style={select()} value={impact} onChange={(e) => setImpact(e.target.value)}>{['all', 'high', 'medium', 'low'].map((i) => <option key={i} value={i}>{i}</option>)}</select></div>
      </FilterBar>

      <StateBlock loading={loading} error={error} empty={filtered.length === 0} emptyText="No opportunities right now — great work!">
        <div style={{ display: 'grid', gap: '0.85rem' }}>
          {filtered.map((o) => (
            <Card key={o.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ maxWidth: 620 }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <strong>{o.title}</strong>
                    <Badge status={o.impact} label={`${o.impact} impact`} />
                    <Badge status="los" label={o.category} />
                  </div>
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '0.85rem' }}>{o.description}</p>
                </div>
                {o.cta_href ? <Link href={o.cta_href} style={{ ...btn(), textDecoration: 'none', alignSelf: 'center' }}>{o.cta_label}</Link> : <button style={btn()}>{o.cta_label}</button>}
              </div>
            </Card>
          ))}
        </div>
      </StateBlock>
    </div>
  );
}
