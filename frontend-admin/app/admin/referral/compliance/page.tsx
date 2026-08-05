'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getCompliancePolicy, listAmlAlerts, formatNaira } from '@/services/referralAdminOpsService';
import type { CompliancePolicy, AmlAlert } from '@/types/referralAdminOps';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const links = [
  { href: '/admin/referral/compliance/disclosures', label: 'Disclosures & T&Cs' },
  { href: '/admin/referral/compliance/consent', label: 'Consent & data' },
];

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const past = diff >= 0;
  const h = Math.floor(Math.abs(diff) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const d = Math.floor(h / 24);
  return past ? `${d}d ago` : `in ${d}d`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'resolved', 'eligible', 'paid'].includes(s)) return colors.success;
  if (['closed', 'ended', 'draft'].includes(s)) return colors.secondary;
  if (['rejected', 'clawed_back', 'critical'].includes(s)) return colors.danger;
  if (['open', 'pending', 'high'].includes(s)) return colors.warning;
  if (['normal'].includes(s)) return colors.info;
  if (s === 'low') return colors.muted;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: accent ?? colors.text }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{sub}</div> : null}
    </Card>
  );
}

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
    <Page>
      <PageHeader
        title="Compliance — Pyramid-line & tier-cap policy"
        subtitle="Configure tier limits, activity-based rules and jurisdiction toggles (A-CMPL-01). AML monitoring of reward-linked transactions (A-CMPL-03)."
        actions={<Button variant="outline" sm onClick={load}>Refresh</Button>}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {links.map((l) => <Link key={l.href} href={l.href} className="vx-btn vx-btn--outline vx-btn--sm" style={{ textDecoration: 'none' }}>{l.label}</Link>)}
      </div>

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : !policy ? null : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px,1fr))', gap: 12, marginBottom: 20 }}>
            <Kpi label="Jurisdiction" value={policy.jurisdiction} />
            <Kpi label="Pyramid-line enforced" value={policy.pyramid_line_enforced ? 'Yes' : 'No'} accent={policy.pyramid_line_enforced ? colors.success : colors.danger} sub="No earnings on recruitment alone" />
            <Kpi label="Activity-based only" value={policy.activity_based_only ? 'Yes' : 'No'} accent={policy.activity_based_only ? colors.success : colors.danger} />
            <Kpi label="Max downline depth" value={String(policy.max_downline_depth)} />
          </div>

          <Card title="Tier caps" style={{ marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Tier</th><th style={thCell}>Monthly cap</th><th style={thCell}>Override %</th></tr></thead>
                <tbody>
                  {policy.tier_caps.map((t) => (
                    <tr key={t.tier}><td style={tdCell}>{t.tier}</td><td style={tdCell}>{formatNaira(t.monthly_cap_kobo)}</td><td style={tdCell}>{t.override_pct}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Jurisdiction toggles" style={{ marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Region</th><th style={thCell}>Program</th><th style={thCell}>Note</th></tr></thead>
                <tbody>
                  {policy.jurisdiction_toggles.map((j) => (
                    <tr key={j.region}>
                      <td style={tdCell}>{j.region}</td>
                      <td style={tdCell}><StatusBadge status={j.program_enabled ? 'active' : 'closed'} label={j.program_enabled ? 'enabled' : 'disabled'} /></td>
                      <td style={tdCell}>{j.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="AML monitoring (A-CMPL-03)">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <select value={amlStatus} onChange={(e) => setAmlStatus(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="cleared">Cleared</option>
                <option value="reported">Reported</option>
              </select>
            </div>
            {!aml || aml.length === 0 ? <p style={{ color: colors.muted }}>No AML alerts.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={thCell}>Subject</th><th style={thCell}>Pattern</th><th style={thCell}>Amount</th>
                    <th style={thCell}>Severity</th><th style={thCell}>Status</th><th style={thCell}>When</th>
                  </tr></thead>
                  <tbody>
                    {aml.map((a) => (
                      <tr key={a.id}>
                        <td style={tdCell}><Link href={`/admin/referral/users/${a.subject_id}`} style={{ color: colors.primary }}>{a.subject_id}</Link></td>
                        <td style={tdCell}>{a.pattern}</td>
                        <td style={tdCell}>{formatNaira(a.amount_kobo)}</td>
                        <td style={tdCell}><StatusBadge status={a.severity} /></td>
                        <td style={tdCell}><StatusBadge status={a.status === 'cleared' ? 'resolved' : a.status === 'reported' ? 'high' : 'open'} label={a.status} /></td>
                        <td style={tdCell}>{timeAgo(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
