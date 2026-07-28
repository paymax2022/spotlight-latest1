'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getConsentAudit } from '@/services/insuranceAdminService';
import type { ConsentAuditEntry } from '@/types/insuranceAdmin';
import { PageHeader, InsuranceTabs, Card, Badge, btn, th, td, label, select, StateBlock, DisclosureNote, fmtDate } from '../_ui';

const codeStyle: React.CSSProperties = { fontSize: '0.78rem', background: '#f3f4f6', padding: '0.1rem 0.35rem', borderRadius: '0.25rem' };

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export default function ConsentAuditPage() {
  const [data, setData] = useState<ConsentAuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [action, setAction] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try {
      setData(await getConsentAudit({ provider: provider || undefined, action: action || undefined }));
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider, action]);

  function exportCsv() {
    if (!data || data.length === 0) return;
    const headers = ['id', 'user_masked', 'policy_id', 'consent_version', 'scope', 'provider', 'action', 'actor', 'created_at'];
    const lines = [headers.join(',')];
    for (const r of data) {
      lines.push([
        r.id, r.user_masked, r.policy_id ?? '', r.consent_version, r.scope, r.provider, r.action, r.actor, r.created_at,
      ].map((c) => csvEscape(String(c))).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consent-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Consent & audit export"
        subtitle="Versioned consent records and provider data-share events per policyholder."
        action={<button onClick={exportCsv} disabled={!data || data.length === 0} style={{ ...btn(), opacity: !data || data.length === 0 ? 0.6 : 1 }}>Export CSV</button>}
      />
      <InsuranceTabs active="ops" />

      <DisclosureNote>NDPA 2023 — versioned consent is captured before every provider data-share. PII is never logged; only masked identifiers appear here.</DisclosureNote>

      <Card title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
          <div>
            <label style={label()}>Provider</label>
            <select style={select()} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All providers</option>
              <option value="mycover">MyCover.ai</option>
              <option value="octamile">Octamile</option>
            </select>
          </div>
          <div>
            <label style={label()}>Action</label>
            <select style={select()} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              <option value="granted">Granted</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="data_shared">Data shared</option>
              <option value="erasure_requested">Erasure requested</option>
            </select>
          </div>
        </div>
      </Card>

      <Card>
        <StateBlock loading={loading} error={error} empty={!data || data.length === 0} emptyText="No consent/audit records found.">
          {data && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th()}>ID</th>
                    <th style={th()}>User</th>
                    <th style={th()}>Policy</th>
                    <th style={th()}>Consent version</th>
                    <th style={th()}>Scope</th>
                    <th style={th()}>Provider</th>
                    <th style={th()}>Action</th>
                    <th style={th()}>Actor</th>
                    <th style={th()}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr key={c.id}>
                      <td style={td()}><code style={codeStyle}>{c.id}</code></td>
                      <td style={td()}>{c.user_masked}</td>
                      <td style={td()}>
                        {c.policy_id
                          ? <Link href={`/admin/insurance/policies/${c.policy_id}`} style={{ color: '#340075', fontWeight: 600, textDecoration: 'none' }}>{c.policy_id}</Link>
                          : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                      <td style={td()}>{c.consent_version}</td>
                      <td style={td()}>{c.scope}</td>
                      <td style={td()}><Badge status={c.provider} /></td>
                      <td style={td()}><Badge status={c.action === 'granted' ? 'active' : c.action === 'withdrawn' || c.action === 'erasure_requested' ? 'failed' : 'binding'} label={c.action.replace(/_/g, ' ')} /></td>
                      <td style={td()}>{c.actor}</td>
                      <td style={td()}>{fmtDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </StateBlock>
      </Card>
    </div>
  );
}
