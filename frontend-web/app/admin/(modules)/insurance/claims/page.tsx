'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listClaims, formatNaira } from '@/services/insuranceAdminService';
import type { ClaimSummary, ClaimState } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Badge, btn, th, td, input, label, select, fmtDate, StateBlock } from '../_ui';
import { colors } from '@/components/ui/vuexy';

const CLAIM_STATES: ClaimState[] = [
  'draft', 'fnol_submitted', 'under_assessment', 'needs_more_info',
  'approved', 'payout_pending', 'settled', 'rejected',
];

export default function InsuranceClaimsPage() {
  const [rows, setRows] = useState<ClaimSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [state, setState] = useState('');
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listClaims({
        state: state || undefined,
        provider: provider || undefined,
        q: q || undefined,
      }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [state, provider, q]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Claims"
        subtitle="FNOL through assessment to payout across MyCover and Octamile. Claimant PII is masked; money is in ₦ (kobo minor units)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="claims" />

      <Card title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={label()}>State</label>
            <select style={select()} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              {CLAIM_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label style={label()}>Provider</label>
            <select style={select()} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All providers</option>
              <option value="mycover">MyCover</option>
              <option value="octamile">Octamile</option>
            </select>
          </div>
          <div>
            <label style={label()}>Search</label>
            <input style={input()} placeholder="Ref, claimant or ID" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card title={`Results${rows.length ? ` (${rows.length})` : ''}`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No claims match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Claim ref</th>
                  <th style={th()}>Claimant</th>
                  <th style={th()}>Product</th>
                  <th style={th()}>Provider</th>
                  <th style={th()}>State</th>
                  <th style={th()}>Claimed</th>
                  <th style={th()}>Approved</th>
                  <th style={th()}>Loss event</th>
                  <th style={th()}>Reported</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={td()}>
                      <Link href={`/admin/insurance/claims/${c.id}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                        {c.provider_claim_ref}
                      </Link>
                    </td>
                    <td style={td()}>{c.claimant_masked}</td>
                    <td style={td()}>{c.product_name}</td>
                    <td style={td()}><Badge status={c.provider} /></td>
                    <td style={td()}><Badge status={c.state} /></td>
                    <td style={td()}>{formatNaira(c.claimed_amount_kobo)}</td>
                    <td style={td()}>{formatNaira(c.approved_amount_kobo)}</td>
                    <td style={td()}>{fmtDate(c.loss_event_at)}</td>
                    <td style={td()}>{fmtDate(c.reported_at)}</td>
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
