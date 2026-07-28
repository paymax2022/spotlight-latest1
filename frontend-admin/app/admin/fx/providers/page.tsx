'use client';

import { useEffect, useState } from 'react';
import { getProviders, toggleProvider, setBreaker } from '@/services/fxAdminService';
import type { ProviderConfig, BreakerState } from '@/types/fxAdmin';
import { PageHeader, FxTabs, Card, Badge, btn, btnPrimary, money } from '../_ui';

export default function FxProvidersPage() {
  const [rows, setRows] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() { setLoading(true); try { setRows(await getProviders()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try { await fn(); await load(); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Provider Management" subtitle="Directory, health, exposure and circuit breakers." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FxTabs active="providers" />

      {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : rows.map((p) => {
        const exposurePct = Math.round((p.exposureUsedUsdCents / p.exposureLimitUsdCents) * 100);
        return (
          <Card key={p.provider} title={p.displayName} right={
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Badge status={p.adapterStatus} />
              <Badge status={p.enabled ? 'successful' : 'failed'} label={p.enabled ? 'Enabled' : 'Disabled'} />
            </div>
          }>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
              <Metric label="Latency p95" value={`${p.latencyMsP95} ms`} />
              <Metric label="Success rate" value={`${p.successRate}%`} />
              <Metric label="Breaker" value={<Badge status={p.breaker} />} />
              <Metric label="Exposure" value={`${money(p.exposureUsedUsdCents, 'USD')} / ${money(p.exposureLimitUsdCents, 'USD')} (${exposurePct}%)`} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 4 }}>Corridors: {p.corridors.join(', ')}</div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>Rails: {p.rails.join(', ')}</div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button disabled={busy === p.provider} onClick={() => act(p.provider, () => toggleProvider(p.provider, !p.enabled))} style={btn()}>{p.enabled ? 'Disable provider' : 'Enable provider'}</button>
              {p.breaker !== 'open'
                ? <button disabled={busy === `${p.provider}-b`} onClick={() => act(`${p.provider}-b`, () => setBreaker(p.provider, 'open' as BreakerState))} style={btnPrimary('#dc2626')}>Trip breaker</button>
                : <button disabled={busy === `${p.provider}-b`} onClick={() => act(`${p.provider}-b`, () => setBreaker(p.provider, 'closed' as BreakerState))} style={btnPrimary('#16a34a')}>Reset breaker</button>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}
