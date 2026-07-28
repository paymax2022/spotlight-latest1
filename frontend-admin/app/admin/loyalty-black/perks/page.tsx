'use client';

import { useEffect, useState } from 'react';
import { listPerks, upsertPerk, formatNaira } from '@/services/blackAdminService';
import type { BlackPerk, PerkStatus } from '@/types/blackAdmin';
import { PageHeader, BlackTabs, Card, Badge, DisclosureNote, StateBlock, FilterBar, AuditNote, btn, btnPrimary, th, td, input, label, select, fmtDate } from '../../creators/_ui';

export default function BlackPerksPage() {
  const [rows, setRows] = useState<BlackPerk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listPerks({ status: status || undefined, kind: kind || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, kind]);

  async function setPerkStatus(perk: BlackPerk, next: PerkStatus) {
    const note = window.prompt(`Set perk "${perk.name}" to ${next}? This is an audited config change (NL-12). Enter a note:`);
    if (note === null) return;
    setBusy(perk.id); setMsg(null);
    try {
      const res = await upsertPerk({ id: perk.id, status: next }, note || undefined);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Black perk configuration" subtitle="Perk catalogue for Paymax Black — early tickets, lounge access, discounts and partner offers. Each perk is redeemed via single-use credential with a per-member monthly cap." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <BlackTabs active="perks" />
      <DisclosureNote>Perks redeem closed-loop via single-use credential (NL-3) and are <strong>never cash</strong> (NL-4). The monthly cap enforces single-use entitlement per cycle. Pausing/activating a perk writes an immutable audit entry (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={label()}>Search</label>
          <input style={input()} placeholder="Perk name, partner or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={label()}>Status</label>
          <select style={select()} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="draft">Draft</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <div>
          <label style={label()}>Kind</label>
          <select style={select()} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="early_ticket">Early ticket</option>
            <option value="lounge_access">Lounge access</option>
            <option value="discount">Discount</option>
            <option value="partner_offer">Partner offer</option>
            <option value="free_delivery">Free delivery</option>
            <option value="priority_support">Priority support</option>
          </select>
        </div>
        <button style={btn()} onClick={load}>Apply</button>
      </FilterBar>

      <Card>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No perks configured.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Perk</th><th style={th()}>Kind</th><th style={th()}>Partner</th><th style={th()}>Value</th>
              <th style={th()}>Monthly cap</th><th style={th()}>Redeemed (30d)</th><th style={th()}>Cost (30d)</th><th style={th()}>Window</th><th style={th()}>Status</th><th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td()}><strong>{r.name}</strong><div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{r.id}</div></td>
                  <td style={td()}><Badge status={r.kind} /></td>
                  <td style={td()}>{r.partner_name ?? <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}>{r.value_kobo > 0 ? formatNaira(r.value_kobo) : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={td()}>{r.monthly_cap_per_member}/mo</td>
                  <td style={td()}>{r.total_redeemed_30d.toLocaleString('en-NG')}</td>
                  <td style={td()}>{formatNaira(r.cost_30d_kobo)}</td>
                  <td style={td()}><span style={{ fontSize: '0.78rem' }}>{fmtDate(r.starts_at)} → {fmtDate(r.ends_at)}</span></td>
                  <td style={td()}><Badge status={r.status} /></td>
                  <td style={td()}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {r.status !== 'active' ? (
                        <button style={btnPrimary()} disabled={busy === r.id} onClick={() => setPerkStatus(r, 'active')}>{busy === r.id ? '…' : 'Activate'}</button>
                      ) : (
                        <button style={btn()} disabled={busy === r.id} onClick={() => setPerkStatus(r, 'paused')}>Pause</button>
                      )}
                    </div>
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
