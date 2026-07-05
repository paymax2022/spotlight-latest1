'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getCompliancePolicy, listAmlAlerts, formatNaira } from '@/services/referralAdminOpsService';
import type { CompliancePolicy, AmlAlert } from '@/types/referralAdminOps';
import { PageHeader, Card, Kpi, Badge, btn, th, td, timeAgo, StateBlock } from '../_ui';

const links = [
  { href: '/admin/referral/compliance/disclosures', label: 'Disclosures & T&Cs' },
  { href: '/admin/referral/compliance/consent', label: 'Consent & data' },
];

export default function CompliancePolicyPage() {
  const [policy, setPolicy] = useState<CompliancePolicy | null>(null);
  const [aml, setAml] = useState<AmlAlert[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amlStatus, setAmlStatus] = useState('all');

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, a] = await Promise.all([getCompliancePolicy(), listAmlAlerts(amlStatus)]);
      setPolicy(p); setAml(a);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [amlStatus]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Compliance — Pyramid-line & tier-cap policy"
        subtitle="Configure tier limits, activity-based rules and jurisdiction toggles (A-CMPL-01). AML monitoring of reward-linked transactions (A-CMPL-03)."
        action={<button onClick={load} style={btn()}>Refresh</button>}
      />
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {links.map((l) => <Link key={l.href} href={l.href} style={{ ...btn(), textDecoration: 'none', color: '#374151' }}>{l.label}</Link>)}
      </div>

      <StateBlock loading={loading} error={error} empty={!policy}>
        {policy && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <Kpi label="Jurisdiction" value={policy.jurisdiction} />
              <Kpi label="Pyramid-line enforced" value={policy.pyramid_line_enforced ? 'Yes' : 'No'} accent={policy.pyramid_line_enforced ? '#15803d' : '#b91c1c'} sub="No earnings on recruitment alone" />
              <Kpi label="Activity-based only" value={policy.activity_based_only ? 'Yes' : 'No'} accent={policy.activity_based_only ? '#15803d' : '#b91c1c'} />
              <Kpi label="Max downline depth" value={String(policy.max_downline_depth)} />
            </div>

            <Card title="Tier caps">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Tier</th><th style={th()}>Monthly cap</th><th style={th()}>Override %</th></tr></thead>
                <tbody>
                  {policy.tier_caps.map((t) => (
                    <tr key={t.tier}><td style={td()}>{t.tier}</td><td style={td()}>{formatNaira(t.monthly_cap_kobo)}</td><td style={td()}>{t.override_pct}%</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Jurisdiction toggles">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Region</th><th style={th()}>Program</th><th style={th()}>Note</th></tr></thead>
                <tbody>
                  {policy.jurisdiction_toggles.map((j) => (
                    <tr key={j.region}>
                      <td style={td()}>{j.region}</td>
                      <td style={td()}><Badge status={j.program_enabled ? 'active' : 'closed'} label={j.program_enabled ? 'enabled' : 'disabled'} /></td>
                      <td style={td()}>{j.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="AML monitoring (A-CMPL-03)" right={
              <select value={amlStatus} onChange={(e) => setAmlStatus(e.target.value)} style={{ ...btn(), cursor: 'pointer' }}>
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="cleared">Cleared</option>
                <option value="reported">Reported</option>
              </select>
            }>
              {!aml || aml.length === 0 ? <p style={{ color: '#6b7280' }}>No AML alerts.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th()}>Subject</th><th style={th()}>Pattern</th><th style={th()}>Amount</th>
                    <th style={th()}>Severity</th><th style={th()}>Status</th><th style={th()}>When</th>
                  </tr></thead>
                  <tbody>
                    {aml.map((a) => (
                      <tr key={a.id}>
                        <td style={td()}><Link href={`/admin/referral/users/${a.subject_id}`} style={{ color: '#340075' }}>{a.subject_id}</Link></td>
                        <td style={td()}>{a.pattern}</td>
                        <td style={td()}>{formatNaira(a.amount_kobo)}</td>
                        <td style={td()}><Badge status={a.severity} /></td>
                        <td style={td()}><Badge status={a.status === 'cleared' ? 'resolved' : a.status === 'reported' ? 'high' : 'open'} label={a.status} /></td>
                        <td style={td()}>{timeAgo(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
