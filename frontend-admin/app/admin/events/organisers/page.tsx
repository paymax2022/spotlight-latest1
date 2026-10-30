'use client';

import { useEffect, useState } from 'react';
import { listOrganisers, getOrganiser, sanctionOrganiser, USE_MOCK, USE_MOCK_ENV } from '@/services/eventsGovernanceAdminService';
import type { OrganiserSanction } from '@/types/eventsGovernanceAdmin';
import { PageHeader, EventsTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, btnDanger, th, td, input, label, fmtDate } from '../_ui';
import { FixtureBanner } from '../../_shared/ui';
import { colors } from '@/components/ui/vuexy';

export default function OrganisersPage() {
  const [rows, setRows] = useState<OrganiserSanction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listOrganisers(q || undefined)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Re-read one organiser's standing from GET /organisers/:id before deciding,
  // so the prompt quotes current numbers rather than a stale list row.
  async function sanction(o: OrganiserSanction, suspend: boolean) {
    setBusy(o.organiser_id); setMsg(null);
    try {
      const cur = await getOrganiser(o.organiser_id);
      if (cur.suspended === suspend) { setMsg(`${cur.name ?? cur.organiser_id} is already ${suspend ? 'suspended' : 'in good standing'}.`); await load(); return; }
      const reason = window.prompt(`${suspend ? 'Suspend' : 'Reinstate'} organiser ${cur.name ?? cur.organiser_id}? (${cur.event_live} live, ${cur.event_under_review} under review). ${suspend ? 'They will be unable to create, submit or publish events; live events stay on sale.' : ''} Reason (required, audited):`);
      if (reason === null) return;
      if (!reason.trim()) { setMsg('A reason is required.'); return; }
      const out = await sanctionOrganiser(o.organiser_id, suspend, reason.trim());
      setMsg(`${out.name ?? out.organiser_id} is now ${out.suspended ? 'suspended' : 'in good standing'}.`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Organisers & sanctions" subtitle="Organiser standing across the platform. A suspension blocks new events; it does not pull live events off sale — suspend those individually in Moderation." action={<button onClick={load} style={btn()} disabled={loading}>Refresh</button>} />
      <EventsTabs active="organisers" />
      <FixtureBanner active={USE_MOCK} envVar={USE_MOCK_ENV} />
      <DisclosureNote>Buyers already hold tickets for live events, so sanctioning an organiser is deliberately separate from suspending their events. Every sanction is recorded to the audit log with its reason.</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 240 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Organiser name…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <button style={btn()} onClick={load} disabled={loading}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No organisers match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Organiser</th><th style={th()}>Events</th><th style={th()}>Live</th><th style={th()}>Under review</th>
              <th style={th()}>Tickets sold</th><th style={th()}>Standing</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.organiser_id}>
                  <td style={td()}>{o.name || '—'}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{o.organiser_id}</div></td>
                  <td style={td()}>{o.event_total}</td>
                  <td style={td()}>{o.event_live}</td>
                  <td style={td()}>{o.event_under_review}</td>
                  <td style={td()}>{o.tickets_sold.toLocaleString()}</td>
                  <td style={td()}>
                    <Badge status={o.suspended ? 'suspended' : 'active'} label={o.suspended ? 'suspended' : 'good standing'} />
                    {o.suspended && <div style={{ fontSize: '0.72rem', color: colors.muted }}>{o.reason}{o.decided_at ? ` · ${fmtDate(o.decided_at)}` : ''}</div>}
                  </td>
                  <td style={td()}>
                    {o.suspended
                      ? <button style={btnPrimary()} disabled={busy !== null} onClick={() => sanction(o, false)}>{busy === o.organiser_id ? '…' : 'Reinstate'}</button>
                      : <button style={btnDanger()} disabled={busy !== null} onClick={() => sanction(o, true)}>{busy === o.organiser_id ? '…' : 'Suspend'}</button>}
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
