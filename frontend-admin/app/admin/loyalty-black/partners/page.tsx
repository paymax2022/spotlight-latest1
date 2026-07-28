'use client';

import { useEffect, useState } from 'react';
import { listPartners, formatNaira } from '@/services/blackAdminService';
import type { BlackPartner } from '@/types/blackAdmin';
import { PageHeader, BlackTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, bps, fmtDate } from '../../creators/_ui';

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
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Partner-offer management" subtitle="Partners supplying Black perks (dining, retail, travel, events). Track offer count, redemptions, settlement model and outstanding amounts owed." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <BlackTabs active="partners" />
      <DisclosureNote>Settlement model determines who funds a redeemed perk: platform-funded (Paymax cost), partner-funded (recovered from partner) or shared. Outstanding amounts roll into the partner settlement run. Partner changes are audited (NL-12).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Partner name or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div>
          <label style={label()}>Category</label>
          <select style={select()} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            <option value="dining">Dining</option>
            <option value="retail">Retail</option>
            <option value="travel">Travel</option>
            <option value="events">Events</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No partners found.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Partner</th><th style={th()}>Category</th><th style={th()}>Contact</th><th style={th()}>Offers</th>
              <th style={th()}>Redemptions (30d)</th><th style={th()}>Settlement model</th><th style={th()}>Partner share</th><th style={th()}>Outstanding</th><th style={th()}>Onboarded</th><th style={th()}>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.name}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}>{r.category}</td>
                  <td style={td()}><code style={{ fontSize: '0.76rem' }}>{r.contact_masked}</code></td>
                  <td style={td()}>{r.offers_count}</td>
                  <td style={td()}>{r.redemptions_30d.toLocaleString('en-NG')}</td>
                  <td style={td()}><Badge status={r.settlement_model} /></td>
                  <td style={td()}>{r.partner_share_bps > 0 ? bps(r.partner_share_bps) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}><span style={{ color: r.outstanding_settlement_kobo > 0 ? '#9a3412' : '#9ca3af', fontWeight: r.outstanding_settlement_kobo > 0 ? 700 : 400 }}>{formatNaira(r.outstanding_settlement_kobo)}</span></td>
                  <td style={td()}>{fmtDate(r.onboarded_at)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
