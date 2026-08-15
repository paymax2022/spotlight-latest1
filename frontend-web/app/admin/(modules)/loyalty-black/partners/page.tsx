'use client';

import { useEffect, useState } from 'react';
import { listPartners, formatNaira } from '@/services/blackAdminService';
import type { BlackPartner } from '@/types/blackAdmin';
import { BlackTabs, DisclosureNote, StateBlock, FilterBar, bps, fmtDate } from '../../creators/_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  switch (status) {
    case 'active':
      return colors.success;
    case 'pending':
      return colors.warning;
    case 'suspended':
      return colors.danger;
    default:
      return colors.secondary;
  }
}

export default function BlackPartnersPage() {
  const [rows, setRows] = useState<BlackPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPartners({ status: status || undefined, category: category || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, category]);

  return (
    <Page>
      <PageHeader title="Partner-offer management" subtitle="Partners supplying Black perks (dining, retail, travel, events). Track offer count, redemptions, settlement model and outstanding amounts owed." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <BlackTabs active="partners" />
      <DisclosureNote>Settlement model determines who funds a redeemed perk: platform-funded (Paymax cost), partner-funded (recovered from partner) or shared. Outstanding amounts roll into the partner settlement run. Partner changes are audited (NL-12).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search</label>
          <Input placeholder="Partner name or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            <option value="dining">Dining</option>
            <option value="retail">Retail</option>
            <option value="travel">Travel</option>
            <option value="events">Events</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No partners found.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Partner</th><th style={thCell}>Category</th><th style={thCell}>Contact</th><th style={thCell}>Offers</th>
              <th style={thCell}>Redemptions (30d)</th><th style={thCell}>Settlement model</th><th style={thCell}>Partner share</th><th style={thCell}>Outstanding</th><th style={thCell}>Onboarded</th><th style={thCell}>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><strong>{r.name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                  <td style={tdCell}>{r.category}</td>
                  <td style={tdCell}><code style={{ fontSize: '0.76rem' }}>{r.contact_masked}</code></td>
                  <td style={tdCell}>{r.offers_count}</td>
                  <td style={tdCell}>{r.redemptions_30d.toLocaleString('en-NG')}</td>
                  <td style={tdCell}><Badge text={r.settlement_model.replace(/_/g, ' ')} color={colors.info} /></td>
                  <td style={tdCell}>{r.partner_share_bps > 0 ? bps(r.partner_share_bps) : <span style={{ color: colors.muted }}>—</span>}</td>
                  <td style={tdCell}><span style={{ color: r.outstanding_settlement_kobo > 0 ? colors.warning : colors.muted, fontWeight: r.outstanding_settlement_kobo > 0 ? 700 : 400 }}>{formatNaira(r.outstanding_settlement_kobo)}</span></td>
                  <td style={tdCell}>{fmtDate(r.onboarded_at)}</td>
                  <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
