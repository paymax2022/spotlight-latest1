'use client';

import { useEffect, useState } from 'react';
import { getProviders } from '@/services/insuranceAdminService';
import type { ProviderConfig } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Badge, btn, StateBlock, DisclosureNote, fmtDate } from '../_ui';

const chip = (): React.CSSProperties => ({ display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 600, color: '#374151', background: '#f3f4f6', whiteSpace: 'nowrap' });
const codeStyle: React.CSSProperties = { fontSize: '0.78rem', background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: '0.25rem', wordBreak: 'break-all' };
const dt = (): React.CSSProperties => ({ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.3, color: '#6b7280', fontWeight: 600, marginBottom: '0.2rem' });

export default function InsuranceProvidersPage() {
  const [data, setData] = useState<ProviderConfig[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getProviders()); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Provider configuration"
        subtitle="Aggregator rails (MyCover.ai, Octamile), credentials (masked), webhook endpoints, signature verification & SLAs."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="providers" />

      <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No providers configured.">
        {data && data.map((p) => (
          <Card
            key={p.provider}
            title={p.display_name}
            right={
              <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <Badge status={p.status} />
                <Badge status={p.sandbox ? 'draft' : 'active'} label={p.sandbox ? 'sandbox' : 'live'} />
              </span>
            }
          >
            <DisclosureNote>NAICOM-licensed insurers behind this rail: {p.underwriters.join(', ')}</DisclosureNote>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.85rem', marginBottom: '1rem' }}>
              <div>
                <div style={dt()}>Base URL</div>
                <code style={codeStyle}>{p.base_url}</code>
              </div>
              <div>
                <div style={dt()}>API key</div>
                <code style={codeStyle}>{p.api_key_masked}</code>
              </div>
              <div>
                <div style={dt()}>Webhook secret</div>
                <code style={codeStyle}>{p.webhook_secret_masked}</code>
              </div>
              <div>
                <div style={dt()}>Webhook URL</div>
                <code style={codeStyle}>{p.webhook_url}</code>
              </div>
              <div>
                <div style={dt()}>Signature verification</div>
                <Badge status={p.signature_verified ? 'active' : 'failed'} label={p.signature_verified ? 'verified' : 'failed'} />
              </div>
              <div>
                <div style={dt()}>Quote SLA (p95)</div>
                <div style={{ fontSize: '0.85rem', color: '#374151' }}>{p.sla_quote_p95_ms.toLocaleString('en-NG')} ms</div>
              </div>
              <div>
                <div style={dt()}>Claim settle SLA</div>
                <div style={{ fontSize: '0.85rem', color: '#374151' }}>&le;{p.sla_claim_settle_minutes}m</div>
              </div>
              <div>
                <div style={dt()}>Updated</div>
                <div style={{ fontSize: '0.85rem', color: '#374151' }}>{fmtDate(p.updated_at)}</div>
              </div>
            </div>

            <div>
              <div style={dt()}>Product lines</div>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {p.product_lines.map((pl) => (
                  <span key={pl} style={chip()}>{pl.replace(/_/g, ' ')}</span>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </StateBlock>
    </div>
  );
}
