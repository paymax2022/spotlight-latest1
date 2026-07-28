'use client';

import { useEffect, useState } from 'react';
import { listSponsors, listSponsorCampaigns } from '@/services/academyAdminService';
import type { Sponsor, SponsorCampaign } from '@/types/academyAdmin';
import { PageHeader, AcademyTabs, Card, Badge, Kpi, StateBlock, DisclosureNote, btn, th, td, formatNaira, pct } from '../_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Sponsors & campaigns" subtitle="Sponsors, CSR campaigns, branded challenges, funded-pool reporting, and TV-funnel attribution codes for the schools quiz show." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <AcademyTabs active="sponsors" />
      <DisclosureNote>Requires <code>academy.sponsor</code>. Sponsor funds flow into reward pools (Rewards module); a campaign with no funded pool cannot disburse. TV-funnel attribution codes credit sign-ups back to the campaign.</DisclosureNote>

      <StateBlock loading={loading} error={error} empty={sponsors.length === 0}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <Kpi label="Sponsors" value={String(sponsors.length)} sub={`${sponsors.filter((s) => s.status === 'active').length} active`} accent="#340075" />
          <Kpi label="Total funded" value={formatNaira(totalFunded)} accent="#15803d" />
          <Kpi label="Live campaigns" value={String(liveCampaigns)} />
          <Kpi label="Signups attributed" value={totalSignups.toLocaleString('en-NG')} sub="TV-funnel" />
        </div>

        <Card title="Sponsors">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Sponsor</th><th style={th()}>Status</th><th style={th()}>Funded pools</th><th style={th()}>Total funded</th></tr></thead>
            <tbody>
              {sponsors.map((s) => (
                <tr key={s.id}><td style={td()}>{s.name}</td><td style={td()}><Badge status={s.status} /></td><td style={td()}>{s.funded_pools}</td><td style={td()}>{formatNaira(s.total_funded_kobo)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Campaigns & funded-pool reporting">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Campaign</th><th style={th()}>Sponsor</th><th style={th()}>Status</th><th style={th()}>Pool</th><th style={th()}>Funded</th><th style={th()}>Spent</th><th style={th()}>Utilisation</th><th style={th()}>Attribution code</th><th style={th()}>Signups</th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td style={td()}>{c.name}</td>
                  <td style={td()}>{sponsorName(c.sponsor_id)}</td>
                  <td style={td()}><Badge status={c.status} /></td>
                  <td style={td()}>{c.pool_id ? <code style={{ fontSize: '0.78rem' }}>{c.pool_id}</code> : <Badge status="unfunded" label="no pool" />}</td>
                  <td style={td()}>{formatNaira(c.funded_kobo)}</td>
                  <td style={td()}>{formatNaira(c.spent_kobo)}</td>
                  <td style={td()}>{c.funded_kobo > 0 ? pct(c.spent_kobo / c.funded_kobo) : '—'}</td>
                  <td style={td()}><code style={{ fontSize: '0.78rem' }}>{c.attribution_code}</code></td>
                  <td style={td()}>{c.signups_attributed.toLocaleString('en-NG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </StateBlock>
    </div>
  );
}
