'use client';

import { useEffect, useState } from 'react';
import { listSponsors, listSponsorCampaigns } from '@/services/academyAdminService';
import type { Sponsor, SponsorCampaign } from '@/types/academyAdmin';
import { AcademyTabs, Kpi, StateBlock, DisclosureNote, formatNaira, pct } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (['active', 'approved', 'published', 'funded', 'paid', 'completed', 'allocated', 'live', 'reconciled', 'disbursed', 'collected', 'released', 'core', 'issued', 'routed', 'ready', 'eligible', 'actioned', 'verified', 'resolved', 'plan_published', 'badge_earned', 'pool_funded', 'item_approved'].includes(s)) return colors.success;
  if (['pending', 'in_review', 'under_review', 'needs_info', 'scheduled', 'low_balance', 'review', 'in_translation', 'funding', 'fee_due', 'onboarding', 'frequent', 'packaged', 'matured', 'paused', 'processing', 'triaged', 'investigating', 'hide', 'warn', 'high', 'medium'].includes(s)) return colors.warning;
  if (['draft', 'authoring', 'open', 'upcoming', 'generated', 'partial', 'submitted', 'trial', 'requested', 'applied', 'cards_generated', 'exam_opened', 'campaign_launched'].includes(s)) return colors.info;
  if (['rejected', 'failed', 'suspended', 'blocked', 'unfunded', 'expired', 'duplicate', 'revoked', 'escalated', 'ban', 'critical', 'overdue', 'item_rejected'].includes(s)) return colors.danger;
  if (['refunded', 'reversed', 'redeemed', 'reward_redeemed'].includes(s)) return colors.primary;
  return colors.secondary;
}

function StatusBadge({ status, label: lbl }: { status: string; label?: string }) {
  return <Badge text={lbl ?? status.replace(/_/g, ' ')} color={statusColor(status)} />;
}

export default function SponsorsPage() {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [campaigns, setCampaigns] = useState<SponsorCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, c] = await Promise.all([listSponsors(), listSponsorCampaigns()]);
      setSponsors(s); setCampaigns(c);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const totalFunded = sponsors.reduce((a, s) => a + s.total_funded_kobo, 0);
  const totalSignups = campaigns.reduce((a, c) => a + c.signups_attributed, 0);
  const liveCampaigns = campaigns.filter((c) => c.status === 'live').length;

  function sponsorName(id: string) { return sponsors.find((s) => s.id === id)?.name ?? id; }

  return (
    <Page>
      <PageHeader title="Sponsors & campaigns" subtitle="Sponsors, CSR campaigns, branded challenges, funded-pool reporting, and TV-funnel attribution codes for the schools quiz show." actions={<Button onClick={load} variant="outline" sm>Refresh</Button>} />
      <AcademyTabs active="sponsors" />
      <DisclosureNote>Requires <code>academy.sponsor</code>. Sponsor funds flow into reward pools (Rewards module); a campaign with no funded pool cannot disburse. TV-funnel attribution codes credit sign-ups back to the campaign.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={sponsors.length === 0}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Sponsors" value={String(sponsors.length)} sub={`${sponsors.filter((s) => s.status === 'active').length} active`} accent={colors.primary} />
          <Kpi label="Total funded" value={formatNaira(totalFunded)} accent={colors.success} />
          <Kpi label="Live campaigns" value={String(liveCampaigns)} />
          <Kpi label="Signups attributed" value={totalSignups.toLocaleString('en-NG')} sub="TV-funnel" />
        </div>

        <Card title="Sponsors">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Sponsor</th><th style={thCell}>Status</th><th style={thCell}>Funded pools</th><th style={thCell}>Total funded</th></tr></thead>
            <tbody>
              {sponsors.map((s) => (
                <tr key={s.id}><td style={tdCell}>{s.name}</td><td style={tdCell}><StatusBadge status={s.status} /></td><td style={tdCell}>{s.funded_pools}</td><td style={tdCell}>{formatNaira(s.total_funded_kobo)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Campaigns & funded-pool reporting">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Campaign</th><th style={thCell}>Sponsor</th><th style={thCell}>Status</th><th style={thCell}>Pool</th><th style={thCell}>Funded</th><th style={thCell}>Spent</th><th style={thCell}>Utilisation</th><th style={thCell}>Attribution code</th><th style={thCell}>Signups</th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td style={tdCell}>{c.name}</td>
                  <td style={tdCell}>{sponsorName(c.sponsor_id)}</td>
                  <td style={tdCell}><StatusBadge status={c.status} /></td>
                  <td style={tdCell}>{c.pool_id ? <code style={{ fontSize: '0.78rem' }}>{c.pool_id}</code> : <StatusBadge status="unfunded" label="no pool" />}</td>
                  <td style={tdCell}>{formatNaira(c.funded_kobo)}</td>
                  <td style={tdCell}>{formatNaira(c.spent_kobo)}</td>
                  <td style={tdCell}>{c.funded_kobo > 0 ? pct(c.spent_kobo / c.funded_kobo) : '—'}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.78rem' }}>{c.attribution_code}</code></td>
                  <td style={tdCell}>{c.signups_attributed.toLocaleString('en-NG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </Page>
  );
}
