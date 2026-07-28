'use client';

import { useEffect, useState } from 'react';
import { getVisibilityBooster } from '@/services/staysExtranetService';
import type { VisibilityBooster } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, Kpi, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, pct } from '../_ui';

export default function VisibilityPage() {
  const [data, setData] = useState<VisibilityBooster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getVisibilityBooster()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Visibility Booster" subtitle="Trade a small commission uplift for higher placement in Paymax Stays search results." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="promotions" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <Card title="Status" right={<Badge status="scheduled" label="Phase 3 — coming soon" />}>
              <p style={{ fontSize: '0.85rem', color: '#374151', background: '#f9fafb', borderRadius: '0.5rem', padding: '0.7rem 0.9rem' }}>{data.note}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
                <Kpi label="Current search rank" value={data.current_rank ? `#${data.current_rank}` : '—'} sub="In your area & star band" />
                <Kpi label="Suggested commission uplift" value={data.suggested_commission_uplift_pct ? pct(data.suggested_commission_uplift_pct) : '—'} sub="When Booster launches" />
                <Kpi label="Booster enabled" value={data.enabled ? 'Yes' : 'No'} accent={data.enabled ? '#15803d' : '#6b7280'} />
              </div>
              <button style={{ ...btnPrimary(), marginTop: '1rem', opacity: 0.6, cursor: 'not-allowed' }} disabled>Enable Visibility Booster (Phase 3)</button>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
