'use client';

import { useEffect, useState } from 'react';
import { listVaults, forceUnlock, formatNaira } from '@/services/savingsAdminService';
import type { VaultRecord } from '@/types/savingsAdmin';
import { SavingsTabs, DisclosureNote, StateBlock, FilterBar, AuditNote, fmtDate } from '../_ui';
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

export default function VaultsPage() {
  const [rows, setRows] = useState<VaultRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setRows(await listVaults({ status: status || undefined, q: q || undefined })); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function onForceUnlock(v: VaultRecord) {
    const reason = window.prompt(`Force-unlock "${v.name}" (${v.id})? This is an audited override. Enter a reason:`);
    if (!reason) return;
    setBusy(v.id); setMsg(null);
    try {
      const res = await forceUnlock(v.id, reason);
      setMsg(res.message + ` (audit ${res.audit_id})`);
      await load();
    } catch (e) { setMsg(String(e)); }
    finally { setBusy(null); }
  }

  return (
    <Page>
      <PageHeader title="Vault oversight" subtitle="Goal-vault book oversight with audited force-unlock for hardship / dispute cases." actions={<Button variant="outline" onClick={load}>Refresh</Button>} />
      <SavingsTabs active="vaults" />
      <DisclosureNote>NL-2 — vaults accrue <strong>zero yield</strong>; force-unlock returns principal only. Every force-unlock posts a balanced reversing ledger entry and an immutable audit event (NL-8 / NL-12).</DisclosureNote>

      {msg && <AuditNote>{msg}</AuditNote>}

      <FilterBar>
        <div style={{ minWidth: 200 }}>
          <label>Search</label>
          <Input placeholder="Name, owner or vault id…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="locked">Locked</option>
            <option value="flex">Flex</option>
            <option value="matured">Matured</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <Button variant="outline" onClick={load}>Apply</Button>
      </FilterBar>

      <Card style={{ overflowX: 'auto' }}>
        <StateBlock loading={loading} error={error} empty={rows.length === 0} emptyText="No vaults match.">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={thCell}>Vault</th><th style={thCell}>Owner</th><th style={thCell}>Type</th><th style={thCell}>Status</th>
              <th style={thCell}>Balance</th><th style={thCell}>Target</th><th style={thCell}>Yield</th><th style={thCell}>Auto-save</th>
              <th style={thCell}>Locked until</th><th style={thCell}>Action</th>
            </tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td style={tdCell}>{v.name}<div style={{ fontSize: '0.72rem', color: colors.muted }}>{v.id}</div></td>
                  <td style={tdCell}>{v.owner_masked}</td>
                  <td style={tdCell}><Badge text={badgeText(v.lock_type === 'LOCKED' ? 'locked' : 'flex', v.lock_type)} color={badgeColor(v.lock_type === 'LOCKED' ? 'locked' : 'flex')} /></td>
                  <td style={tdCell}><Badge text={badgeText(v.status)} color={badgeColor(v.status)} />{v.early_break_requested && <div style={{ marginTop: 4 }}><Badge text="Break requested" color={badgeColor('flagged')} /></div>}</td>
                  <td style={tdCell}>{formatNaira(v.balance_kobo)}</td>
                  <td style={tdCell}>{v.target_kobo ? formatNaira(v.target_kobo) : '—'}</td>
                  <td style={tdCell}><span style={{ color: colors.success, fontWeight: 600 }}>{formatNaira(v.yield_kobo)}</span></td>
                  <td style={tdCell}>{v.auto_save_enabled ? `${formatNaira(v.auto_save_amount_kobo)} / ${v.auto_save_frequency}` : 'off'}</td>
                  <td style={tdCell}>{fmtDate(v.locked_until)}</td>
                  <td style={tdCell}>
                    {v.status === 'locked'
                      ? <Button variant="danger" sm disabled={busy === v.id} onClick={() => onForceUnlock(v)}>{busy === v.id ? '…' : 'Force-unlock'}</Button>
                      : <span style={{ color: colors.muted, fontSize: '0.78rem' }}>—</span>}
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
