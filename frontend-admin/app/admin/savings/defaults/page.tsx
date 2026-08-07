'use client';

import { useEffect, useState } from 'react';
import { listDefaults, handleDefault, formatNaira } from '@/services/savingsAdminService';
import type { DefaultRecord, DefaultAction } from '@/types/savingsAdmin';
import { SavingsTabs, DisclosureNote, StateBlock, FilterBar, AuditNote, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const SUCCESS_STATUSES = new Set(['active', 'open', 'matured', 'completed', 'settled', 'reconciled', 'resolved', 'paid', 'healthy', 'approved', 'on_track', 'recovered', 'cleared', 'balanced', 'verified', 'contribution']);
const DANGER_STATUSES = new Set(['rejected', 'failed', 'defaulted', 'blocked', 'high', 'critical', 'breached', 'suspended', 'impersonation', 'abuse']);
const WARNING_STATUSES = new Set(['pending', 'forming', 'scheduled', 'queued', 'flagged', 'degraded', 'at_risk', 'locked', 'grace', 'review', 'under_review', 'late', 'medium', 'debit', 'hold']);
const INFO_STATUSES = new Set(['investigating', 'processing', 'collecting', 'flex', 'normal', 'invited', 'payment', 'split', 'payout']);
const PRIMARY_STATUSES = new Set(['refunded', 'reversed', 'reversal', 'make_good', 'pool', 'request']);

function badgeColor(status: string): string {
  const s = status.toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return colors.success;
  if (DANGER_STATUSES.has(s)) return colors.danger;
  if (WARNING_STATUSES.has(s)) return colors.warning;
  if (INFO_STATUSES.has(s)) return colors.info;
  if (PRIMARY_STATUSES.has(s)) return colors.primary;
  return colors.secondary;
}

function badgeText(status: string, label?: string): string {
  const t = (label ?? status.replace(/_/g, ' ')).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function DefaultsPage() {
  const [rows, setRows] = useState<DefaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listDefaults({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function onAction(d: DefaultRecord, action: DefaultAction) {
    const note = window.prompt(`Apply "${action}" to default ${d.id} (${d.member_masked} in ${d.circle_name})? This is audited. Optional note:`) ?? undefined;
    if (note === undefined && action === 'remove') return;
    setBusy(d.id); setMsg(null);
    try {
      const res = await handleDefault(d.id, action, note);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Default queue" subtitle="Missed-contribution defaults across all Ajo circles, with policy-driven, audited handling." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <SavingsTabs active="defaults" />
      <DisclosureNote>NL-7 — Paymax never advances credit to cover a default; resolution is per the circle&apos;s configured policy (grace, make-good, or member removal). Every action posts an immutable audit event (NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label>Search</label>
          <Input placeholder="Circle, member or default id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="grace">Grace</option><option value="make_good">Make-good</option><option value="defaulted">Defaulted</option><option value="recovered">Recovered</option><option value="dismissed">Dismissed</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ overflowX: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No defaults match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Default</th><th style={thCell}>Circle</th><th style={thCell}>Member</th><th style={thCell}>Cycle</th>
              <th style={thCell}>Amount due</th><th style={thCell}>Overdue</th><th style={thCell}>Policy</th><th style={thCell}>Status</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td style={tdCell}>{d.id}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{timeAgo(d.created_at)}</div></td>
                  <td style={tdCell}>{d.circle_name}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{d.circle_id}</div></td>
                  <td style={tdCell}>{d.member_masked}</td>
                  <td style={tdCell}>{d.cycle_index}</td>
                  <td style={tdCell}>{formatNaira(d.amount_due_kobo)}</td>
                  <td style={tdCell}>{d.days_overdue}d</td>
                  <td style={tdCell}><Badge text={badgeText(d.policy)} color={badgeColor(d.policy)} /></td>
                  <td style={tdCell}><Badge text={badgeText(d.status)} color={badgeColor(d.status)} /></td>
                  <td style={tdCell}>
                    {(d.status === 'open' || d.status === 'grace' || d.status === 'defaulted' || d.status === 'make_good') ? (
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <Button variant="outline" sm disabled={busy === d.id} onClick={() => onAction(d, 'grace')}>Grace</Button>
                        <Button variant="outline" sm disabled={busy === d.id} onClick={() => onAction(d, 'make_good')}>Make-good</Button>
                        <Button variant="outline" sm disabled={busy === d.id} onClick={() => onAction(d, 'recover')}>Recover</Button>
                        <Button variant="danger" sm disabled={busy === d.id} onClick={() => onAction(d, 'remove')}>Remove</Button>
                      </div>
                    ) : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
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
