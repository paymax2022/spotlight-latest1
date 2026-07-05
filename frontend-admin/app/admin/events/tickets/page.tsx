'use client';

import { useEffect, useState } from 'react';
import { listTickets, formatNaira } from '@/services/eventsAdminService';
import type { TicketTier } from '@/types/eventsAdmin';
import { PageHeader, EventsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, btn, th, td, input, label, select, pct } from '../_ui';

export default function TicketsPage() {
  const [rows, setRows] = useState<TicketTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listTickets({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Ticket inventory" subtitle="Tiers, inventory, holds and promo codes across all events. Tier config is versioned (PRD §1)." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <EventsTabs active="tickets" />
      <DisclosureNote>Inventory is authoritative — sold + held must never exceed quantity. Promo codes are versioned config; max-redemption caps are enforced server-side. Prices shown ₦ (stored as kobo).</DisclosureNote>

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Tier, event or ticket id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="on_sale">On sale</option>
            <option value="sold_out">Sold out</option>
            <option value="paused">Paused</option>
            <option value="scheduled">Scheduled</option>
            <option value="ended">Ended</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No ticket tiers match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Tier</th><th style={th()}>Event</th><th style={th()}>Price</th><th style={th()}>Sold / Qty</th>
              <th style={th()}>Held</th><th style={th()}>Fill</th><th style={th()}>Status</th><th style={th()}>Config v</th><th style={th()}>Promo codes</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}>{r.name}<div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}>{r.event_title}</td>
                  <td style={td()}>{formatNaira(r.price_kobo)}</td>
                  <td style={td()}>{r.sold.toLocaleString('en-NG')} / {r.quantity.toLocaleString('en-NG')}</td>
                  <td style={td()}>{r.held.toLocaleString('en-NG')}</td>
                  <td style={td()}>{pct(r.quantity ? r.sold / r.quantity : 0)}</td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>v{r.config_version}</td>
                  <td style={td()}>
                    {r.promo_codes.length === 0 ? <span style={{ color: '#9ca3af' }}>—</span> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {r.promo_codes.map((p) => (
                          <span key={p.code} style={{ fontSize: '0.78rem' }}>
                            <code>{p.code}</code> · {pct(p.discount_pct)} · {p.redeemed.toLocaleString('en-NG')}/{p.max_redemptions.toLocaleString('en-NG')} {' '}
                            <Badge status={p.active ? 'active' : 'disabled'} label={p.active ? 'active' : 'off'} />
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </div>
  );
}
