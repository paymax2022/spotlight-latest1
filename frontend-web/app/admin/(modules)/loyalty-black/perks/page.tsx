'use client';

import { useEffect, useState } from 'react';
import { listPerks, upsertPerk, formatNaira } from '@/services/blackAdminService';
import type { BlackPerk, PerkStatus } from '@/types/blackAdmin';
import { BlackTabs, DisclosureNote, StateBlock, FilterBar, AuditNote, fmtDate } from '../../creators/_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

function statusColor(status: string): string {
  switch (status) {
    case 'active':
      return colors.success;
    case 'paused':
      return colors.warning;
    case 'draft':
      return colors.secondary;
    case 'expired':
      return colors.danger;
    default:
      return colors.secondary;
  }
}

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
    <Page>
      <PageHeader title="Black perk configuration" subtitle="Perk catalogue for Paymax Black — early tickets, lounge access, discounts and partner offers. Each perk is redeemed via single-use credential with a per-member monthly cap." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <BlackTabs active="perks" />
      <DisclosureNote>Perks redeem closed-loop via single-use credential (NL-3) and are <strong>never cash</strong> (NL-4). The monthly cap enforces single-use entitlement per cycle. Pausing/activating a perk writes an immutable audit entry (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 220 }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Search</label>
          <Input placeholder="Perk name, partner or id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="draft">Draft</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: colors.text, marginBottom: '0.25rem' }}>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            <option value="early_ticket">Early ticket</option>
            <option value="lounge_access">Lounge access</option>
            <option value="discount">Discount</option>
            <option value="partner_offer">Partner offer</option>
            <option value="free_delivery">Free delivery</option>
            <option value="priority_support">Priority support</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ padding: 0, overflow: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No perks configured.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Perk</th><th style={thCell}>Kind</th><th style={thCell}>Partner</th><th style={thCell}>Value</th>
              <th style={thCell}>Monthly cap</th><th style={thCell}>Redeemed (30d)</th><th style={thCell}>Cost (30d)</th><th style={thCell}>Window</th><th style={thCell}>Status</th><th style={thCell}>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdCell}><strong>{r.name}</strong><div style={{ fontSize: '0.72rem', color: colors.muted }}>{r.id}</div></td>
                  <td style={tdCell}><Badge text={r.kind.replace(/_/g, ' ')} color={colors.info} /></td>
                  <td style={tdCell}>{r.partner_name ?? <span style={{ color: colors.muted }}>—</span>}</td>
                  <td style={tdCell}>{r.value_kobo > 0 ? formatNaira(r.value_kobo) : <span style={{ color: colors.muted }}>—</span>}</td>
                  <td style={tdCell}>{r.monthly_cap_per_member}/mo</td>
                  <td style={tdCell}>{r.total_redeemed_30d.toLocaleString('en-NG')}</td>
                  <td style={tdCell}>{formatNaira(r.cost_30d_kobo)}</td>
                  <td style={tdCell}><span style={{ fontSize: '0.78rem' }}>{fmtDate(r.starts_at)} → {fmtDate(r.ends_at)}</span></td>
                  <td style={tdCell}><Badge text={r.status} color={statusColor(r.status)} /></td>
                  <td style={tdCell}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {r.status !== 'active' ? (
                        <Button sm variant="primary" disabled={busy === r.id} onClick={() => setPerkStatus(r, 'active')}>{busy === r.id ? '…' : 'Activate'}</Button>
                      ) : (
                        <Button sm variant="outline" disabled={busy === r.id} onClick={() => setPerkStatus(r, 'paused')}>Pause</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StateBlock>
      </Card>
    </Page>
  );
}
