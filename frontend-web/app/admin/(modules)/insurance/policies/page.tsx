'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listPolicies, formatNaira } from '@/services/insuranceAdminService';
import type { PolicySummary, PolicyState } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Badge, btn, th, td, input, label, select, fmtDate, StateBlock } from '../_ui';
import { colors } from '@/components/ui/vuexy';

const POLICY_STATES: PolicyState[] = [
  'quoted', 'pending_payment', 'binding', 'active', 'renewal_due',
  'lapsed', 'cancelled', 'expired', 'bind_failed', 'payment_failed', 'void',
];

export default function InsurancePoliciesPage() {
  const [rows, setRows] = useState<PolicySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [state, setState] = useState('');
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      setRows(await listPolicies({
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
        title="Policies"
        subtitle="Search and inspect bound, pending and failed policies across MyCover and Octamile. Policyholder PII is masked; money is in ₦ (kobo minor units)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <InsuranceTabs active="policies" />

      <Card title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          <div>
            <label style={label()}>State</label>
            <select style={select()} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              {POLICY_STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
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
            <input style={input()} placeholder="Ref, policyholder or ID" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card title={`Results${rows.length ? ` (${rows.length})` : ''}`}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No policies match these filters.">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th()}>Policy ref</th>
                  <th style={th()}>Policyholder</th>
                  <th style={th()}>Product</th>
                  <th style={th()}>Provider</th>
                  <th style={th()}>Binding</th>
                  <th style={th()}>State</th>
                  <th style={th()}>Sum insured</th>
                  <th style={th()}>Premium</th>
                  <th style={th()}>Effective</th>
                  <th style={th()}>Expires</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={td()}>
                      <Link href={`/admin/insurance/policies/${p.id}`} style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
                        {p.provider_policy_ref}
                      </Link>
                    </td>
                    <td style={td()}>{p.policyholder_masked}</td>
                    <td style={td()}>{p.product_name}</td>
                    <td style={td()}><Badge status={p.provider} /></td>
                    <td style={td()}><Badge status={p.binding_mode} /></td>
                    <td style={td()}><Badge status={p.state} /></td>
                    <td style={td()}>{formatNaira(p.sum_insured_kobo)}</td>
                    <td style={td()}>{formatNaira(p.premium_kobo)}</td>
                    <td style={td()}>{fmtDate(p.effective_at)}</td>
                    <td style={td()}>{fmtDate(p.expires_at)}</td>
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
