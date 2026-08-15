'use client';

import { useEffect, useState } from 'react';
import { getProviders } from '@/services/insuranceAdminService';
import type { ProviderConfig } from '@/types/insuranceAdmin';
import { InsuranceTabs, StateBlock, DisclosureNote, fmtDate } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors } from '@/components/ui/vuexy';

const chip: React.CSSProperties = { display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: 9999, fontSize: 12, fontWeight: 600, color: colors.text, background: colors.headBg, whiteSpace: 'nowrap' };
const codeStyle: React.CSSProperties = { fontSize: 12, background: colors.headBg, padding: '0.1rem 0.35rem', borderRadius: 4, wordBreak: 'break-all' };
const dt: React.CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: colors.muted, fontWeight: 600, marginBottom: 3 };

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
    <Page>
      <PageHeader
        title="Provider configuration"
        subtitle="Aggregator rails (MyCover.ai, Octamile), credentials (masked), webhook endpoints, signature verification & SLAs."
        actions={<Button variant="outline" onClick={load}>Refresh</Button>}
      />
      <InsuranceTabs active="providers" />

      <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No providers configured.">
        {data && data.map((p) => (
          <Card
            key={p.provider}
            title={p.display_name}
            style={{ marginBottom: 16 }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <Badge text={p.status} color={p.status.toLowerCase() === 'active' || p.status.toLowerCase() === 'healthy' || p.status.toLowerCase() === 'up' ? colors.success : p.status.toLowerCase() === 'down' ? colors.danger : colors.warning} />
              <Badge text={p.sandbox ? 'sandbox' : 'live'} color={p.sandbox ? colors.secondary : colors.success} />
            </div>

            <DisclosureNote>NAICOM-licensed insurers behind this rail: {p.underwriters.join(', ')}</DisclosureNote>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginBottom: 16 }}>
              <div>
                <div style={dt}>Base URL</div>
                <code style={codeStyle}>{p.base_url}</code>
              </div>
              <div>
                <div style={dt}>API key</div>
                <code style={codeStyle}>{p.api_key_masked}</code>
              </div>
              <div>
                <div style={dt}>Webhook secret</div>
                <code style={codeStyle}>{p.webhook_secret_masked}</code>
              </div>
              <div>
                <div style={dt}>Webhook URL</div>
                <code style={codeStyle}>{p.webhook_url}</code>
              </div>
              <div>
                <div style={dt}>Signature verification</div>
                <Badge text={p.signature_verified ? 'verified' : 'failed'} color={p.signature_verified ? colors.success : colors.danger} />
              </div>
              <div>
                <div style={dt}>Quote SLA (p95)</div>
                <div style={{ fontSize: 13, color: colors.text }}>{p.sla_quote_p95_ms.toLocaleString('en-NG')} ms</div>
              </div>
              <div>
                <div style={dt}>Claim settle SLA</div>
                <div style={{ fontSize: 13, color: colors.text }}>&le;{p.sla_claim_settle_minutes}m</div>
              </div>
              <div>
                <div style={dt}>Updated</div>
                <div style={{ fontSize: 13, color: colors.text }}>{fmtDate(p.updated_at)}</div>
              </div>
            </div>

            <div>
              <div style={dt}>Product lines</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {p.product_lines.map((pl) => (
                  <span key={pl} style={chip}>{pl.replace(/_/g, ' ')}</span>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </StateBlock>
    </Page>
  );
}
